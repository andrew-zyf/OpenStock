import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ResearchChangeState } from '@/database/models/research-change.model';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), aggregate: vi.fn(), histories: vi.fn(), states: vi.fn(), create: vi.fn(), update: vi.fn(), lifecycle: vi.fn(), duePlans: vi.fn(), facts: vi.fn() }));
vi.mock('@/lib/manual-plan-store', () => ({ listDueManualPlans: mocks.duePlans }));
vi.mock('@/lib/actions/research-facts.actions', () => ({ getResearchFacts: mocks.facts }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { aggregate: mocks.aggregate } }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/lib/watchlist-lifecycle', () => ({ withWatchlistLifecycle: mocks.lifecycle }));
vi.mock('@/database/models/research-change.model', () => ({
    ResearchEventHistoryRecord: { find: mocks.histories },
    ResearchChangeStateRecord: { find: mocks.states, create: mocks.create, updateOne: mocks.update },
}));
import { getResearchChanges, setResearchChangeState } from '@/lib/actions/research-changes.actions';

const now = new Date('2026-11-08T01:00:00.000Z');
const owner = { _id: 'owner', symbol: '600519.SH', company: '贵州茅台', addedAt: now, nextReviewDate: '2026-11-08', journal: [
    { kind: 'observation', id: 'baseline', source: 'legacy-capture', modifiedAt: null, recordedAt: '2026-11-07T00:00:00.000Z', observation: { reviewStatus: 'watching', note: '旧观点' } },
    { kind: 'observation', id: 'edit', source: 'edit', modifiedAt: '2026-11-08T00:00:00.000Z', recordedAt: '2026-11-08T00:00:00.000Z', observation: { reviewStatus: 'watching', note: '新观点', nextReviewDate: '2026-11-08' } },
] };
const plan = { id: 'plan-unwatched', symbol: 'AAPL', waitingCondition: '等待财报', invalidation: '利润率下降', nextAction: '核对利润',
    checkDate: '2026-11-07', manualState: 'waiting', scheduleRevision: 1, version: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
const fact = { id: 'fact-original', symbol: 'AAPL', title: '人工登记财报', factText: '原文', factType: 'earnings', reportingPeriod: '2026Q3',
    sourceUrl: 'https://example.com/report', sourcePublishedAt: null, version: 1, createdAt: '2026-11-07T00:00:00.000Z', correctionOf: null };
let states: ResearchChangeState[];
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); states = [];
    mocks.auth.mockResolvedValue('user-a'); mocks.connect.mockResolvedValue(undefined);
    mocks.duePlans.mockResolvedValue({ plans: [], truncated: false }); mocks.facts.mockResolvedValue({ facts: [] });
    mocks.lifecycle.mockImplementation(async (_userId, _intent, callback) => callback());
    mocks.aggregate.mockResolvedValue([structuredClone(owner)]);
    mocks.histories.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) });
    mocks.states.mockImplementation((filter) => ({ limit: () => ({ lean: async () => states.filter((state) => state.userId === filter.userId && filter.changeId.$in.includes(state.changeId)) }) }));
    mocks.create.mockImplementation(async (saved: ResearchChangeState) => {
        if (states.some((state) => state.userId === saved.userId && state.changeId === saved.changeId)) throw { code: 11000 };
        states.push(saved); return saved;
    });
    mocks.update.mockImplementation(async (filter, update) => {
        const index = states.findIndex((state) => state.userId === filter.userId && state.changeId === filter.changeId && state.revision === filter.revision);
        if (index < 0) return { matchedCount: 0 };
        states[index] = update.$set; return { matchedCount: 1 };
    });
});
afterEach(() => vi.useRealTimers());

describe('authenticated persisted change inbox', () => {
    it('authenticates both read and mutation before querying or accepting client IDs', async () => {
        mocks.auth.mockRejectedValue(new Error('Unauthorized'));
        await expect(getResearchChanges()).rejects.toThrow('Unauthorized');
        await expect(setResearchChangeState({ id: 'bad', status: 'ignored', expectedStateVersion: 0 })).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.aggregate).not.toHaveBeenCalled();
        expect(mocks.lifecycle).not.toHaveBeenCalled();
    });
    it('stops before raw alias reads when lifecycle coordination cannot provide a consistent snapshot', async () => {
        mocks.lifecycle.mockRejectedValueOnce(new Error('研究记录正在处理其他请求，请稍后重试'));
        const result = await getResearchChanges({ category: 'own-edit' });
        expect(result).toMatchObject({ entries: [], readStatus: 'read-failed', readIssues: [{ scope: 'research', message: expect.stringContaining('协调状态未核对') }] });
        expect(mocks.aggregate).not.toHaveBeenCalled();
        expect(mocks.histories).not.toHaveBeenCalled(); expect(mocks.states).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
    it('uses active user-scoped bounded journal reads and never writes during inbox reads', async () => {
        const result = await getResearchChanges();
        expect(result.entries).toHaveLength(2);
        expect(mocks.lifecycle).toHaveBeenCalledWith('user-a', { operation: 'research-changes-journal', readOnly: true }, expect.any(Function));
        expect(mocks.lifecycle.mock.invocationCallOrder[0]).toBeLessThan(mocks.aggregate.mock.invocationCallOrder[0]);
        expect(mocks.aggregate.mock.calls[0][0]).toContainEqual({ $match: { userId: 'user-a', archivedAt: null } });
        expect(mocks.aggregate.mock.calls[0][0]).toContainEqual({ $limit: 101 });
        expect(mocks.histories).toHaveBeenCalledWith({ userId: 'user-a', symbol: { $in: ['600519.SS'] } });
        expect(mocks.states).toHaveBeenCalledWith({ userId: 'user-a', changeId: { $in: expect.any(Array) } });
        expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
        expect(result.limitations.join(' ')).toContain('不能解释为没有变化');
    });
    it('persists concrete version handling and shows the same saved state across reads', async () => {
        const [entry] = (await getResearchChanges()).entries;
        const result = await setResearchChangeState({ id: entry.id, status: 'processed', expectedStateVersion: 0 });
        expect(result).toMatchObject({ id: entry.id, status: 'processed', stateVersion: 1 });
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', changeId: entry.id }));
        expect((await getResearchChanges()).entries.some((change) => change.id === entry.id)).toBe(false);
        expect((await getResearchChanges({ includeHandled: true })).entries.find((change) => change.id === entry.id)?.status).toBe('processed');
    });
    it('isolates state by user and rejects unknown versions rather than creating arbitrary handling rows', async () => {
        const [entry] = (await getResearchChanges()).entries;
        states.push({ userId: 'user-b', changeId: entry.id, status: 'ignored', revision: 1, updatedAt: now });
        expect((await getResearchChanges()).entries.find((change) => change.id === entry.id)?.status).toBe('pending');
        mocks.aggregate.mockResolvedValue([]);
        await expect(setResearchChangeState({ id: entry.id, status: 'ignored', expectedStateVersion: 0 })).rejects.toThrow('未找到');
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('rejects concurrent stale state writes and accepts the next concrete state revision', async () => {
        const [entry] = (await getResearchChanges()).entries;
        await setResearchChangeState({ id: entry.id, status: 'ignored', expectedStateVersion: 0 });
        await expect(setResearchChangeState({ id: entry.id, status: 'processed', expectedStateVersion: 0 })).rejects.toThrow('其他页面');
        const result = await setResearchChangeState({ id: entry.id, status: 'pending', expectedStateVersion: 1 });
        expect(result.stateVersion).toBe(2);
        expect(mocks.update.mock.calls[0][0]).toEqual({ userId: 'user-a', changeId: entry.id, revision: 1 });
        await expect(setResearchChangeState({ id: entry.id, status: 'processed', expectedStateVersion: 1 })).rejects.toThrow('其他页面');
    });
    it('does not swallow a new observation revision or changed due plan after an old ignored fact', async () => {
        const initial = (await getResearchChanges()).entries;
        for (const entry of initial) await setResearchChangeState({ id: entry.id, status: 'ignored', expectedStateVersion: 0 });
        const next = structuredClone(owner);
        next.nextReviewDate = '2026-11-07';
        next.journal.push({ ...next.journal[1], id: 'new-edit', modifiedAt: now.toISOString(), recordedAt: now.toISOString(), observation: { reviewStatus: 'watching', note: '新增事实', nextReviewDate: '2026-11-07' } });
        mocks.aggregate.mockResolvedValue([next]);
        const entries = (await getResearchChanges()).entries;
        expect(entries.map((entry) => entry.kind).sort()).toEqual(['observation', 'review-due']);
        expect(entries.every((entry) => !initial.some((old) => old.id === entry.id))).toBe(true);
    });
    it.each(['processed', 'ignored'] as const)('retains %s due-plan state after 102 reviews push all observation revisions out of the journal tail', async (status) => {
        const original = { ...owner, observationUpdatedAt: now };
        mocks.aggregate.mockResolvedValue([original]);
        const due = (await getResearchChanges()).entries.find((entry) => entry.kind === 'review-due')!;
        await setResearchChangeState({ id: due.id, status, expectedStateVersion: 0 });
        const reviews = Array.from({ length: 102 }, (_, index) => ({
            kind: 'review', id: `review-${index}`, createdAt: now.toISOString(), tradingDate: '2026-11-08',
            hypothesis: '观点', changes: '无新增计划', conclusion: '继续核查', verificationType: 'judgment',
            evidenceURLs: [], clientRequestId: `request-${index}`,
        }));
        mocks.aggregate.mockResolvedValue([{ ...original, journal: [...original.journal, ...reviews].slice(-101), journalTruncated: true }]);
        expect((await getResearchChanges()).entries.some((entry) => entry.kind === 'review-due')).toBe(false);
        const retained = (await getResearchChanges({ includeHandled: true })).entries.find((entry) => entry.kind === 'review-due');
        expect(retained).toMatchObject({ id: due.id, discoveredAt: due.discoveredAt, status, stateVersion: 1 });
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('snoozes until concrete time and then returns pending without a mutation on read', async () => {
        const [entry] = (await getResearchChanges()).entries;
        await setResearchChangeState({ id: entry.id, status: 'snoozed', snoozedUntil: '2026-11-09T01:00:00.000Z', expectedStateVersion: 0 });
        expect((await getResearchChanges()).entries.some((change) => change.id === entry.id)).toBe(false);
        vi.setSystemTime(new Date('2026-11-10T01:00:00.000Z'));
        expect((await getResearchChanges()).entries.find((change) => change.id === entry.id)).toMatchObject({ status: 'pending', stateVersion: 1 });
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('filters handled versions before limiting the visible pending entries and signals clipped history', async () => {
        const initial = (await getResearchChanges()).entries;
        const first = initial[0];
        await setResearchChangeState({ id: first.id, status: 'processed', expectedStateVersion: 0 });
        mocks.aggregate.mockResolvedValue([{ ...owner, journalTruncated: true }]);
        const result = await getResearchChanges({ limit: 1 });
        expect(result.entries).toHaveLength(1); expect(result.entries[0].id).not.toBe(first.id);
        expect(result.truncated).toBe(true);
    });
    it('reads independent unwatched or archived due plans without reading any unrelated category', async () => {
        mocks.lifecycle.mockRejectedValue(new Error('unrelated maintenance'));
        mocks.duePlans.mockResolvedValue({ plans: [plan], truncated: false });
        const result = await getResearchChanges({ category: 'plan-due', limit: 1 });
        expect(result).toMatchObject({ readStatus: 'read', truncated: false, entries: [{ kind: 'manual-plan-due', symbol: 'AAPL', planId: plan.id }] });
        expect(mocks.duePlans).toHaveBeenCalledWith('user-a', now);
        expect(mocks.aggregate).not.toHaveBeenCalled(); expect(mocks.histories).not.toHaveBeenCalled(); expect(mocks.facts).not.toHaveBeenCalled();
    });
    it('keeps plan handling across text edits and snooze expiry, while rescheduling creates a fresh concrete version', async () => {
        mocks.duePlans.mockResolvedValue({ plans: [plan], truncated: false });
        const [due] = (await getResearchChanges({ category: 'plan-due' })).entries;
        await setResearchChangeState({ id: due.id, status: 'snoozed', snoozedUntil: '2026-11-09T01:00:00.000Z', expectedStateVersion: 0 });
        mocks.duePlans.mockResolvedValue({ plans: [{ ...plan, version: 2, waitingCondition: '补充文字', updatedAt: now.toISOString() }], truncated: false });
        expect((await getResearchChanges({ category: 'plan-due' })).entries).toEqual([]);
        vi.setSystemTime(new Date('2026-11-10T01:00:00.000Z'));
        expect((await getResearchChanges({ category: 'plan-due' })).entries[0]).toMatchObject({ id: due.id, status: 'pending', stateVersion: 1 });
        mocks.duePlans.mockResolvedValue({ plans: [{ ...plan, version: 3, scheduleRevision: 2, checkDate: '2026-11-08' }], truncated: false });
        const [rescheduled] = (await getResearchChanges({ category: 'plan-due' })).entries;
        expect(rescheduled.id).not.toBe(due.id); expect(rescheduled.stateVersion).toBe(0);
        expect(plan).toMatchObject({ checkDate: '2026-11-07', manualState: 'waiting', version: 1 });
        expect(mocks.aggregate).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
    it.each(['external-fact', 'plan-due', 'review-due'] as const)('filters %s before the visible limit despite many newer own edits', async (category) => {
        const edits = Array.from({ length: 100 }, (_, index) => ({ ...owner.journal[1], id: `edit-${index}`, recordedAt: new Date(now.getTime() + index * 1000).toISOString(), observation: { ...owner.journal[1].observation, note: `new-${index}` } }));
        mocks.aggregate.mockResolvedValue([{ ...owner, journal: [owner.journal[0], ...edits] }]);
        mocks.duePlans.mockResolvedValue({ plans: [plan], truncated: false }); mocks.facts.mockResolvedValue({ facts: [fact] });
        const result = await getResearchChanges({ category, limit: 1 });
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].kind).toBe({ 'external-fact': 'manual-fact', 'plan-due': 'manual-plan-due', 'review-due': 'review-due' }[category]);
        expect(result.truncated).toBe(false);
    });
    it('maps manual facts independently of membership, preserves old correction versions and their handling', async () => {
        mocks.aggregate.mockResolvedValue([]); mocks.facts.mockResolvedValue({ facts: [fact] });
        const [original] = (await getResearchChanges({ category: 'external-fact' })).entries;
        expect(original).toMatchObject({ kind: 'manual-fact', factId: fact.id, source: '人工登记事实（未经自动核验）', sourceUrl: fact.sourceUrl });
        await setResearchChangeState({ id: original.id, status: 'ignored', expectedStateVersion: 0 });
        mocks.facts.mockResolvedValue({ facts: [{ ...fact, id: 'fact-correction', version: 2, correctionOf: fact.id }, fact] });
        const current = await getResearchChanges({ category: 'external-fact', includeHandled: true });
        expect(current.entries).toHaveLength(2);
        expect(current.entries.find(entry => entry.id === original.id)?.status).toBe('ignored');
        expect(current.entries.find(entry => entry.factId === 'fact-correction')).toMatchObject({ status: 'pending', stateVersion: 0 });
        expect(mocks.facts).toHaveBeenCalledWith({ limit: 50 });
    });
    it('truthfully signals bounded plans and fact pages', async () => {
        mocks.duePlans.mockResolvedValue({ plans: [plan], truncated: true });
        expect((await getResearchChanges({ category: 'plan-due' })).truncated).toBe(true);
        mocks.facts.mockResolvedValue({ facts: [fact], nextCursor: 'more' });
        expect((await getResearchChanges({ category: 'external-fact' })).truncated).toBe(true);
    });
    it('returns production-safe scoped read failures and preserves independent readable categories', async () => {
        mocks.lifecycle.mockRejectedValue(new Error('secret raw coordinator detail'));
        mocks.duePlans.mockResolvedValue({ plans: [plan], truncated: false }); mocks.facts.mockRejectedValue(new Error('secret DB detail'));
        const result = await getResearchChanges();
        expect(result).toMatchObject({ readStatus: 'partial', entries: [{ planId: plan.id }], readIssues: [{ scope: 'research' }, { scope: 'facts' }] });
        expect(JSON.stringify(result)).not.toContain('secret');
        mocks.duePlans.mockRejectedValue(new Error('plans unavailable'));
        expect(await getResearchChanges({ category: 'plan-due' })).toMatchObject({ entries: [], readStatus: 'read-failed', readIssues: [{ scope: 'plans' }] });
    });
    it('distinguishes unread handling from pending and sanitizes database failures', async () => {
        mocks.states.mockImplementation(() => ({ limit: () => ({ lean: async () => { throw new Error('secret'); } }) }));
        expect(await getResearchChanges({ category: 'review-due' })).toMatchObject({ entries: [], readStatus: 'read-failed', readIssues: [{ scope: 'handling' }] });
        mocks.connect.mockRejectedValue(new Error('secret connection'));
        const result = await getResearchChanges();
        expect(result.readStatus).toBe('read-failed'); expect(JSON.stringify(result)).not.toContain('secret');
    });
    it('rejects unbounded options and malformed snooze inputs before database work', async () => {
        await expect(getResearchChanges({ limit: 101 })).rejects.toThrow();
        await expect(getResearchChanges({ category: 'unknown' as 'own-edit' })).rejects.toThrow();
        await expect(setResearchChangeState({ id: 'review-due:' + 'a'.repeat(64), status: 'snoozed', expectedStateVersion: 0, snoozedUntil: now.toISOString() })).rejects.toThrow();
        expect(mocks.connect).not.toHaveBeenCalled();
    });
});
