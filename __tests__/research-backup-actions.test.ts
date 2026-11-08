import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseResearchBackup, researchBackupDigest, researchImportId, type ResearchBackup } from '@/lib/research-backup';
import { mergeWatchlistRecords, type SavedWatchlistRecord } from '@/lib/watchlist-observation';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), lifecycle: vi.fn(), researchFind: vi.fn(), eventFind: vi.fn(), alertFind: vi.fn(), researchInsert: vi.fn(), eventInsert: vi.fn(), revalidate: vi.fn(), transaction: vi.fn(), endSession: vi.fn(), extra: Object.fromEntries(['books', 'manualPlans', 'planSchedules', 'peerGroups', 'eventHistories', 'changeStates', 'factCards', 'comparisons'].map((name) => [name, { find: vi.fn(), insertMany: vi.fn() }])) }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/lib/watchlist-lifecycle', async (importOriginal) => ({ ...await importOriginal<Record<string, unknown>>(), withWatchlistLifecycle: mocks.lifecycle }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { find: mocks.researchFind, insertMany: mocks.researchInsert } }));
vi.mock('@/database/models/market-event.model', () => ({ MarketEventRecord: { find: mocks.eventFind, insertMany: mocks.eventInsert } }));
vi.mock('@/database/models/alert.model', () => ({ Alert: { find: mocks.alertFind } }));
vi.mock('@/database/models/manual-plan.model', () => ({ ManualPlanBook: mocks.extra.books, ManualPlanRecord: mocks.extra.manualPlans, ManualPlanSchedule: mocks.extra.planSchedules }));
vi.mock('@/database/models/peer-group.model', () => ({ PeerGroupRecord: mocks.extra.peerGroups }));
vi.mock('@/database/models/research-change.model', () => ({ ResearchEventHistoryRecord: mocks.extra.eventHistories, ResearchChangeStateRecord: mocks.extra.changeStates }));
vi.mock('@/database/models/research-fact.model', () => ({ ResearchFact: mocks.extra.factCards }));
vi.mock('@/database/models/research-comparison.model', () => ({ ResearchComparisonRecord: mocks.extra.comparisons }));
import { exportResearchBackup, importResearchBackup, previewResearchBackupImport, exportResearchBackupForUI, importResearchBackupForUI, previewResearchBackupImportForUI } from '@/lib/actions/research-backup.actions';
import { WatchlistLifecycleError } from '@/lib/watchlist-lifecycle';
import { v2Fixture, planId, rawId, factId, comparisonId, backupTime, stateId } from './fixtures/research-backup-v2';
import { WORKBENCH_COLLECTIONS, type ResearchBackupV2 } from '@/lib/research-backup';
const time = '2026-11-08T01:00:00.000Z';
const snapshot = { price: 100, currency: 'HKD', source: 'source', asOf: time, fetchedAt: time, priceBasis: 'last-trade', adjustment: 'unadjusted' } as const;
function fixture(): ResearchBackup {
    return { format: 'openstock-research', version: 1, exportedAt: time, research: [
        { id: '111111111111111111111111', symbol: '0700.HK', company: '腾讯', note: '原始观点', addedAt: time, initialSnapshot: snapshot, journalVersion: 4, journal: [
            { kind: 'review', id: 'review-1', createdAt: time, tradingDate: '2026-11-06', hypothesis: '观点', changes: '变化', conclusion: '结论', verificationType: 'price', evidenceURLs: ['https://example.com/'], clientRequestId: 'request-original', sourceQuote: snapshot },
            { kind: 'observation', id: 'revision-1', recordedAt: time, modifiedAt: null, source: 'legacy-capture', sourceSymbol: '0700.HK', reviewId: 'review-1', observation: { reviewStatus: 'watching', note: '旧版' } },
        ] },
        { id: '222222222222222222222222', symbol: 'HKEX:700', company: '腾讯控股', addedAt: time, journal: [
            { kind: 'review', id: 'review-2', correctionOf: 'review-1', createdAt: time, tradingDate: '2026-11-06', hypothesis: '更正观点', changes: '更正变化', conclusion: '更正结论', verificationType: 'judgment', evidenceURLs: [], clientRequestId: 'request-correction' },
        ] },
    ], manualEvents: [{ id: '333333333333333333333333', symbol: '0700.HK', title: '已撤销事件', date: '2026-11-08', kind: 'other', clientRequestId: 'manual-request', createdAt: time, cancelledAt: time }], alertReferences: { referenceOnly: true, alerts: [] } };
}
type Row = Record<string, unknown>;
let research: Row[]; let events: Row[]; let alerts: Row[]; let extraRows: Record<string, Row[]>;
function query(rows: Row[]) {
    const chain = { select: vi.fn(() => chain), sort: vi.fn(() => chain), session: vi.fn(() => chain), lean: vi.fn(async () => rows) };
    return chain;
}
beforeEach(() => {
    vi.clearAllMocks(); research = []; events = []; alerts = [];
    extraRows = Object.fromEntries(Object.keys(mocks.extra).map((name) => [name, []]));
    for (const [name, model] of Object.entries(mocks.extra)) {
        model.find.mockImplementation(({ userId }) => query(extraRows[name].filter((row) => row.userId === userId)));
        model.insertMany.mockImplementation(async (rows: Row[]) => { extraRows[name].push(...rows); });
    }
    mocks.auth.mockResolvedValue('current-owner');
    mocks.lifecycle.mockImplementation(async (_userId, _intent, run: () => Promise<unknown>) => run());
    mocks.researchFind.mockImplementation(({ userId }) => query(research.filter((row) => row.userId === userId)));
    mocks.eventFind.mockImplementation(({ userId }) => query(events.filter((row) => row.userId === userId)));
    mocks.alertFind.mockImplementation(({ userId }) => query(alerts.filter((row) => row.userId === userId)));
    mocks.researchInsert.mockImplementation(async (rows: Row[]) => { research.push(...rows); });
    mocks.eventInsert.mockImplementation(async (rows: Row[]) => { events.push(...rows); });
    mocks.transaction.mockImplementation(async (run: () => Promise<void>) => {
        const oldResearch = [...research]; const oldEvents = [...events]; const oldExtra = structuredClone(extraRows);
        try { await run(); } catch (error) { research = oldResearch; events = oldEvents; extraRows = oldExtra; throw error; }
    });
    mocks.connect.mockResolvedValue({ startSession: async () => ({ withTransaction: mocks.transaction, endSession: mocks.endSession }) });
});
function serialized() { const backup = fixture(); return { json: JSON.stringify(backup), digest: researchBackupDigest(backup) }; }
describe('authenticated research backup actions', () => {
    it('exports every own active/archive raw alias, cancellation and alert reference without owner or delivery secrets', async () => {
        const source = fixture();
        research = source.research.map(({ id, ...row }, index) => ({ ...row, _id: id, userId: 'current-owner', ...(index ? { archivedAt: new Date(time) } : {}) }));
        research.push({ userId: 'other-owner', _id: '999999999999999999999999', symbol: 'AAPL', company: 'PRIVATE' });
        events = source.manualEvents.map(({ id, ...row }) => ({ ...row, _id: id, userId: 'current-owner' }));
        alerts = [{ _id: '444444444444444444444444', userId: 'current-owner', symbol: '0700.HK', targetPrice: 100, condition: 'ABOVE', active: false, triggered: true, createdAt: time, expiresAt: time, triggerEvent: { id: 'trigger', price: 101, asOf: time, source: 'source', direction: 'ABOVE', observedAt: time }, delivery: { status: 'failed', attemptedAt: time, reason: 'private SMTP failure', messageId: 'private-mail' } }];
        const result = parseResearchBackup(await exportResearchBackup());
        expect(result.research).toHaveLength(2); expect(result.research[0].journal).toEqual(source.research[0].journal);
        expect(result.manualEvents[0].cancelledAt).toBe(time);
        expect(result.alertReferences.alerts[0]).toMatchObject({ triggerEvent: { id: 'trigger' }, delivery: { status: 'failed' } });
        expect(JSON.stringify(result)).not.toMatch(/current-owner|other-owner|PRIVATE|private SMTP|private-mail/);
        expect(mocks.researchFind).toHaveBeenCalledWith({ userId: 'current-owner' });
        expect(mocks.researchInsert).not.toHaveBeenCalled(); expect(mocks.eventInsert).not.toHaveBeenCalled();
    });
    it('requires auth for export, preview and import before reading any account', async () => {
        mocks.auth.mockRejectedValue(new Error('Unauthorized'));
        const { json, digest } = serialized();
        await expect(exportResearchBackup()).rejects.toThrow('Unauthorized');
        await expect(previewResearchBackupImport(json)).rejects.toThrow('Unauthorized');
        await expect(importResearchBackup(json, digest)).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled();
    });
    it('rejects ownership injection, unsafe nested references and changed files before any DB access', async () => {
        const backup = fixture(); Object.assign(backup.research[0], { userId: 'attacker' });
        await expect(previewResearchBackupImport(JSON.stringify(backup))).rejects.toThrow();
        const invalid = fixture(); Object.assign(invalid.research[1].journal![0], { correctionOf: 'nonexistent' });
        await expect(importResearchBackup(JSON.stringify(invalid), researchBackupDigest(invalid))).rejects.toThrow('更正');
        const { json } = serialized(); await expect(importResearchBackup(json, 'forged-preview')).rejects.toThrow('重新预览');
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.researchInsert).not.toHaveBeenCalled();
    });
    it('server preview detects archived alias and cancelled event conflicts without writes', async () => {
        research = [{ userId: 'current-owner', symbol: '00700.HK', archivedAt: new Date(time) }];
        events = [{ userId: 'current-owner', clientRequestId: 'manual-request', cancelledAt: new Date(time) }];
        const plan = await previewResearchBackupImport(serialized().json);
        expect(plan.research[0]).toMatchObject({ status: 'skip-existing', records: 2 }); expect(plan.manualEvents[0].status).toBe('skip-existing');
        expect(mocks.researchInsert).not.toHaveBeenCalled(); expect(mocks.eventInsert).not.toHaveBeenCalled();
    });
    it('roundtrips atomic raw alias groups, preserving journal ids/corrections/snapshots, then idempotently skips replay', async () => {
        const { json, digest } = serialized();
        const result = await importResearchBackup(json, digest);
        expect(result.research[0].status).toBe('import'); expect(research).toHaveLength(3);
        expect(research.every((row) => row.userId === 'current-owner' && row.archivedAt instanceof Date)).toBe(true);
        const raw = research.find((row) => row.symbol === '0700.HK')!;
        expect(raw._id).toBe(`${researchImportId('current-owner', 'aliases:00700.HK').slice(0, 18)}000000`);
        expect(raw.journal).toEqual(fixture().research[0].journal); expect(raw.initialSnapshot).toEqual(snapshot);
        const guard = research.find((row) => row.symbol === '00700.HK')!;
        expect(guard.addedAt).toBe(time); expect(guard.journal).toBeUndefined();
        expect(events[0]).toMatchObject({ userId: 'current-owner', clientRequestId: 'manual-request', cancelledAt: time, symbol: '00700.HK' });
        const exported = parseResearchBackup(await exportResearchBackup());
        expect(exported.research.find((row) => row.symbol === 'HKEX:700')!.journal).toEqual(fixture().research[1].journal);
        expect(exported.manualEvents[0].cancelledAt).toBe(time);
        const replay = await importResearchBackup(json, digest);
        expect(replay.research[0].status).toBe('skip-existing'); expect(replay.manualEvents[0].status).toBe('skip-existing');
        expect(research).toHaveLength(3); expect(events).toHaveLength(1);
        // Exporting imported data and importing it again is also idempotent.
        await importResearchBackup(JSON.stringify(exported), researchBackupDigest(exported));
        expect(research).toHaveLength(3); expect(events).toHaveLength(1);
    });
    it('preserves the effective observation owner when alias timestamps tie', async () => {
        mocks.auth.mockResolvedValue('owner');
        const source = fixture();
        source.research[0] = { ...source.research[0], id: '000000000000000000000001', symbol: '00700.HK', observationUpdatedAt: time, note: 'authoritative first thesis' };
        source.research[1] = { ...source.research[1], id: '000000000000000000000002', observationUpdatedAt: time, note: 'second thesis' };
        const before = mergeWatchlistRecords(source.research.map(({ id, ...row }) => ({ ...row, _id: id })))[0];
        await importResearchBackup(JSON.stringify(source), researchBackupDigest(source));
        const after = mergeWatchlistRecords(JSON.parse(JSON.stringify(research)) as SavedWatchlistRecord[])[0];
        expect(before.note).toBe('authoritative first thesis'); expect(after.note).toBe(before.note);
        expect(String(research[0]._id) < String(research[1]._id)).toBe(true);
    });
    it('exports and previews more than 1000 archived records without silently truncating', async () => {
        research = Array.from({ length: 1001 }, (_, index) => ({ _id: index.toString(16).padStart(24, '0'), userId: 'current-owner', symbol: `STOCK${index}`, company: `Company ${index}`, addedAt: time, archivedAt: time }));
        const json = await exportResearchBackup();
        const exported = parseResearchBackup(json); expect(exported.research).toHaveLength(1001);
        const preview = await previewResearchBackupImport(json); expect(preview.research).toHaveLength(1001);
        expect(preview.research.every((row) => row.status === 'skip-existing')).toBe(true);
    });
    it('refuses an export which cannot safely roundtrip instead of emitting or truncating it', async () => {
        research = [{ _id: '111111111111111111111111', userId: 'current-owner', symbol: 'AAPL', company: 'Company', addedAt: time, initialSnapshot: { ...snapshot, asOf: '2026-02-30T01:00:00.000Z' } }];
        await expect(exportResearchBackup()).rejects.toThrow('ISO');
        expect(mocks.researchInsert).not.toHaveBeenCalled(); expect(research).toHaveLength(1);
    });
    it('rechecks current account conflicts after preview and skips entire alias groups instead of merging', async () => {
        const { json } = serialized(); const preview = await previewResearchBackupImport(json);
        research = [{ userId: 'current-owner', symbol: 'HKEX:700', note: 'new work', archivedAt: null }];
        events = [{ userId: 'current-owner', _id: '333333333333333333333333', clientRequestId: 'manual-request', cancelledAt: time, title: 'current work' }];
        const result = await importResearchBackup(json, preview.digest);
        expect(result.research[0].status).toBe('skip-existing'); expect(result.manualEvents[0].status).toBe('skip-existing');
        expect(research[0].note).toBe('new work'); expect(events[0].title).toBe('current work');
        expect(mocks.researchInsert).not.toHaveBeenCalled(); expect(mocks.eventInsert).not.toHaveBeenCalled();
    });
    it('never overwrites or revives existing manual events even if the file changes their request id', async () => {
        const backup = fixture(); backup.manualEvents[0].clientRequestId = 'renamed-request'; delete backup.manualEvents[0].cancelledAt;
        events = [{ _id: researchImportId('current-owner', backup.manualEvents[0].id), userId: 'current-owner', clientRequestId: 'manual-request', cancelledAt: time }];
        await importResearchBackup(JSON.stringify(backup), researchBackupDigest(backup));
        expect(mocks.eventInsert).not.toHaveBeenCalled(); expect(events[0].cancelledAt).toBe(time);
    });
    it('rolls back the entire alias group on later write failure and never falls back to standalone writes', async () => {
        const { json, digest } = serialized();
        mocks.eventInsert.mockRejectedValueOnce(new Error('event insert failed'));
        await expect(importResearchBackup(json, digest)).rejects.toThrow('event insert failed');
        expect(research).toEqual([]); expect(events).toEqual([]); expect(mocks.endSession).toHaveBeenCalled();
        mocks.transaction.mockRejectedValueOnce({ code: 20, message: 'Transaction numbers are only allowed on a replica set' });
        await expect(importResearchBackup(json, digest)).rejects.toThrow('需要支持事务');
        expect(research).toEqual([]); expect(events).toEqual([]);
    });
    it('coordinates export and preview reads and holds the mutation mutex outside the import transaction', async () => {
        let held = false;
        mocks.lifecycle.mockImplementation(async (_userId, _intent, run: () => Promise<unknown>) => {
            expect(held).toBe(false); held = true;
            try { return await run(); } finally { held = false; }
        });
        mocks.researchFind.mockImplementation(({ userId }) => {
            expect(held).toBe(true); return query(research.filter((row) => row.userId === userId));
        });
        mocks.transaction.mockImplementation(async (run: () => Promise<void>) => { expect(held).toBe(true); await run(); });
        const { json, digest } = serialized();
        await exportResearchBackup(); await previewResearchBackupImport(json); await importResearchBackup(json, digest);
        expect(mocks.lifecycle.mock.calls.map(([userId, intent]) => [userId, intent])).toEqual([
            ['current-owner', { operation: 'research-backup-export', readOnly: true }],
            ['current-owner', { operation: 'research-backup-preview', readOnly: true }],
            ['current-owner', { operation: 'research-backup-import' }],
        ]);
        expect(held).toBe(false);
    });
    it('releases coordination on unsupported standalone import so export and preview remain usable', async () => {
        let maintenance = false;
        const released: string[] = [];
        mocks.lifecycle.mockImplementation(async (_userId, intent: { operation: string; readOnly?: boolean }, run: () => Promise<unknown>) => {
            if (maintenance) throw new Error('maintenance');
            try { const result = await run(); released.push(intent.operation); return result; }
            catch (error) { if (!intent.readOnly) maintenance = true; throw error; }
        });
        mocks.transaction.mockRejectedValueOnce({ code: 20, message: 'Transaction numbers are only allowed on a replica set' });
        const { json, digest } = serialized();
        await expect(importResearchBackup(json, digest)).rejects.toThrow('需要支持事务');
        expect(maintenance).toBe(false); expect(released).toContain('research-backup-import');
        await expect(exportResearchBackup()).resolves.toContain('openstock-research');
        await expect(previewResearchBackupImport(json)).resolves.toMatchObject({ research: [{ status: 'import' }] });
        expect(released).toEqual(['research-backup-import', 'research-backup-export', 'research-backup-preview']);
        expect(research).toEqual([]); expect(events).toEqual([]);
    });
    it('passes unknown transaction outcomes to conservative lifecycle handling', async () => {
        let maintenance = false;
        mocks.lifecycle.mockImplementation(async (_userId, intent: { readOnly?: boolean }, run: () => Promise<unknown>) => {
            try { return await run(); } catch (error) { if (!intent.readOnly) maintenance = true; throw error; }
        });
        mocks.transaction.mockRejectedValueOnce(new Error('unknown commit outcome'));
        const { json, digest } = serialized();
        await expect(importResearchBackup(json, digest)).rejects.toThrow('unknown commit outcome');
        expect(maintenance).toBe(true);
    });
    it('returns stable serializable Chinese validation and confirmation failures to production UI', async () => {
        await expect(previewResearchBackupImportForUI('{invalid')).resolves.toEqual({ success: false, code: 'INVALID_BACKUP', error: '无法读取 JSON 备份' });
        const invalid = fixture(); Object.assign(invalid.research[0], { userId: 'attacker' });
        await expect(previewResearchBackupImportForUI(JSON.stringify(invalid))).resolves.toEqual({ success: false, code: 'INVALID_BACKUP', error: '备份含不支持的字段（包括归属或执行指令）' });
        await expect(importResearchBackupForUI(serialized().json, 'changed')).resolves.toEqual({ success: false, code: 'PREVIEW_CHANGED', error: '备份已更改，请重新预览后确认' });
        expect(mocks.connect).not.toHaveBeenCalled();
    });
    it('returns actionable unsupported and lifecycle failures without throwing across the UI action boundary', async () => {
        mocks.transaction.mockRejectedValueOnce({ code: 20, message: 'Transaction numbers are only allowed on a replica set' });
        const { json, digest } = serialized();
        await expect(importResearchBackupForUI(json, digest)).resolves.toEqual({ success: false, code: 'TRANSACTIONS_UNSUPPORTED', error: '安全导入需要支持事务的 MongoDB 副本集；本次未导入任何记录' });
        mocks.lifecycle.mockRejectedValueOnce(new WatchlistLifecycleError('LIFECYCLE_BUSY'));
        await expect(exportResearchBackupForUI()).resolves.toEqual({ success: false, code: 'LIFECYCLE_BUSY', error: '研究记录正在处理其他请求，请稍后重试' });
        mocks.lifecycle.mockRejectedValueOnce(new WatchlistLifecycleError('LIFECYCLE_MAINTENANCE'));
        await expect(previewResearchBackupImportForUI(json)).resolves.toMatchObject({ success: false, code: 'LIFECYCLE_MAINTENANCE', error: new WatchlistLifecycleError('LIFECYCLE_MAINTENANCE').message });
    });
    it('never exposes internal DB or authentication errors through UI-facing results', async () => {
        mocks.connect.mockRejectedValueOnce(new Error('mongodb://private-db.internal:27017/secret-account connection failed'));
        const result = await exportResearchBackupForUI();
        expect(result).toEqual({ success: false, code: 'BACKUP_FAILED', error: '研究备份操作未完成，请检查登录状态后重试；若仍失败，请联系管理员检查服务状态。' });
        expect(JSON.stringify(result)).not.toMatch(/mongodb|private-db|secret-account/);
        mocks.auth.mockRejectedValueOnce(new Error('private auth debugging information'));
        await expect(previewResearchBackupImportForUI(serialized().json)).resolves.toMatchObject({ success: false, code: 'BACKUP_FAILED' });
    });
    it('returns successful export and preview data in the same serializable UI result shape', async () => {
        const exported = await exportResearchBackupForUI();
        expect(exported.success).toBe(true);
        if (exported.success) expect(parseResearchBackup(exported.data).format).toBe('openstock-research');
        await expect(previewResearchBackupImportForUI(serialized().json)).resolves.toMatchObject({ success: true, data: { research: [{ status: 'import' }] } });
    });
    it('rescans after a concurrent unique canonical insertion and skips the winning identity', async () => {
        const { json, digest } = serialized();
        mocks.transaction.mockImplementationOnce(async () => {
            research.push({ userId: 'current-owner', symbol: '00700.HK', note: 'concurrent addition' });
            throw { code: 11000 };
        });
        const result = await importResearchBackup(json, digest);
        expect(result.research[0].status).toBe('skip-existing'); expect(research).toHaveLength(1); expect(mocks.researchInsert).not.toHaveBeenCalled();
    });
});

describe('JSON v2 transactional workbench actions', () => {
    it('restores all saved collections under one transaction and rewrites every concrete reference to this owner', async () => {
        const source = v2Fixture(); const json = JSON.stringify(source);
        const result = await importResearchBackup(json, researchBackupDigest(source));
        expect(result.workbench?.every((row) => row.status === 'import')).toBe(true);
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        for (const name of WORKBENCH_COLLECTIONS) {
            expect(extraRows[name]).toHaveLength(source[name].length);
            expect(extraRows[name].every((row) => row.userId === 'current-owner')).toBe(true);
            expect(mocks.extra[name].insertMany.mock.calls[0][1]).toMatchObject({ session: expect.anything(), ordered: true });
        }
        const importedId = String(research[0]._id);
        expect(importedId).not.toBe(rawId);
        expect(extraRows.factCards[0]).toMatchObject({ id: factId, observationSnapshot: { recordId: importedId, revisionId: 'revision-1' }, createFingerprint: source.factCards[0].createFingerprint });
        const review = (research[0].journal as Row[])[1];
        expect(review.evidenceReferences).toEqual([{ kind: 'fact', id: factId }, { kind: 'comparison', id: researchImportId('current-owner', comparisonId) }]);
        expect(extraRows.changeStates[0].changeId).toBe(stateId('review-due', [importedId, 'AAPL', '2026-11-08', backupTime]));
        const replay = await importResearchBackup(json, researchBackupDigest(source));
        expect(replay.workbench?.every((row) => row.status !== 'import')).toBe(true);
        expect(extraRows.factCards).toHaveLength(1); expect(research).toHaveLength(1);
        // An export after restore must itself pass full graph validation.
        const exported = parseResearchBackup(await exportResearchBackup());
        expect(exported.version).toBe(2);
        if (exported.version === 2) {
            expect(exported.capture.collections.eventHistories).toMatchObject({ retainedVersions: 1, unavailableVersions: 104 });
            expect(exported.capture.collections.changeStates.unresolvedTargets).toBe(0);
        }
        await importResearchBackup(JSON.stringify(exported), researchBackupDigest(exported));
        expect(extraRows.comparisons).toHaveLength(1); expect(extraRows.factCards).toHaveLength(1);
    });
    it('rolls back research, plans, schedules, groups, event/state and fact writes after the final evidence write fails', async () => {
        const source = v2Fixture(); mocks.extra.comparisons.insertMany.mockRejectedValueOnce(new Error('saved evidence insert failed'));
        await expect(importResearchBackup(JSON.stringify(source), researchBackupDigest(source))).rejects.toThrow('saved evidence insert failed');
        expect(research).toEqual([]); expect(events).toEqual([]);
        for (const name of WORKBENCH_COLLECTIONS) expect(extraRows[name]).toEqual([]);
        expect(mocks.endSession).toHaveBeenCalledTimes(1);
    });
    it('rechecks stable owner identities at commit and skips all related evidence without overwriting current drafts', async () => {
        const source = v2Fixture(); const json = JSON.stringify(source); const plan = await previewResearchBackupImport(json);
        extraRows.factCards.push({ ...source.factCards[0], userId: 'current-owner', factText: '当前账户已有原文' });
        const result = await importResearchBackup(json, plan.digest);
        expect(result.research[0].status).toBe('skip-related');
        expect(extraRows.factCards[0].factText).toBe('当前账户已有原文');
        expect(mocks.researchInsert).not.toHaveBeenCalled(); expect(mocks.extra.comparisons.insertMany).not.toHaveBeenCalled();
        expect(extraRows.eventHistories).toHaveLength(1); // Separate evidence group remains recoverable.
    });
    it('exports all terminal legacy/record plans and retained history with honest source counts without migrating books', async () => {
        const source = v2Fixture(); const original = { ...source.manualPlans[0] }; delete original.observationVersionId; delete original.observationSnapshot;
        original.createFingerprint = JSON.stringify(['AAPL', '核对', '失效', '行动', '2026-11-07']);
        extraRows.books = [{ userId: 'current-owner', plans: [{ ...original, nextAction: '旧书原文' }] }];
        extraRows.manualPlans = Array.from({ length: 125 }, (_, index) => ({ ...original, id: index === 0 ? planId : `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`, clientRequestId: `plan-request-${index}`, userId: 'current-owner' }));
        extraRows.planSchedules = extraRows.manualPlans.map((row) => ({ ...source.planSchedules[0], planId: row.id, userId: 'current-owner' }));
        const exported = parseResearchBackup(await exportResearchBackup()) as ResearchBackupV2;
        expect(exported.manualPlans).toHaveLength(125); expect(exported.manualPlans.find((row) => row.id === planId)!.nextAction).toBe('行动');
        expect(exported.capture.collections.manualPlans).toMatchObject({ count: 125, sourceCount: 126, schemaVersion: 1 });
        expect(exported.planSchedules).toHaveLength(125);
        expect(extraRows.books[0].plans).toEqual([expect.objectContaining({ nextAction: '旧书原文' })]);
        for (const model of Object.values(mocks.extra)) expect(model.insertMany).not.toHaveBeenCalled();
    });
    it('shows read-only capability evidence before confirmation for standalone and replica-set deployments', async () => {
        const source = v2Fixture(); const session = { withTransaction: mocks.transaction, endSession: mocks.endSession };
        const command = vi.fn().mockResolvedValue({ isWritablePrimary: true });
        mocks.connect.mockResolvedValue({ connection: { db: { admin: () => ({ command }) } }, startSession: async () => session });
        const standalone = await previewResearchBackupImport(JSON.stringify(source));
        expect(standalone.capability).toMatchObject({ status: 'unsupported', message: expect.stringContaining('单机') });
        expect(command).toHaveBeenCalledWith({ hello: 1 }); expect(mocks.transaction).not.toHaveBeenCalled();
        command.mockResolvedValue({ setName: 'rs0' });
        expect((await previewResearchBackupImport(JSON.stringify(source))).capability?.status).toBe('supported');
    });
});
