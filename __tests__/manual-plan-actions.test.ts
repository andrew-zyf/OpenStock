import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BSON } from 'mongodb';
import type { StoredManualPlan, StoredManualPlanRecord, StoredManualPlanSchedule } from '@/database/models/manual-plan.model';
import { manualPlanFingerprint, validateCreateManualPlan, type CreateManualPlanInput, type ManualPlan, type ManualPlanResult } from '@/lib/manual-plan';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), bookFind: vi.fn(), recordFind: vi.fn(), recordOne: vi.fn(), recordCount: vi.fn(), recordCreate: vi.fn(), recordUpdate: vi.fn(), scheduleFind: vi.fn(), scheduleCreate: vi.fn(), observation: vi.fn(), lock: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/models/manual-plan.model', () => ({
    ManualPlanBook: { findOne: mocks.bookFind },
    ManualPlanRecord: { find: mocks.recordFind, findOne: mocks.recordOne, countDocuments: mocks.recordCount, create: mocks.recordCreate, findOneAndUpdate: mocks.recordUpdate },
    ManualPlanSchedule: { find: mocks.scheduleFind, create: mocks.scheduleCreate },
}));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { findOne: mocks.observation } }));
vi.mock('@/lib/watchlist-lifecycle', async (original) => ({ ...await original<typeof import('@/lib/watchlist-lifecycle')>(), withWatchlistLifecycle: mocks.lock }));
import { createManualPlan, getManualPlan, getManualPlans, getManualPlanScheduleHistory, updateManualPlan } from '@/lib/actions/manual-plan.actions';
import { listDueManualPlans } from '@/lib/manual-plan-store';
import { WatchlistLifecycleError } from '@/lib/watchlist-lifecycle';

type Row = Record<string, unknown>;
const books = new Map<string, { userId: string; plans: StoredManualPlan[] }>();
const records: StoredManualPlanRecord[] = [];
const schedules: StoredManualPlanSchedule[] = [];
const owners = new Map<string, Promise<unknown>>();
const maintenance = new Set<string>();
const input: CreateManualPlanInput = { symbol: 'HKEX:700', waitingCondition: '等待公告', invalidation: '假设不再成立', nextAction: '人工核对原始资料', checkDate: '2026-11-10', clientRequestId: 'request-123' };
const id = '11111111-1111-4111-8111-111111111111';
const identifier = (index: number) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
function stored(overrides: Partial<StoredManualPlan> = {}): StoredManualPlan {
    const value = validateCreateManualPlan(input);
    return { ...value, id, createFingerprint: manualPlanFingerprint(value), version: 1, manualState: 'waiting', createdAt: new Date('2026-11-08T01:00:00Z'), updatedAt: new Date('2026-11-08T01:00:00Z'), ...overrides };
}
const scalar = (value: unknown): string | number => value instanceof Date ? value.getTime() : value as string | number;
function matches(row: Row, filter: Row): boolean {
    return Object.entries(filter).every(([key, expected]) => {
        if (key === '$or') return (expected as Row[]).some((clause) => matches(row, clause));
        if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
            const operators = expected as Row;
            return Object.entries(operators).every(([operator, target]) => operator === '$in' ? (target as unknown[]).includes(row[key])
                : operator === '$lt' ? scalar(row[key]) < scalar(target)
                    : operator === '$lte' ? scalar(row[key]) <= scalar(target)
                        : operator === '$gt' ? scalar(row[key]) > scalar(target) : false);
        }
        return scalar(row[key]) === scalar(expected);
    });
}
function query<T>(read: () => T[]) {
    let order: Record<string, number> = {};
    let limit = Infinity;
    const result = {
        select: vi.fn(() => result),
        sort: vi.fn((value: Record<string, number>) => { order = value; return result; }),
        limit: vi.fn((value: number) => { limit = value; return result; }),
        lean: async () => structuredClone(read().sort((a, b) => {
            for (const [key, direction] of Object.entries(order)) {
                const av = scalar((a as Row)[key]); const bv = scalar((b as Row)[key]);
                if (av !== bv) return (av < bv ? -1 : 1) * direction;
            }
            return 0;
        }).slice(0, limit)),
    };
    return result;
}
async function created(value: CreateManualPlanInput = input): Promise<ManualPlan> {
    const result = await createManualPlan(value);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    return result.plan;
}
function successful<T>(result: ManualPlanResult<T>): asserts result is { success: true } & T { expect(result.success).toBe(true); }

beforeEach(() => {
    vi.clearAllMocks(); books.clear(); records.length = 0; schedules.length = 0; owners.clear(); maintenance.clear();
    mocks.auth.mockResolvedValue('user-a'); mocks.connect.mockResolvedValue(undefined);
    // Model doubles apply actual owner/version predicates. The lock models the shared user mutex,
    // including fail-closed writes, instead of making concurrent capacity tests artificially sequential.
    mocks.lock.mockImplementation(async (userId: string, intent: { readOnly?: boolean }, operation: () => Promise<unknown>) => {
        const before = owners.get(userId) ?? Promise.resolve();
        const next = before.catch(() => undefined).then(async () => {
            if (maintenance.has(userId)) throw new WatchlistLifecycleError('LIFECYCLE_MAINTENANCE');
            try { return await operation(); }
            catch (error) {
                if (intent.readOnly) throw error;
                maintenance.add(userId); throw new WatchlistLifecycleError('LIFECYCLE_MAINTENANCE');
            }
        });
        owners.set(userId, next); return next;
    });
    mocks.bookFind.mockImplementation((filter: Row) => ({ lean: async () => {
        const book = books.get(filter.userId as string);
        if (!book || filter['plans.id'] && !book.plans.some((plan) => plan.id === filter['plans.id'])
            || filter['plans.clientRequestId'] && !book.plans.some((plan) => plan.clientRequestId === filter['plans.clientRequestId'])) return null;
        return structuredClone(book);
    } }));
    mocks.recordFind.mockImplementation((filter: Row) => query(() => records.filter((row) => matches(row, filter))));
    mocks.recordOne.mockImplementation((filter: Row) => ({ lean: async () => structuredClone(records.find((row) => matches(row, filter)) ?? null) }));
    mocks.recordCount.mockImplementation(async (filter: Row) => records.filter((row) => matches(row, filter)).length);
    mocks.recordCreate.mockImplementation(async (row: StoredManualPlanRecord) => {
        if (records.some((old) => old.userId === row.userId && (old.id === row.id || old.clientRequestId === row.clientRequestId))) throw { code: 11000 };
        records.push(structuredClone(row)); return row;
    });
    mocks.recordUpdate.mockImplementation((filter: Row, update: { $set: Row }) => ({ lean: async () => {
        const row = records.find((row) => matches(row, filter));
        if (!row) return null;
        Object.assign(row, structuredClone(update.$set)); return structuredClone(row);
    } }));
    mocks.scheduleFind.mockImplementation((filter: Row) => query(() => schedules.filter((row) => matches(row, filter))));
    mocks.scheduleCreate.mockImplementation(async (row: StoredManualPlanSchedule) => { schedules.push(structuredClone(row)); return row; });
    mocks.observation.mockReturnValue({ select: () => ({ lean: async () => null }) });
});

describe('authenticated standalone manual plan records and legacy compatibility', () => {
    it('creates canonical standalone waiting plans without growing a BSON book', async () => {
        const plan = await created();
        expect(plan).toMatchObject({ symbol: '00700.HK', manualState: 'waiting', version: 1, scheduleRevision: 1, checkDate: '2026-11-10' });
        for (const key of ['userId', 'clientRequestId', 'createFingerprint']) expect(plan).not.toHaveProperty(key);
        expect(books.size).toBe(0); expect(records).toHaveLength(1); expect(mocks.observation).not.toHaveBeenCalled();
        expect(mocks.lock).toHaveBeenCalledWith('user-a', expect.objectContaining({ operation: 'manual-plan-create' }), expect.any(Function));
    });
    it('authenticates reads and mutations before persistence', async () => {
        mocks.auth.mockRejectedValue(new Error('Unauthorized'));
        for (const operation of [() => getManualPlans(), () => getManualPlan(id), () => createManualPlan(input), () => updateManualPlan(id, { manualState: 'cancelled', stateReason: '停止跟进' }, 1), () => getManualPlanScheduleHistory(id)]) await expect(operation()).rejects.toThrow('Unauthorized');
        expect(mocks.lock).not.toHaveBeenCalled(); expect(mocks.bookFind).not.toHaveBeenCalled();
    });
    it('returns expected validation failures as serializable production action results', async () => {
        expect(await createManualPlan({ ...input, checkDate: '2026-02-30' })).toMatchObject({ success: false, code: 'INVALID', error: expect.stringContaining('检查日期') });
        expect(await updateManualPlan(id, { checkDate: '2026-02-30' }, 1)).toMatchObject({ code: 'INVALID' });
        expect(await createManualPlan({ ...input, userId: 'user-b' } as CreateManualPlanInput)).toMatchObject({ code: 'INVALID' });
        for (const version of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) expect(await updateManualPlan(id, { nextAction: '行动' }, version)).toMatchObject({ code: 'INVALID' });
        expect(await updateManualPlan('$bad', { nextAction: '行动' }, 1)).toMatchObject({ code: 'INVALID' });
        for (const options of [{ limit: 0 }, { limit: 51 }, { cursor: '$bad' }, { scope: 'other' }]) expect(await getManualPlans(options as never)).toMatchObject({ code: 'INVALID' });
        expect(mocks.lock).not.toHaveBeenCalled();
    });
    it('isolates record, legacy, retry and schedule reads by authenticated owner', async () => {
        books.set('user-b', { userId: 'user-b', plans: [stored()] });
        records.push({ userId: 'user-b', ...stored({ version: 2 }) });
        expect(await getManualPlans()).toMatchObject({ success: true, plans: [], activeCount: 0 });
        expect(await getManualPlan(id)).toMatchObject({ code: 'NOT_FOUND' });
        expect(await getManualPlanScheduleHistory(id)).toMatchObject({ code: 'NOT_FOUND' });
        expect(await updateManualPlan(id, { nextAction: 'wrong owner' }, 1)).toMatchObject({ code: 'NOT_FOUND' });
        const own = await created(); expect(own.id).not.toBe(id);
        expect(records.find((row) => row.userId === 'user-b')!.version).toBe(2);
    });
    it('deduplicates concurrent canonical retries and returns request conflicts without locking maintenance', async () => {
        const results = await Promise.all([createManualPlan(input), createManualPlan({ ...input, symbol: '0700.HK' }), createManualPlan({ ...input, nextAction: 'different' })]);
        expect(results.filter((result) => result.success)).toHaveLength(2);
        const first = results[0]; const second = results[1]; successful(first); successful(second);
        expect(first.plan.id).toBe(second.plan.id); expect(results[2]).toMatchObject({ code: 'REQUEST_CONFLICT' });
        expect(records).toHaveLength(1); expect(maintenance.size).toBe(0);
    });
    it('preserves legacy IDs and immutable fingerprints after edits and terminal states', async () => {
        const legacy = stored(); books.set('user-a', { userId: 'user-a', plans: [legacy] });
        expect(await created()).toMatchObject({ id, version: 1, scheduleRevision: 1 });
        expect(await updateManualPlan(id, { nextAction: '新的核查', manualState: 'completed', stateReason: '核对原始公告' }, 1)).toMatchObject({ success: true, plan: { id, version: 2, manualState: 'completed' } });
        expect(await created()).toMatchObject({ id, version: 2, nextAction: '新的核查', manualState: 'completed' });
        expect(await createManualPlan({ ...input, nextAction: '新的核查' })).toMatchObject({ code: 'REQUEST_CONFLICT' });
        expect(books.get('user-a')!.plans).toEqual([legacy]); expect(records).toHaveLength(1);
        expect(records[0].createFingerprint).toBe(legacy.createFingerprint);
        const page = await getManualPlans({ scope: 'all' }); successful(page); expect(page.plans).toHaveLength(1); expect(page.activeCount).toBe(0);
    });
    it('keeps 100 terminal legacy plans and permits new active plans', async () => {
        const plans = Array.from({ length: 100 }, (_, index) => stored({ id: identifier(index), clientRequestId: `existing-${index}`, manualState: index % 2 ? 'completed' : 'cancelled' }));
        books.set('user-a', { userId: 'user-a', plans });
        await created();
        const active = await getManualPlans(); successful(active); expect(active.activeCount).toBe(1); expect(active.plans).toHaveLength(1);
        const firstHistory = await getManualPlans({ scope: 'history', limit: 50 }); successful(firstHistory); expect(firstHistory.plans).toHaveLength(50);
        const secondHistory = await getManualPlans({ scope: 'history', limit: 50, cursor: firstHistory.nextCursor }); successful(secondHistory); expect(secondHistory.plans).toHaveLength(50); expect(secondHistory.nextCursor).toBeUndefined();
        expect(new Set([...firstHistory.plans, ...secondHistory.plans].map((plan) => plan.id)).size).toBe(100);
        expect(books.get('user-a')!.plans).toEqual(plans);
    });
    it('caps merged waiting plans at100, and completing a legacy plan frees exactly one slot', async () => {
        books.set('user-a', { userId: 'user-a', plans: Array.from({ length: 100 }, (_, index) => stored({ id: identifier(index), clientRequestId: `existing-${index}` })) });
        expect(await createManualPlan(input)).toMatchObject({ code: 'CAPACITY' });
        expect(await createManualPlan({ ...input, clientRequestId: 'existing-0' })).toMatchObject({ success: true, plan: { id: identifier(0) } });
        expect(await updateManualPlan(identifier(0), { manualState: 'completed', stateReason: '已核查' }, 1)).toMatchObject({ success: true });
        await created();
        expect(await createManualPlan({ ...input, clientRequestId: 'another-request' })).toMatchObject({ code: 'CAPACITY' });
        const page = await getManualPlans({ scope: 'all' }); successful(page); expect(page.activeCount).toBe(100);
        expect(books.get('user-a')!.plans).toHaveLength(100); expect(records).toHaveLength(2);
    });
    it('admits one concurrent create at99 active and rejects concurrent reopening at capacity', async () => {
        records.push(...Array.from({ length: 99 }, (_, index) => ({ userId: 'user-a', ...stored({ id: identifier(index), clientRequestId: `existing-${index}` }) })));
        const results = await Promise.all([createManualPlan(input), createManualPlan({ ...input, clientRequestId: 'another-request' })]);
        expect(results.filter((result) => result.success)).toHaveLength(1); expect(results.find((result) => !result.success)).toMatchObject({ code: 'CAPACITY' });
        records.push({ userId: 'user-a', ...stored({ id, clientRequestId: 'terminal-plan', manualState: 'completed' }) });
        expect(await updateManualPlan(id, { manualState: 'waiting' }, 1)).toMatchObject({ code: 'CAPACITY' });
        expect(records.filter((row) => row.manualState === 'waiting')).toHaveLength(100);
    });
    it('retains more than100 terminal records without consuming active capacity', async () => {
        records.push(...Array.from({ length: 140 }, (_, index) => ({ userId: 'user-a', ...stored({ id: identifier(index), clientRequestId: `history-${index}`, manualState: 'completed' }) })));
        const plan = await created(); expect(records).toHaveLength(141);
        expect(await updateManualPlan(plan.id, { manualState: 'cancelled', stateReason: '停止跟进' }, 1)).toMatchObject({ success: true });
        await created({ ...input, clientRequestId: 'second-active' }); expect(records).toHaveLength(142);
    });
    it('applies owner/version CAS and retains winning content', async () => {
        const plan = await created();
        const results = await Promise.all([updateManualPlan(plan.id, { nextAction: 'winning edit' }, 1), updateManualPlan(plan.id, { manualState: 'cancelled', stateReason: 'cancel' }, 1)]);
        expect(results.filter((result) => result.success)).toHaveLength(1); expect(results.find((result) => !result.success)).toMatchObject({ code: 'CONFLICT' });
        expect(records[0]).toMatchObject({ nextAction: 'winning edit', manualState: 'waiting', version: 2, scheduleRevision: 1 });
        expect(mocks.recordUpdate).toHaveBeenCalledWith({ userId: 'user-a', id: plan.id, version: 1 }, expect.anything(), { new: true, runValidators: true });
    });
    it('requires explicit date/state reasons and keeps due identity stable across ordinary edits', async () => {
        const plan = await created();
        expect(await updateManualPlan(plan.id, { checkDate: '2026-11-11' }, 1)).toMatchObject({ code: 'INVALID' });
        expect(await updateManualPlan(plan.id, { manualState: 'completed' }, 1)).toMatchObject({ code: 'INVALID' });
        expect(await updateManualPlan(plan.id, { nextAction: 'new action', checkDate: plan.checkDate }, 1)).toMatchObject({ success: true, plan: { version: 2, scheduleRevision: 1 } });
        expect(schedules).toHaveLength(0);
        expect(await updateManualPlan(plan.id, { checkDate: '2026-11-11', scheduleReason: '等待年报' }, 2)).toMatchObject({ success: true, plan: { version: 3, scheduleRevision: 2 } });
        expect(schedules).toEqual([{ userId: 'user-a', planId: plan.id, revision: 2, fromDate: '2026-11-10', toDate: '2026-11-11', reason: '等待年报', changedAt: expect.any(Date) }]);
        expect(await updateManualPlan(plan.id, { manualState: 'completed', stateReason: '已核查公告' }, 3)).toMatchObject({ success: true, plan: { scheduleRevision: 2, stateReason: '已核查公告' } });
        expect(await created()).toMatchObject({ id: plan.id, checkDate: '2026-11-11', scheduleRevision: 2 });
    });
    it('merges mixed legacy/record history pages without superseded duplicates and bounds each query', async () => {
        const legacy = Array.from({ length: 30 }, (_, index) => stored({ id: identifier(index), clientRequestId: `legacy-${index}`, manualState: 'completed' }));
        books.set('user-a', { userId: 'user-a', plans: legacy });
        records.push({ userId: 'user-a', ...stored({ id: identifier(5), clientRequestId: 'legacy-5', version: 2, manualState: 'cancelled' }) },
            ...Array.from({ length: 40 }, (_, index) => ({ userId: 'user-a', ...stored({ id: identifier(index + 30), clientRequestId: `record-${index}`, manualState: 'completed' }) })));
        const all: ManualPlan[] = [];
        let cursor: string | undefined;
        do { const result = await getManualPlans({ scope: 'history', limit: 7, ...(cursor ? { cursor } : {}) }); successful(result); all.push(...result.plans); cursor = result.nextCursor; } while (cursor);
        expect(all).toHaveLength(70); expect(new Set(all.map((row) => row.id)).size).toBe(70);
        expect(all.find((row) => row.id === identifier(5))).toMatchObject({ version: 2, manualState: 'cancelled' });
        for (const result of mocks.recordFind.mock.results) {
            const limits = result.value.limit.mock.calls as number[][];
            expect(limits.every(([limit]) => limit <= 51)).toBe(true);
        }
    });
    it('uses Mongo binary identifier order for mixed-case retained IDs at tied timestamps', async () => {
        const ids = ['A', 'a', 'B', 'b'].map((suffix) => `11111111-1111-4111-8111-00000000000${suffix}`);
        books.set('user-a', { userId: 'user-a', plans: ids.slice(0, 2).map((id, index) => stored({ id, clientRequestId: `legacy-case-${index}`, manualState: 'completed' })) });
        records.push(...ids.slice(2).map((id, index) => ({ userId: 'user-a', ...stored({ id, clientRequestId: `record-case-${index}`, manualState: 'completed' }) })));
        const seen: string[] = []; let cursor: string | undefined;
        do { const page = await getManualPlans({ scope: 'history', limit: 1, ...(cursor ? { cursor } : {}) }); successful(page); seen.push(...page.plans.map((row) => row.id)); cursor = page.nextCursor; } while (cursor);
        expect(seen).toEqual([...ids].sort());
    });
    it('paginates schedule reasons and protects their owner', async () => {
        const plan = await created();
        schedules.push(...Array.from({ length: 30 }, (_, index) => ({ userId: 'user-a', planId: plan.id, revision: index + 2, fromDate: '2026-11-10', toDate: '2026-11-11', reason: `reason-${index}`, changedAt: new Date() })));
        const first = await getManualPlanScheduleHistory(plan.id); successful(first); expect(first.history).toHaveLength(25); expect(first.nextCursor).toBe(7);
        const second = await getManualPlanScheduleHistory(plan.id, first.nextCursor); successful(second); expect(second.history).toHaveLength(5); expect(second.nextCursor).toBeUndefined();
        mocks.auth.mockResolvedValue('user-b'); expect(await getManualPlanScheduleHistory(plan.id)).toMatchObject({ code: 'NOT_FOUND' });
    });
    it('verifies optional observation owner/symbol and preserves the referenced original', async () => {
        expect(await createManualPlan({ ...input, observationVersionId: 'other-owner-version' })).toMatchObject({ code: 'NOT_FOUND' });
        mocks.observation.mockReturnValue({ select: () => ({ lean: async () => ({ symbol: 'HKEX:700', journal: [{ kind: 'observation', id: 'own-version', recordedAt: '2026-11-07T01:00:00Z', observation: { note: '旧判断', invalidation: '旧反证' } }] }) }) });
        const result = await createManualPlan({ ...input, observationVersionId: 'own-version' }); successful(result);
        expect(result.plan).toMatchObject({ observationVersionId: 'own-version', observationSnapshot: { note: '旧判断', invalidation: '旧反证' } });
        expect(mocks.observation).toHaveBeenLastCalledWith({ userId: 'user-a', journal: { $elemMatch: { kind: 'observation', id: 'own-version' } } });
        expect(await createManualPlan(input)).toMatchObject({ code: 'REQUEST_CONFLICT' });
    });
    it('preserves long historical observation text and rejects oversized snapshots before writing', async () => {
        const note = '  保留合并判断原文  '.repeat(1000);
        const source = (text: string) => ({ select: () => ({ lean: async () => ({ symbol: '00700.HK', journal: [{ kind: 'observation', id: 'long-version', recordedAt: '2026-11-07T01:00:00Z', observation: { note: text, invalidation: '完整反证'.repeat(1000) } }] }) }) });
        mocks.observation.mockReturnValue(source(note));
        const result = await createManualPlan({ ...input, observationVersionId: 'long-version' }); successful(result);
        expect(result.plan.observationSnapshot?.note).toBe(note); expect(maintenance.size).toBe(0);
        mocks.observation.mockReturnValue(source('x'.repeat(12 * 1024 * 1024)));
        expect(await createManualPlan({ ...input, clientRequestId: 'oversized-snapshot', observationVersionId: 'long-version' })).toMatchObject({ code: 'INVALID', error: expect.stringContaining('原文未截断') });
        expect(records).toHaveLength(1); expect(maintenance.size).toBe(0);
    });
    it.each(['record', 'legacy'])('rejects oversized %s updates including the existing snapshot before any write', async (storage) => {
        const plan = stored({ scheduleRevision: 1, observationVersionId: 'near-limit-version', observationSnapshot: { recordedAt: '2026-11-07T01:00:00Z', note: '' } });
        const record = { userId: 'user-a', ...plan };
        const sizeLimit = 12 * 1024 * 1024;
        plan.observationSnapshot!.note = 'x'.repeat(sizeLimit - BSON.calculateObjectSize(record) - 128);
        expect(BSON.calculateObjectSize(record)).toBe(sizeLimit - 128);
        if (storage === 'record') records.push(record); else books.set('user-a', { userId: 'user-a', plans: [plan] });
        const result = await updateManualPlan(id, { manualState: 'completed', stateReason: 'x'.repeat(2000), checkDate: '2026-11-11', scheduleReason: '延后并完成核查' }, 1);
        expect(result).toMatchObject({ code: 'INVALID', error: expect.stringContaining('输入仍保留') });
        expect(mocks.scheduleCreate).not.toHaveBeenCalled(); expect(mocks.recordCreate).not.toHaveBeenCalled(); expect(mocks.recordUpdate).not.toHaveBeenCalled();
        const retained = storage === 'record' ? records[0] : books.get('user-a')!.plans[0];
        expect(retained).toMatchObject({ checkDate: '2026-11-10', manualState: 'waiting', version: 1, scheduleRevision: 1 });
        expect(retained.observationSnapshot!.note).toBe(plan.observationSnapshot!.note);
        expect(maintenance.size).toBe(0);
        // An under-limit edit still succeeds immediately, proving the expected rejection released the lock.
        expect(await updateManualPlan(id, { nextAction: 'small' }, 1)).toMatchObject({ success: true, plan: { version: 2 } });
    });
    it('filters independent due plans by each market date and stable schedule revision', async () => {
        const now = new Date('2026-11-08T01:00:00Z');
        books.set('user-a', { userId: 'user-a', plans: [stored({ id: identifier(0), symbol: 'AAPL', checkDate: '2026-11-08' }), stored({ id: identifier(1), symbol: '2330.TW', checkDate: '2026-11-08' }), stored({ id: identifier(2), symbol: '00700.HK', checkDate: '2026-11-07' })] });
        records.push({ userId: 'user-a', ...stored({ id: identifier(2), clientRequestId: 'override', manualState: 'completed' }) }, { userId: 'user-b', ...stored({ checkDate: '2026-11-01' }) });
        const first = await listDueManualPlans('user-a', now);
        expect(first).toMatchObject({ plans: [{ id: identifier(1), scheduleRevision: 1 }], truncated: false });
        expect(mocks.observation).not.toHaveBeenCalled();
        expect(await updateManualPlan(identifier(1), { nextAction: '无关编辑' }, 1)).toMatchObject({ success: true });
        expect((await listDueManualPlans('user-a', now)).plans[0].scheduleRevision).toBe(1);
        expect(await updateManualPlan(identifier(1), { checkDate: '2026-11-07', scheduleReason: '更早核查' }, 2)).toMatchObject({ success: true });
        expect((await listDueManualPlans('user-a', now)).plans[0].scheduleRevision).toBe(2);
    });
    it('bounds due reads/results and reports truncation instead of silently dropping overflow', async () => {
        records.push(...Array.from({ length: 105 }, (_, index) => ({ userId: 'user-a', ...stored({ id: identifier(index), clientRequestId: `over-${index}`, checkDate: '2026-11-01' }) })));
        const result = await listDueManualPlans('user-a', new Date('2026-11-08T01:00:00Z'));
        expect(result.plans).toHaveLength(100); expect(result.truncated).toBe(true);
        expect(mocks.recordFind.mock.results.at(-1)!.value.limit).toHaveBeenCalledWith(101);
    });
    it('fails closed on interrupted schedule writes and never returns a false empty due inbox', async () => {
        const plan = await created();
        mocks.recordUpdate.mockImplementationOnce(() => ({ lean: async () => { throw new Error('unknown write result'); } }));
        expect(await updateManualPlan(plan.id, { checkDate: '2026-11-11', scheduleReason: '延后核查' }, 1)).toMatchObject({ code: 'LIFECYCLE_MAINTENANCE', retryable: false });
        expect(schedules).toHaveLength(1);
        expect(await getManualPlans()).toMatchObject({ code: 'LIFECYCLE_MAINTENANCE' });
        await expect(listDueManualPlans('user-a', new Date())).rejects.toMatchObject({ code: 'LIFECYCLE_MAINTENANCE' });
    });
});
