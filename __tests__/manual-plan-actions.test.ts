import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredManualPlan } from '@/database/models/manual-plan.model';
import { manualPlanFingerprint, validateCreateManualPlan, type CreateManualPlanInput } from '@/lib/manual-plan';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), find: vi.fn(), update: vi.fn(), watchlistUpdate: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/models/manual-plan.model', () => ({ ManualPlanBook: { findOne: mocks.find, findOneAndUpdate: mocks.update } }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { findOneAndUpdate: mocks.watchlistUpdate } }));
import { createManualPlan, getManualPlans, updateManualPlan } from '@/lib/actions/manual-plan.actions';

type Book = { userId: string; plans: StoredManualPlan[] };
type Filter = { userId: string; 'plans.id'?: string; 'plans.clientRequestId'?: { $ne: string }; 'plans.99'?: { $exists: boolean }; plans?: { $elemMatch: { id: string; version: number } } };
type Update = { $setOnInsert?: Book; $push?: { plans: StoredManualPlan }; $set?: Record<string, unknown>; $inc?: Record<string, number> };
const books = new Map<string, Book>();
const input: CreateManualPlanInput = { symbol: 'HKEX:700', waitingCondition: '等待公告', invalidation: '假设不再成立', nextAction: '人工核对原始资料', checkDate: '2026-11-10', clientRequestId: 'request-123' };
const id = '11111111-1111-4111-8111-111111111111';
function stored(overrides: Partial<StoredManualPlan> = {}): StoredManualPlan {
    const value = validateCreateManualPlan(input);
    return { ...value, id, createFingerprint: manualPlanFingerprint(value), version: 1, manualState: 'waiting', createdAt: new Date('2026-11-08T01:00:00Z'), updatedAt: new Date('2026-11-08T01:00:00Z'), ...overrides };
}
// Model double applies the actual owner, embedded-version, capacity and request predicates as
// one synchronous operation, so simultaneous promises exercise both winners and losers.
function update(filter: Filter, change: Update) {
    return { lean: async () => {
        let book = books.get(filter.userId);
        if (change.$setOnInsert) {
            if (!book) { book = structuredClone(change.$setOnInsert); books.set(filter.userId, book); }
            return structuredClone(book);
        }
        if (!book) return null;
        if (change.$push) {
            if (filter['plans.99']?.$exists === false && book.plans.length >= 100) return null;
            if (book.plans.some((plan) => plan.clientRequestId === filter['plans.clientRequestId']?.$ne)) return null;
            book.plans.push(structuredClone(change.$push.plans));
        }
        if (filter.plans) {
            const expected = filter.plans.$elemMatch;
            const plan = book.plans.find((item) => item.id === expected.id && item.version === expected.version);
            if (!plan) return null;
            for (const [key, value] of Object.entries(change.$set ?? {})) Object.assign(plan, { [key.replace('plans.$.', '')]: value });
            if (change.$inc?.['plans.$.version']) plan.version += change.$inc['plans.$.version'];
        }
        return structuredClone(book);
    } };
}
beforeEach(() => {
    vi.clearAllMocks(); books.clear();
    mocks.auth.mockResolvedValue('user-a'); mocks.connect.mockResolvedValue(undefined);
    mocks.find.mockImplementation((filter: Filter) => ({ lean: async () => {
        const book = books.get(filter.userId);
        return book && (!filter['plans.id'] || book.plans.some((plan) => plan.id === filter['plans.id'])) ? structuredClone(book) : null;
    } }));
    mocks.update.mockImplementation(update);
});

describe('authenticated standalone manual plan actions', () => {
    it('creates a canonical waiting plan without any watchlist or trading state dependency', async () => {
        const plan = await createManualPlan(input);
        expect(plan).toMatchObject({ symbol: '00700.HK', manualState: 'waiting', version: 1, checkDate: '2026-11-10' });
        expect(plan).not.toHaveProperty('userId'); expect(plan).not.toHaveProperty('clientRequestId'); expect(plan).not.toHaveProperty('createFingerprint');
        expect(mocks.watchlistUpdate).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenLastCalledWith({ userId: 'user-a', 'plans.clientRequestId': { $ne: input.clientRequestId }, 'plans.99': { $exists: false } }, expect.anything(), { new: true, runValidators: true });
    });
    it('authenticates reads and every mutation before accessing persistence', async () => {
        mocks.auth.mockRejectedValue(new Error('Unauthorized'));
        await expect(getManualPlans()).rejects.toThrow('Unauthorized');
        await expect(createManualPlan(input)).rejects.toThrow('Unauthorized');
        await expect(updateManualPlan(id, { manualState: 'cancelled' }, 1)).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
    it('rejects malformed dates, fields, IDs and versions before any database connection', async () => {
        await expect(createManualPlan({ ...input, checkDate: '2026-02-30' })).rejects.toThrow('检查日期');
        await expect(updateManualPlan(id, { checkDate: '2026-02-30' }, 1)).rejects.toThrow('检查日期');
        await expect(createManualPlan({ ...input, userId: 'user-b' } as CreateManualPlanInput)).rejects.toThrow('字段');
        for (const version of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) await expect(updateManualPlan(id, { manualState: 'completed' }, version)).rejects.toThrow('版本');
        await expect(updateManualPlan('$bad-id', { manualState: 'completed' }, 1)).rejects.toThrow('编号');
        expect(mocks.connect).not.toHaveBeenCalled();
    });
    it('isolates list, retries and all update paths by the authenticated owner', async () => {
        books.set('user-b', { userId: 'user-b', plans: [stored()] });
        expect(await getManualPlans()).toEqual([]);
        expect(await updateManualPlan(id, { manualState: 'cancelled' }, 1)).toMatchObject({ success: false, code: 'NOT_FOUND' });
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', plans: { $elemMatch: { id, version: 1 } } }), expect.anything(), expect.anything());
        const own = await createManualPlan(input);
        expect(own.id).not.toBe(id);
        expect(books.get('user-b')!.plans[0].manualState).toBe('waiting');
        expect(await getManualPlans()).toEqual([own]);
    });
    it('returns identical retries, rejects mismatched content and never creates duplicates', async () => {
        const plan = await createManualPlan(input);
        expect(await createManualPlan({ ...input, symbol: '0700.HK' })).toEqual(plan);
        await expect(createManualPlan({ ...input, nextAction: '不同内容' })).rejects.toThrow('请求标识');
        expect(books.get('user-a')!.plans).toHaveLength(1);
    });
    it('keeps the original request fingerprint across edits, completion and cancellation', async () => {
        const initial = await createManualPlan(input);
        const changed = await updateManualPlan(initial.id, { nextAction: '新的人工核查', manualState: 'completed' }, initial.version);
        expect(changed.success).toBe(true);
        const retried = await createManualPlan(input);
        expect(retried).toMatchObject({ id: initial.id, nextAction: '新的人工核查', manualState: 'completed', version: 2 });
        await expect(createManualPlan({ ...input, nextAction: '新的人工核查' })).rejects.toThrow('请求标识');
        await updateManualPlan(initial.id, { manualState: 'cancelled' }, 2);
        expect(await createManualPlan(input)).toMatchObject({ id: initial.id, manualState: 'cancelled', version: 3 });
        expect(books.get('user-a')!.plans).toHaveLength(1);
    });
    it('deduplicates simultaneous first creates atomically', async () => {
        const [first, second] = await Promise.all([createManualPlan(input), createManualPlan(input)]);
        expect(first.id).toBe(second.id); expect(books.get('user-a')!.plans).toHaveLength(1);
    });
    it('rejects a simultaneous mismatched retry without writing its content', async () => {
        const results = await Promise.allSettled([createManualPlan(input), createManualPlan({ ...input, nextAction: 'different' })]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(books.get('user-a')!.plans).toHaveLength(1);
    });
    it('recovers the unique-owner first-book insert race', async () => {
        mocks.update.mockImplementationOnce(() => ({ lean: async () => {
            books.set('user-a', { userId: 'user-a', plans: [] }); throw { code: 11000 };
        } }));
        expect(await createManualPlan(input)).toMatchObject({ symbol: '00700.HK' });
        expect(books.get('user-a')!.plans).toHaveLength(1);
    });
    it('keeps all 100 terminal records and refuses another plan while allowing an original retry', async () => {
        const plans = Array.from({ length: 100 }, (_, index) => stored({ id: `id-${index}`, clientRequestId: `request-${index}`, manualState: index % 2 ? 'completed' : 'cancelled' }));
        books.set('user-a', { userId: 'user-a', plans });
        await expect(createManualPlan(input)).rejects.toThrow('100');
        expect(await createManualPlan({ ...input, clientRequestId: 'request-0' })).toMatchObject({ id: 'id-0', manualState: 'cancelled' });
        expect(await getManualPlans()).toHaveLength(100);
    });
    it('admits just one of two concurrent creates at the capacity boundary', async () => {
        books.set('user-a', { userId: 'user-a', plans: Array.from({ length: 99 }, (_, index) => stored({ id: `id-${index}`, clientRequestId: `existing-${index}` })) });
        const results = await Promise.allSettled([createManualPlan(input), createManualPlan({ ...input, clientRequestId: 'another-request' })]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(books.get('user-a')!.plans).toHaveLength(100);
    });
    it('rejects stale concurrent edits and preserves the winning plan', async () => {
        books.set('user-a', { userId: 'user-a', plans: [stored()] });
        const results = await Promise.all([
            updateManualPlan(id, { nextAction: 'winning edit' }, 1), updateManualPlan(id, { manualState: 'cancelled' }, 1),
        ]);
        expect(results.filter((result) => result.success)).toHaveLength(1);
        expect(results.find((result) => !result.success)).toMatchObject({ code: 'CONFLICT' });
        expect(books.get('user-a')!.plans[0]).toMatchObject({ nextAction: 'winning edit', manualState: 'waiting', version: 2 });
    });
    it('updates only the manual state and retains content without mutating observation review status', async () => {
        books.set('user-a', { userId: 'user-a', plans: [stored()] });
        const result = await updateManualPlan(id, { manualState: 'completed' }, 1);
        expect(result).toMatchObject({ success: true, plan: { manualState: 'completed', waitingCondition: input.waitingCondition, invalidation: input.invalidation, nextAction: input.nextAction } });
        if (result.success) expect(result.plan).not.toHaveProperty('reviewStatus');
        expect(mocks.update).toHaveBeenLastCalledWith(expect.anything(), { $set: { 'plans.$.manualState': 'completed', 'plans.$.updatedAt': expect.any(Date) }, $inc: { 'plans.$.version': 1 } }, expect.anything());
        expect(mocks.watchlistUpdate).not.toHaveBeenCalled();
        expect(await getManualPlans()).toHaveLength(1);
    });
});
