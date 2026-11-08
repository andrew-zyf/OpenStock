import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ResearchChangeState } from '@/database/models/research-change.model';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), aggregate: vi.fn(), histories: vi.fn(), states: vi.fn(), create: vi.fn(), update: vi.fn(), lifecycle: vi.fn() }));
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
let states: ResearchChangeState[];
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); states = [];
    mocks.auth.mockResolvedValue('user-a'); mocks.connect.mockResolvedValue(undefined);
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
        await expect(getResearchChanges()).rejects.toThrow('正在处理其他请求');
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
    it('rejects unbounded options and malformed snooze inputs before database work', async () => {
        await expect(getResearchChanges({ limit: 101 })).rejects.toThrow();
        await expect(setResearchChangeState({ id: 'review-due:' + 'a'.repeat(64), status: 'snoozed', expectedStateVersion: 0, snoozedUntil: now.toISOString() })).rejects.toThrow();
        expect(mocks.connect).not.toHaveBeenCalled();
    });
});
