import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    auth: vi.fn(), connect: vi.fn(), lifecycle: vi.fn(), coordination: vi.fn(), research: vi.fn(), plans: vi.fn(), hello: vi.fn(), write: vi.fn(),
}));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/lib/watchlist-lifecycle', async (original) => ({ ...await original<Record<string, unknown>>(), withWatchlistLifecycle: mocks.lifecycle }));
vi.mock('@/database/models/watchlist.model', () => ({
    Watchlist: { aggregate: mocks.research, find: vi.fn(() => { throw new Error('Do not load journals'); }) },
    WatchlistLifecycle: { aggregate: mocks.coordination, updateOne: mocks.write, findOneAndUpdate: mocks.write },
}));
vi.mock('@/database/models/manual-plan.model', () => ({ ManualPlanBook: { aggregate: mocks.plans } }));

import { getResearchMaintenanceStatus } from '@/lib/actions/research-maintenance.actions';
import { WatchlistLifecycleError } from '@/lib/watchlist-lifecycle';

type Pipeline = Record<string, unknown>[];
type Row = Record<string, unknown>;
const time = new Date('2026-11-08T01:00:00.000Z');
const id = '111111111111111111111111';
const options: Record<string, unknown>[] = [];
function query(rows: Row[] | Error) {
    return { option: vi.fn(function (this: unknown, option: Record<string, unknown>) { options.push(option); return this; }),
        exec: vi.fn(() => rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)) };
}
beforeEach(() => {
    vi.clearAllMocks(); options.length = 0;
    mocks.auth.mockResolvedValue('current-owner');
    mocks.connect.mockResolvedValue({ connection: { db: { admin: () => ({ command: mocks.hello }) } } });
    mocks.hello.mockResolvedValue({ ok: 1, maxWireVersion: 17, logicalSessionTimeoutMinutes: 30, setName: 'private-replica-name' });
    mocks.coordination.mockImplementation(() => query([]));
    mocks.research.mockImplementation(() => query([]));
    mocks.plans.mockImplementation(() => query([]));
    mocks.lifecycle.mockImplementation(async (_owner, _intent, run: () => Promise<unknown>) => run());
});

describe('owner-only research maintenance diagnostics', () => {
    it('authenticates before connection or any metadata read and accepts no owner override', async () => {
        mocks.auth.mockRejectedValueOnce(new Error('Unauthorized'));
        await expect(getResearchMaintenanceStatus()).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.coordination).not.toHaveBeenCalled(); expect(mocks.hello).not.toHaveBeenCalled();
    });

    it('scopes every read to the authenticated owner and returns only projected metadata', async () => {
        const own = { _id: id, userId: 'current-owner', symbol: 'AAPL', bytes: 1234, entries: 9, journal: 'private-notes' };
        const other = { ...own, _id: '222222222222222222222222', userId: 'other-owner', symbol: 'PRIVATE' };
        mocks.research.mockImplementation((pipeline: Pipeline) => query([own, other].filter((row) => row.userId === (pipeline[0].$match as Row).userId)));
        mocks.plans.mockImplementation(() => query([{ _id: id, bytes: 678, entries: 5, clientRequestId: 'secret-request-id' }]));
        const result = await getResearchMaintenanceStatus();
        expect(result).toMatchObject({ state: 'idle', capability: { transactions: true }, capacity: { state: 'ready', truncated: false, documents: [
            { kind: 'research', id, symbol: 'AAPL', bytes: 1234, entries: 9 }, { kind: 'manual-plans', id, symbol: null, bytes: 678, entries: 5 },
        ] } });
        expect(mocks.coordination.mock.calls[0][0][0]).toEqual({ $match: { _id: 'current-owner' } });
        expect(mocks.research.mock.calls[0][0][0]).toEqual({ $match: { userId: 'current-owner' } });
        expect(mocks.plans.mock.calls[0][0][0]).toEqual({ $match: { userId: 'current-owner' } });
        expect(JSON.stringify(result)).not.toMatch(/private|PRIVATE|current-owner|other-owner|secret/);
        expect(mocks.lifecycle).toHaveBeenCalledWith('current-owner', { operation: 'research-capacity-read', readOnly: true }, expect.any(Function));
        expect(mocks.write).not.toHaveBeenCalled();
    });

    it.each([
        { hasLock: true, maintenanceRequired: false, state: 'busy' },
        { hasLock: true, maintenanceRequired: true, state: 'maintenance' },
        { hasLock: false, maintenanceRequired: true, state: 'maintenance' },
        { hasLock: false, maintenanceRequired: 'invalid', state: 'unknown' },
        { hasLock: 'invalid', maintenanceRequired: false, state: 'unknown' },
    ])('reports $state without acquiring a blocked lock or reading capacity', async ({ state, ...row }) => {
        mocks.coordination.mockImplementation(() => query([{ ...row, operation: 'review', acquiredAt: time }]));
        const result = await getResearchMaintenanceStatus();
        expect(result).toMatchObject({ state, operationLabel: '追加复核', startedAt: time.toISOString(), capacity: { state: 'skipped', documents: [] } });
        expect(mocks.lifecycle).not.toHaveBeenCalled(); expect(mocks.research).not.toHaveBeenCalled(); expect(mocks.plans).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
    });

    it.each([
        ['manual-plan-list', '读取人工计划列表'], ['manual-plan-read', '读取人工计划'],
        ['manual-plan-create', '新建人工计划'], ['manual-plan-update', '修改人工计划'],
        ['manual-plan-schedule-history', '读取计划日期调整记录'], ['manual-plan-due', '读取到期人工计划'],
    ])('labels the observed %s coordination intent without exposing raw metadata', async (operation, operationLabel) => {
        mocks.coordination.mockImplementation(() => query([{ hasLock: true, operation, acquiredAt: time }]));
        expect(await getResearchMaintenanceStatus()).toMatchObject({ state: 'busy', operationLabel, capacity: { state: 'skipped' } });
        expect(mocks.lifecycle).not.toHaveBeenCalled();
    });

    it('never includes tokens, raw operation strings, symbols, errors or invalid dates in coordination output', async () => {
        mocks.coordination.mockImplementation(() => query([{ hasLock: true, operation: 'mongodb://secret-token', acquiredAt: new Date('invalid'), symbol: 'PRIVATE', lockToken: 'private-token', maintenanceRequired: false }]));
        const result = await getResearchMaintenanceStatus();
        expect(result).toMatchObject({ state: 'busy', operationLabel: '其他研究操作', startedAt: null });
        expect(JSON.stringify(result)).not.toMatch(/mongo|secret|PRIVATE|private|lockToken/);
        const projection = mocks.coordination.mock.calls[0][0].at(-1).$project;
        expect(projection.lockToken).toBeUndefined(); expect(projection.symbol).toBeUndefined();
        expect(projection.hasLock).toEqual({ $ne: [{ $ifNull: ['$lockToken', null] }, null] });
    });

    it.each([[time.toISOString(), time.toISOString()], ['2026-02-30T01:00:00.000Z', null], ['private-token', null]])('only returns valid canonical startedAt metadata %#', async (acquiredAt, startedAt) => {
        mocks.coordination.mockImplementation(() => query([{ hasLock: true, operation: 'review', acquiredAt }]));
        expect((await getResearchMaintenanceStatus()).startedAt).toBe(startedAt);
    });

    it('does not reuse stale intent or timestamp when the lock is idle', async () => {
        mocks.coordination.mockImplementation(() => query([{ hasLock: false, operation: 'review', acquiredAt: time }]));
        expect(await getResearchMaintenanceStatus()).toMatchObject({ state: 'idle', operationLabel: null, startedAt: null });
    });

    it('returns unknown on connection and coordination failures without leaking driver errors', async () => {
        mocks.connect.mockRejectedValueOnce(new Error('mongodb://private-db/secret'));
        const unavailable = await getResearchMaintenanceStatus();
        expect(unavailable).toMatchObject({ state: 'unknown', capability: { transactions: null }, capacity: { state: 'skipped' } });
        mocks.coordination.mockImplementation(() => query(new Error('private-token')));
        const unknown = await getResearchMaintenanceStatus();
        expect(unknown.state).toBe('unknown'); expect(mocks.lifecycle).not.toHaveBeenCalled();
        expect(JSON.stringify([unavailable, unknown])).not.toMatch(/mongo|private|secret/);
    });

    it.each([
        [{ ok: 1, maxWireVersion: 17 }, false],
        [{ ok: 1, maxWireVersion: 17, logicalSessionTimeoutMinutes: 30, msg: 'isdbgrid' }, true],
        [{ ok: 1, maxWireVersion: 6, logicalSessionTimeoutMinutes: 30, setName: 'replica' }, false],
        [{ ok: 0, maxWireVersion: 17 }, null],
        [{ ok: 1 }, null],
        [{ ok: 1, maxWireVersion: Number.NaN }, null],
    ])('distinguishes topology evidence from unknown hello results %#', async (hello, transactions) => {
        mocks.hello.mockResolvedValue(hello);
        expect((await getResearchMaintenanceStatus()).capability.transactions).toBe(transactions);
        expect(mocks.hello).toHaveBeenCalledWith({ hello: 1 }, { timeoutMS: 1500 });
        expect(mocks.write).not.toHaveBeenCalled();
    });

    it('keeps capability unknown on hello errors and enforces a bounded timeout', async () => {
        mocks.hello.mockRejectedValueOnce(new Error('private-connection-details'));
        expect((await getResearchMaintenanceStatus()).capability.transactions).toBeNull();
        vi.useFakeTimers();
        try {
            mocks.hello.mockImplementationOnce(() => new Promise(() => {}));
            const pending = getResearchMaintenanceStatus();
            await vi.advanceTimersByTimeAsync(1501);
            expect((await pending).capability.transactions).toBeNull();
        } finally { vi.useRealTimers(); }
    });

    it('bounds capacity rows and computes BSON sizes and counts server-side before returning metadata', async () => {
        mocks.research.mockImplementation(() => query(Array.from({ length: 51 }, (_, i) => ({ _id: i.toString(16).padStart(24, '0'), symbol: 'AAPL', bytes: 12000, entries: i }))));
        const result = await getResearchMaintenanceStatus();
        expect(result.capacity.documents).toHaveLength(50); expect(result.capacity.truncated).toBe(true);
        const pipeline = mocks.research.mock.calls[0][0];
        expect(pipeline[1]).toEqual({ $limit: 51 });
        expect(pipeline[2].$project.bytes).toEqual({ $bsonSize: '$$ROOT' });
        expect(pipeline[2].$project.entries).toEqual({ $cond: [{ $isArray: '$journal' }, { $size: '$journal' }, null] });
        expect(mocks.plans.mock.calls[0][0][1]).toEqual({ $limit: 1 });
        expect(options.every((option) => option.maxTimeMS === 1500)).toBe(true);
    });

    it('reports unknown capacity after a failed metadata read and discards partial results', async () => {
        mocks.research.mockImplementation(() => query([{ _id: id, bytes: 42, entries: 2, symbol: 'AAPL' }]));
        mocks.plans.mockImplementation(() => query(new Error('private failure')));
        const result = await getResearchMaintenanceStatus();
        expect(result).toMatchObject({ state: 'idle', capacity: { state: 'unknown', documents: [] } });
        expect(JSON.stringify(result)).not.toContain('private');
    });

    it('rechecks coordination if a new holder wins before capacity acquisition', async () => {
        mocks.coordination.mockImplementationOnce(() => query([])).mockImplementationOnce(() => query([{ hasLock: true, maintenanceRequired: true, operation: 'observation', acquiredAt: time }]));
        mocks.lifecycle.mockRejectedValueOnce(new WatchlistLifecycleError('LIFECYCLE_MAINTENANCE'));
        const result = await getResearchMaintenanceStatus();
        expect(result).toMatchObject({ state: 'maintenance', operationLabel: '保存观察', capacity: { state: 'unknown', documents: [] } });
        expect(mocks.research).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
    });
});
