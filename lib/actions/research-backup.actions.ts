'use server';

import type { ClientSession } from 'mongoose';
import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { MarketEventRecord } from '@/database/models/market-event.model';
import { Alert } from '@/database/models/alert.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { WatchlistLifecycleError, withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';
import { revalidatePath } from 'next/cache';
import {
    backupCanonicalSymbol, createResearchBackup, groupBackupResearch, parseResearchBackup,
    planResearchImport, researchBackupDigest, researchImportId, ResearchBackupValidationError,
    type ResearchImportPreview, type ResearchBackupActionResult,
} from '@/lib/research-backup';

class ExpectedBackupActionError extends Error {
    constructor(public readonly code: 'PREVIEW_CHANGED' | 'TRANSACTIONS_UNSUPPORTED', message: string) { super(message); }
}

async function uiBackupResult<T>(run: () => Promise<T>): Promise<ResearchBackupActionResult<T>> {
    try { return { success: true, data: await run() }; }
    catch (error) {
        if (error instanceof ResearchBackupValidationError) return { success: false, code: 'INVALID_BACKUP', error: error.message };
        if (error instanceof ExpectedBackupActionError || error instanceof WatchlistLifecycleError) return { success: false, code: error.code, error: error.message };
        return { success: false, code: 'BACKUP_FAILED', error: '研究备份操作未完成，请检查登录状态后重试；若仍失败，请联系管理员检查服务状态。' };
    }
}

// Expected failures are serializable data so production Server Actions cannot redact their messages.
export async function exportResearchBackupForUI(): Promise<ResearchBackupActionResult<string>> {
    return uiBackupResult(exportResearchBackup);
}
export async function previewResearchBackupImportForUI(json: string): Promise<ResearchBackupActionResult<ResearchImportPreview>> {
    return uiBackupResult(() => previewResearchBackupImport(json));
}
export async function importResearchBackupForUI(json: string, confirmedDigest: string): Promise<ResearchBackupActionResult<ResearchImportPreview>> {
    return uiBackupResult(() => importResearchBackup(json, confirmedDigest));
}

export async function exportResearchBackup(): Promise<string> {
    const userId = await requireUserId();
    return withWatchlistLifecycle(userId, { operation: 'research-backup-export', readOnly: true }, async () => {
        await connectToDatabase();
        // No active filter, view merge, paging or journal projection: retain every raw alias and cancellation.
        const [research, events, alerts] = await Promise.all([
            Watchlist.find({ userId }).select('+journal').sort({ symbol: 1, _id: 1 }).lean(),
            MarketEventRecord.find({ userId }).sort({ createdAt: 1, _id: 1 }).lean(),
            Alert.find({ userId }).sort({ createdAt: 1, _id: 1 }).lean(),
        ]);
        const json = JSON.stringify(createResearchBackup(research, events, alerts), null, 2);
        // Never truncate history or hand out a file which this version cannot safely restore.
        parseResearchBackup(json);
        return json;
    });
}

async function currentImportState(userId: string, session: ClientSession | null = null) {
    // The driver does not support parallel operations inside one transaction.
    const research = await Watchlist.find({ userId }).select('symbol').session(session).lean();
    const events = await MarketEventRecord.find({ userId }).select('_id clientRequestId cancelledAt').session(session).lean();
    return { symbols: research.map((row) => row.symbol), events };
}

export async function previewResearchBackupImport(json: string): Promise<ResearchImportPreview> {
    const userId = await requireUserId();
    const backup = parseResearchBackup(json);
    return withWatchlistLifecycle(userId, { operation: 'research-backup-preview', readOnly: true }, async () => {
        await connectToDatabase();
        const state = await currentImportState(userId);
        return planResearchImport(backup, state.symbols, state.events, userId);
    });
}

/** Digest binds confirmation to the validated file, not to a stale client-provided conflict plan. */
export async function importResearchBackup(json: string, confirmedDigest: string): Promise<ResearchImportPreview> {
    const userId = await requireUserId();
    const backup = parseResearchBackup(json);
    if (typeof confirmedDigest !== 'string' || researchBackupDigest(backup) !== confirmedDigest) throw new ExpectedBackupActionError('PREVIEW_CHANGED', '备份已更改，请重新预览后确认');
    const outcome = await withWatchlistLifecycle(userId, { operation: 'research-backup-import' }, async (): Promise<{ error: string } | { preview: ResearchImportPreview }> => {
        const database = await connectToDatabase();
        // Atomic groups preserve cross-alias correction links. Never fall back to partial standalone writes.
        const session = await database.startSession();
        let result: ResearchImportPreview | undefined;
        try {
            // A concurrent canonical insert may win the unique-index race; rescan and skip it on retry.
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await session.withTransaction(async () => {
                        const state = await currentImportState(userId, session);
                        const plan = planResearchImport(backup, state.symbols, state.events, userId);
                        const groups = groupBackupResearch(backup.research);
                        const now = new Date();
                        for (const item of plan.research) {
                            if (item.status !== 'import') continue;
                            const records = [...groups.get(item.symbol)!].sort((a, b) => a.id.localeCompare(b.id));
                            // observationOwner breaks equal-date ties by _id. Preserve the source raw-id order.
                            const prefix = researchImportId(userId, `aliases:${item.symbol}`).slice(0, 18);
                            const orderedId = (rank: number) => `${prefix}${rank.toString(16).padStart(6, '0')}`;
                            const documents = records.map(({ id, ...record }, index) => {
                                void id;
                                return { ...record, _id: orderedId(index), userId,
                                    // File ownership and active/archive status never control the destination account.
                                    archivedAt: record.archivedAt ? new Date(record.archivedAt) : now };
                            });
                            if (!records.some((row) => row.symbol === item.symbol)) {
                                // Explicit normalization record reserves the canonical unique key against concurrent adds.
                                // It copies real metadata only; the raw alias docs retain their own snapshot and journal.
                                const { id, journal: _journal, journalVersion: _version, ...metadata } = [...records].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))[0];
                                void id; void _journal; void _version;
                                documents.push({ ...metadata, symbol: item.symbol,
                                    _id: orderedId(records.length), userId,
                                    archivedAt: metadata.archivedAt ? new Date(metadata.archivedAt) : now });
                            }
                            await Watchlist.insertMany(documents, { session, ordered: true });
                        }
                        const importEventIds = new Set(plan.manualEvents.filter((item) => item.status === 'import').map((item) => item.id));
                        const events = backup.manualEvents.filter((event) => importEventIds.has(event.id)).map(({ id, ...event }) => ({
                            ...event, _id: researchImportId(userId, id), userId, symbol: backupCanonicalSymbol(event.symbol),
                        }));
                        if (events.length) await MarketEventRecord.insertMany(events, { session, ordered: true });
                        // Alert references deliberately have no write path, scheduler, quote or mail calls.
                        result = plan;
                    });
                    break;
                } catch (error) {
                    if ((error as { code?: number }).code === 11000 && attempt < 2) continue;
                    if ((error as { code?: number }).code === 20 || /Transaction numbers are only allowed/i.test((error as Error).message || '')) {
                        // The server rejected transaction execution before any writes. Release the mutex normally.
                        return { error: '安全导入需要支持事务的 MongoDB 副本集；本次未导入任何记录' };
                    }
                    throw error;
                }
            }
        } finally { await session.endSession(); }
        if (!result) throw new Error('导入冲突，请重新预览');
        return { preview: result };
    });
    if ('error' in outcome) throw new ExpectedBackupActionError('TRANSACTIONS_UNSUPPORTED', outcome.error);
    revalidatePath('/', 'layout');
    return outcome.preview;
}
