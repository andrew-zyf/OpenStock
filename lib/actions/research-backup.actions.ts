'use server';

import type { ClientSession, Model } from 'mongoose';
import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { MarketEventRecord } from '@/database/models/market-event.model';
import { Alert } from '@/database/models/alert.model';
import { ManualPlanBook, ManualPlanRecord, ManualPlanSchedule } from '@/database/models/manual-plan.model';
import { PeerGroupRecord } from '@/database/models/peer-group.model';
import { ResearchEventHistoryRecord, ResearchChangeStateRecord } from '@/database/models/research-change.model';
import { ResearchFact } from '@/database/models/research-fact.model';
import { ResearchComparisonRecord } from '@/database/models/research-comparison.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { WatchlistLifecycleError, withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';
import { revalidatePath } from 'next/cache';
import {
    backupCanonicalSymbol, createResearchBackup, createResearchBackupV2, groupBackupResearch, parseResearchBackup,
    planResearchImport, planWorkbenchImport, remapWorkbenchRow, remapResearchEvidence,
    researchBackupDigest, researchImportId, ResearchBackupValidationError, WORKBENCH_COLLECTIONS, workbenchRowId, handlingStateTargets,
    type ResearchImportPreview, type ResearchBackupActionResult, type ResearchBackupV2, type WorkbenchCollection,
} from '@/lib/research-backup';

type Row = Record<string, unknown>;
const collectionModels = { manualPlans: ManualPlanRecord, planSchedules: ManualPlanSchedule, peerGroups: PeerGroupRecord,
    eventHistories: ResearchEventHistoryRecord, changeStates: ResearchChangeStateRecord, factCards: ResearchFact,
    comparisons: ResearchComparisonRecord } as unknown as Record<WorkbenchCollection, Model<Row>>;
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
export async function exportResearchBackupForUI(): Promise<ResearchBackupActionResult<string>> { return uiBackupResult(exportResearchBackup); }
export async function previewResearchBackupImportForUI(json: string): Promise<ResearchBackupActionResult<ResearchImportPreview>> { return uiBackupResult(() => previewResearchBackupImport(json)); }
export async function importResearchBackupForUI(json: string, confirmedDigest: string): Promise<ResearchBackupActionResult<ResearchImportPreview>> { return uiBackupResult(() => importResearchBackup(json, confirmedDigest)); }

function effectivePlans(books: Row[], records: Row[]): Row[] {
    const plans = new Map<string, Row>();
    for (const book of books) for (const plan of book.plans as Row[]) plans.set(String(plan.id), plan);
    for (const plan of records) plans.set(String(plan.id), plan);
    return [...plans.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
}
async function readPlans(userId: string, session: ClientSession | null) {
    // Sequential reads are also safe when this helper runs inside a transaction.
    const books = await ManualPlanBook.find({ userId }).session(session).lean() as unknown as Row[];
    const records = await ManualPlanRecord.find({ userId }).session(session).lean() as unknown as Row[];
    return { rows: effectivePlans(books, records), sourceCount: books.reduce((count, book) => count + (book.plans as Row[]).length, 0) + records.length };
}
export async function exportResearchBackup(): Promise<string> {
    const userId = await requireUserId();
    return withWatchlistLifecycle(userId, { operation: 'research-backup-export', readOnly: true }, async () => {
        await connectToDatabase();
        const startedAt = new Date().toISOString();
        const captures = {} as ResearchBackupV2['capture']['collections'];
        async function capture(name: keyof typeof captures, read: () => Promise<{ rows: Row[]; sourceCount?: number }>, scope: string, limitations: string[] = []) {
            const start = new Date().toISOString(); const result = await read();
            captures[name] = { schemaVersion: 1, startedAt: start, completedAt: new Date().toISOString(), count: result.rows.length, sourceCount: result.sourceCount ?? result.rows.length, scope, limitations };
            return result.rows;
        }
        // No active filters, paging, journal projections or provider requests. These reads are independent.
        const [research, events, alerts, ...collections] = await Promise.all([
            capture('research', async () => ({ rows: await Watchlist.find({ userId }).select('+journal').sort({ symbol: 1, _id: 1 }).lean() as unknown as Row[] }), '全部活跃及归档的原始别名记录与已留存日志'),
            capture('manualEvents', async () => ({ rows: await MarketEventRecord.find({ userId }).sort({ createdAt: 1, _id: 1 }).lean() as unknown as Row[] }), '全部手动事件，含撤销记录'),
            capture('alertReferences', async () => ({ rows: await Alert.find({ userId }).sort({ createdAt: 1, _id: 1 }).lean() as unknown as Row[] }), '提醒与触发、通知状态，仅供参考，不恢复执行'),
            ...WORKBENCH_COLLECTIONS.map((name) => capture(name, async () => name === 'manualPlans' ? readPlans(userId, null) : ({ rows: await collectionModels[name].find({ userId }).sort({ _id: 1 }).lean() as Row[] }),
                name === 'manualPlans' ? '全部有效人工计划身份：记录集合覆盖同身份旧书记录，含完成及取消历史' : `当前账户 ${name} 集合全部已留存记录`,
                name === 'manualPlans' ? ['sourceCount 包含旧书与独立记录，同身份旧书副本由独立记录覆盖；没有迁移或修改旧书。'] : name === 'eventHistories' ? ['源存储仅保留每个事件最近 100 个版本；revision 大于版本数表示更早版本已不在库中。'] : name === 'changeStates' ? ['所有处理状态均导出；缺少已留存目标或无法解析身份的历史状态在导入预览中明确跳过。'] : name === 'comparisons' ? ['仅显式保存的对照证据；临时草稿不属于持久化备份范围。'] : [])),
        ]);
        const base = createResearchBackup(research, events, alerts);
        const workbench = Object.fromEntries(WORKBENCH_COLLECTIONS.map((name, index) => [name, collections[index]])) as Record<WorkbenchCollection, Row[]>;
        const backup = createResearchBackupV2(base, workbench, { consistency: 'independent-collection-reads', startedAt, completedAt: new Date().toISOString(), collections: captures,
            unsupported: ['不同集合分别读取，不保证跨集合同一时点一致性。', '不包含外部供应商未保存的数据、已裁剪的事件旧版本、临时对照草稿、账号凭证、自动任务或数据库部署配置。', '单机 MongoDB 自动导入不支持；事务部署的迁移恢复仍需在独立测试账户演练。'] });
        backup.capture.collections.eventHistories.retainedVersions = backup.eventHistories.reduce((count, row) => count + (row.versions as Row[]).length, 0);
        backup.capture.collections.eventHistories.unavailableVersions = backup.eventHistories.reduce((count, row) => count + (row.revision as number) - (row.versions as Row[]).length, 0);
        const targets = handlingStateTargets(backup);
        backup.capture.collections.changeStates.unresolvedTargets = backup.changeStates.filter((row) => !targets.has(row.changeId as string)).length;
        const json = JSON.stringify(backup, null, 2);
        parseResearchBackup(json); // Pretty-print overhead also counts toward the download/upload guard.
        return json;
    });
}
async function currentImportState(userId: string, session: ClientSession | null, includeWorkbench: boolean) {
    const research = await Watchlist.find({ userId }).select('symbol').session(session).lean();
    const events = await MarketEventRecord.find({ userId }).select('_id clientRequestId cancelledAt').session(session).lean();
    const workbench = {} as Record<WorkbenchCollection, Row[]>;
    if (includeWorkbench) for (const name of WORKBENCH_COLLECTIONS) {
        const rows = name === 'manualPlans' ? (await readPlans(userId, session)).rows : await collectionModels[name].find({ userId }).session(session).lean() as Row[];
        workbench[name] = rows.map((row) => ({ ...row, ...(row.id === undefined && row._id !== undefined ? { id: String(row._id) } : {}) }));
    }
    return { symbols: research.map((row) => row.symbol), events, workbench };
}
async function importCapability(database: Awaited<ReturnType<typeof connectToDatabase>>): Promise<NonNullable<ResearchImportPreview['capability']>> {
    try {
        const db = database.connection?.db;
        if (!db) return { status: 'unknown', message: '尚未确认事务能力；导入仅会通过数据库事务执行。' };
        const hello = await db.admin().command({ hello: 1 });
        return hello.setName || hello.msg === 'isdbgrid' ? { status: 'supported', message: '检测到副本集或分片部署；仅通过事务导入，仍需具备事务权限。' }
            : { status: 'unsupported', message: '当前为单机 MongoDB：支持导出和预览，不支持自动导入。请在已验收的事务部署中演练恢复。' };
    } catch { return { status: 'unknown', message: '无法读取部署能力；自动导入仍只使用事务，失败不会降级为部分写入。' }; }
}
export async function previewResearchBackupImport(json: string): Promise<ResearchImportPreview> {
    const userId = await requireUserId(); const backup = parseResearchBackup(json);
    return withWatchlistLifecycle(userId, { operation: 'research-backup-preview', readOnly: true }, async () => {
        const database = await connectToDatabase();
        const state = await currentImportState(userId, null, backup.version === 2);
        let preview = planResearchImport(backup, state.symbols, state.events, userId);
        if (backup.version === 2) preview = planWorkbenchImport(backup, preview, state.workbench, userId);
        return { ...preview, version: backup.version, capability: await importCapability(database) };
    });
}
/** Digest binds confirmation to the validated file, not to a stale client-provided conflict plan. */
export async function importResearchBackup(json: string, confirmedDigest: string): Promise<ResearchImportPreview> {
    const userId = await requireUserId(); const backup = parseResearchBackup(json);
    if (typeof confirmedDigest !== 'string' || researchBackupDigest(backup) !== confirmedDigest) throw new ExpectedBackupActionError('PREVIEW_CHANGED', '备份已更改，请重新预览后确认');
    const outcome = await withWatchlistLifecycle(userId, { operation: 'research-backup-import' }, async (): Promise<{ error: string } | { preview: ResearchImportPreview }> => {
        const database = await connectToDatabase(); const session = await database.startSession();
        let result: ResearchImportPreview | undefined;
        try {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await session.withTransaction(async () => {
                        const state = await currentImportState(userId, session, backup.version === 2);
                        let plan = planResearchImport(backup, state.symbols, state.events, userId);
                        if (backup.version === 2) plan = planWorkbenchImport(backup, plan, state.workbench, userId);
                        const groups = groupBackupResearch(backup.research); const now = new Date();
                        for (const item of plan.research) {
                            if (item.status !== 'import') continue;
                            const records = [...groups.get(item.symbol)!].sort((a, b) => a.id.localeCompare(b.id));
                            const prefix = researchImportId(userId, `aliases:${item.symbol}`).slice(0, 18);
                            const orderedId = (rank: number) => `${prefix}${rank.toString(16).padStart(6, '0')}`;
                            const documents = records.map((source, index) => {
                                const record = remapResearchEvidence(source, userId);
                                return { ...record, _id: orderedId(index), userId, archivedAt: record.archivedAt ? new Date(record.archivedAt) : now };
                            });
                            if (!records.some((row) => row.symbol === item.symbol)) {
                                const { id, journal: _journal, journalVersion: _version, ...metadata } = [...records].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))[0];
                                void id; void _journal; void _version;
                                documents.push({ ...metadata, symbol: item.symbol, _id: orderedId(records.length), userId, archivedAt: metadata.archivedAt ? new Date(metadata.archivedAt) : now });
                            }
                            await Watchlist.insertMany(documents, { session, ordered: true });
                        }
                        const eventIds = new Set(plan.manualEvents.filter((item) => item.status === 'import').map((item) => item.id));
                        const events = backup.manualEvents.filter((event) => eventIds.has(event.id)).map(({ id, ...event }) => ({ ...event, _id: researchImportId(userId, id), userId, symbol: backupCanonicalSymbol(event.symbol) }));
                        if (events.length) await MarketEventRecord.insertMany(events, { session, ordered: true });
                        if (backup.version === 2) {
                            const slots = new Set(state.workbench.peerGroups.map((row) => row.slot));
                            for (const name of WORKBENCH_COLLECTIONS) {
                                const importing = new Set(plan.workbench!.filter((item) => item.collection === name && item.status === 'import').map((item) => item.id));
                                const rows = backup[name].filter((row) => importing.has(workbenchRowId(name, row))).map((row) => {
                                    const document = remapWorkbenchRow(backup, name, row, userId);
                                    if (name === 'peerGroups') { const slot = Array.from({ length: 10 }, (_, i) => i).find((slot) => !slots.has(slot))!; slots.add(slot); document.slot = slot; }
                                    return document;
                                });
                                if (rows.length) await collectionModels[name].insertMany(rows, { session, ordered: true });
                            }
                        }
                        // Alert references have no write path, scheduler, quote or mail calls.
                        result = plan;
                    });
                    break;
                } catch (error) {
                    if ((error as { code?: number }).code === 11000 && attempt < 2) continue;
                    if ((error as { code?: number }).code === 20 || /Transaction numbers are only allowed/i.test((error as Error).message || '')) return { error: '安全导入需要支持事务的 MongoDB 副本集；本次未导入任何记录' };
                    throw error;
                }
            }
        } finally { await session.endSession(); }
        if (!result) throw new Error('导入冲突，请重新预览');
        return { preview: result };
    });
    if ('error' in outcome) throw new ExpectedBackupActionError('TRANSACTIONS_UNSUPPORTED', outcome.error);
    revalidatePath('/', 'layout'); return outcome.preview;
}
