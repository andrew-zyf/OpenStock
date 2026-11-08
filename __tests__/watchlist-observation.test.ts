import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BSON } from 'mongodb';
import type { SavedWatchlistRecord } from '@/lib/watchlist-observation';

type Row = SavedWatchlistRecord & { userId: string };
type Query = { userId: string; _id?: string; symbol?: string | { $in: string[] }; archivedAt?: null | { $ne: null }; observationUpdatedAt?: Date | null; journalVersion?: number | null };
type Update = { $setOnInsert?: Partial<Row>; $set?: Partial<Row>; $push?: { journal: { $each: NonNullable<Row['journal']> } }; $inc?: { journalVersion: number } };
const mocks = vi.hoisted(() => ({
    rows: [] as Row[], locks: new Map<string, Record<string, unknown>>(), lockUpdate: vi.fn(), lockAcquire: vi.fn(), lockFind: vi.fn(),
    user: vi.fn(), connect: vi.fn(), quotes: vi.fn(), revalidate: vi.fn(),
    find: vi.fn(), findOne: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn(),
}));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.user }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/realtime-market', () => ({ fetchRealtimeQuotes: mocks.quotes }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: {
    find: mocks.find, findOne: mocks.findOne, countDocuments: mocks.count, findOneAndUpdate: mocks.update, updateMany: mocks.updateMany, aggregate: mocks.aggregate,
}, WatchlistLifecycle: { updateOne: mocks.lockUpdate, findOneAndUpdate: mocks.lockAcquire, findById: mocks.lockFind } }));

import { addToWatchlist, removeFromWatchlist, restoreWatchlist, getArchivedWatchlist, isStockInWatchlist, getUserWatchlist, updateWatchlistObservation, appendWatchlistReview, getWatchlistJournal } from '@/lib/actions/watchlist.actions';
import { compareJournalEntries, journalTime, getProximityPercent, isMarketDate, type WatchlistReview, type WatchlistReviewInput } from '@/lib/watchlist-review';

const HK_SYMBOL = '00700' + '.HK';
const addedAt = '2025-01-01T00:00:00.000Z';
const asOf = '2025-02-01T04:00:00.000Z';
const snapshot = { price: 100, currency: 'HKD', source: 'tencent', asOf, fetchedAt: asOf,
    priceBasis: 'last-trade' as const, adjustment: 'unadjusted' as const };
const row = (symbol = HK_SYMBOL, overrides: Partial<Row> = {}): Row => ({
    _id: symbol, userId: 'owner', symbol, company: 'Tencent', addedAt, ...overrides,
});
function matches(item: Row, query: Query) {
    return item.userId === query.userId && (!query._id || item._id === query._id)
        && (!query.symbol || (typeof query.symbol === 'string' ? item.symbol === query.symbol : query.symbol.$in.includes(item.symbol)))
        && (!Object.hasOwn(query, 'archivedAt') || (query.archivedAt === null ? item.archivedAt == null : item.archivedAt != null))
        && (!Object.hasOwn(query, 'observationUpdatedAt') || (item.observationUpdatedAt ?? null) === (query.observationUpdatedAt?.toISOString() ?? null))
        && (!Object.hasOwn(query, 'journalVersion') || (item.journalVersion ?? null) === query.journalVersion);
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.locks.clear();
    mocks.lockUpdate.mockImplementation(async (query: { _id: string; lockToken?: string }, update: { $setOnInsert?: object; $set?: object; $unset?: object }) => {
        if (!mocks.locks.has(query._id) && update.$setOnInsert) mocks.locks.set(query._id, { _id: query._id });
        const lock = mocks.locks.get(query._id);
        if (!lock || (query.lockToken && query.lockToken !== lock.lockToken)) return { modifiedCount: 0 };
        if (update.$set) Object.assign(lock, update.$set);
        if (update.$unset) for (const key of Object.keys(update.$unset)) delete lock[key];
        return { modifiedCount: 1 };
    });
    mocks.lockAcquire.mockImplementation(async (query: { _id: string }, update: { $set: object }) => {
        const lock = mocks.locks.get(query._id);
        if (!lock || lock.lockToken || lock.maintenanceRequired) return null;
        Object.assign(lock, update.$set);
        return lock;
    });
    mocks.lockFind.mockImplementation(async (userId: string) => mocks.locks.get(userId));
    mocks.user.mockResolvedValue('owner');
    mocks.quotes.mockResolvedValue({});
    mocks.find.mockImplementation((query: Query) => {
        const result = { select: vi.fn(() => result), sort: async () => mocks.rows.filter((item) => matches(item, query)) };
        return result;
    });
    mocks.findOne.mockImplementation(async (query: Query) => mocks.rows.find((item) => matches(item, query)) || null);
    mocks.aggregate.mockImplementation(async (pipeline: Record<string, unknown>[]) => {
        const scope = pipeline[0].$match as Query;
        const cursor = pipeline.find((stage) => stage.$match && '$or' in (stage.$match as object))?.$match as
            { $or: [{ _journalTime: { $lt: string } }, { id: { $lt: string } }] } | undefined;
        const beforeTime = cursor?.$or[0]._journalTime.$lt;
        const beforeId = cursor?.$or[1].id.$lt;
        const limit = pipeline.find((stage) => '$limit' in stage)!.$limit as number;
        return mocks.rows.filter((item) => matches(item, scope)).flatMap((item) => item.journal || [])
            .sort(compareJournalEntries).filter((item) => !beforeTime || journalTime(item) < beforeTime
                || (journalTime(item) === beforeTime && item.id < beforeId!)).slice(0, limit);
    });
    mocks.count.mockImplementation(async (query: Query) => mocks.rows.filter((item) => matches(item, query)).length);
    mocks.updateMany.mockImplementation(async (query: Query, update: Update) => {
        const selected = mocks.rows.filter((item) => matches(item, query));
        for (const item of selected) {
            if (update.$set) Object.assign(item, JSON.parse(JSON.stringify(update.$set)));
            if (update.$inc) item.journalVersion = (item.journalVersion || 0) + update.$inc.journalVersion;
        }
        return { acknowledged: true, modifiedCount: selected.length };
    });
    mocks.update.mockImplementation(async (query: Query, update: Update) => {
        const existing = mocks.rows.find((item) => matches(item, query));
        if (update.$setOnInsert) {
            if (existing) return existing;
            const created = JSON.parse(JSON.stringify({ _id: 'new', ...update.$setOnInsert })) as Row;
            mocks.rows.push(created);
            return created;
        }
        if (!existing) return null;
        if (update.$set) Object.assign(existing, JSON.parse(JSON.stringify(update.$set)));
        if (update.$push) existing.journal = [...(existing.journal || []), ...JSON.parse(JSON.stringify(update.$push.journal.$each))];
        if (update.$inc) existing.journalVersion = (existing.journalVersion || 0) + update.$inc.journalVersion;
        return existing;
    });
});

describe('optional initial observation snapshots', () => {
    it('captures a real last trade and source dates only on insertion', async () => {
        mocks.quotes.mockResolvedValue({ [HK_SYMBOL]: { ...snapshot } });
        const result = await addToWatchlist('HKEX:700', 'Tencent');
        expect(result).toMatchObject({ symbol: HK_SYMBOL, initialSnapshot: snapshot, reviewStatus: 'watching' });
        expect(mocks.quotes).toHaveBeenCalledWith([HK_SYMBOL]);
        expect(mocks.update.mock.calls[0][1]).toHaveProperty('$setOnInsert.initialSnapshot', snapshot);
    });

    it.each([
        ['missing quote', undefined],
        ['zero price', { ...snapshot, price: 0 }],
        ['negative price', { ...snapshot, price: -1 }],
        ['nonfinite price', { ...snapshot, price: Infinity }],
        ['missing source time', { ...snapshot, asOf: undefined }],
        ['invalid source time', { ...snapshot, asOf: 'not-a-date' }],
        ['zero source time', { ...snapshot, asOf: '1970-01-01T00:00:00.000Z' }],
        ['missing fetch time', { ...snapshot, fetchedAt: undefined }],
        ['missing source', { ...snapshot, source: '' }],
        ['missing currency', { ...snapshot, currency: '' }],
        ['unknown price basis', { ...snapshot, priceBasis: undefined }],
        ['Taiwan previous close', { ...snapshot, currency: 'TWD', priceBasis: 'previous-close' }],
    ])('adds without snapshot for %s', async (_name, quote) => {
        mocks.quotes.mockResolvedValue({ [HK_SYMBOL]: quote });
        const result = await addToWatchlist(HK_SYMBOL, 'Tencent');
        expect(result).toMatchObject({ symbol: HK_SYMBOL, reviewStatus: 'watching' });
        expect(result).not.toHaveProperty('initialSnapshot', expect.anything());
        expect(mocks.update.mock.calls[0][1].$setOnInsert).not.toHaveProperty('initialSnapshot');
    });

    it('still adds when the optional provider rejects', async () => {
        mocks.quotes.mockRejectedValue(new Error('offline'));
        expect(await addToWatchlist('AAPL', 'Apple')).toMatchObject({ symbol: 'AAPL' });
        expect(mocks.rows).toHaveLength(1);
    });

    it('never backfills an old record and preserves metadata on an existing add at capacity', async () => {
        mocks.rows = [row('0700.HK', { note: 'Original thesis', group: 'Growth', targetPrice: 99 })];
        mocks.count.mockResolvedValue(50);
        const before = JSON.stringify(mocks.rows);
        expect(await addToWatchlist('HKEX:700', 'Replacement')).toMatchObject({
            symbol: HK_SYMBOL, company: 'Tencent', note: 'Original thesis', group: 'Growth', targetPrice: 99,
        });
        expect(mocks.quotes).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(JSON.stringify(mocks.rows)).toBe(before);
        expect((await getUserWatchlist())[0].initialSnapshot).toBeUndefined();
    });

    it('preserves a concurrent insert instead of overwriting its snapshot and notes', async () => {
        const winner = row(HK_SYMBOL, { note: 'Winning insert', initialSnapshot: snapshot });
        mocks.quotes.mockImplementation(async () => { mocks.rows.push(winner); return { [HK_SYMBOL]: { ...snapshot, price: 999 } }; });
        const result = await addToWatchlist(HK_SYMBOL, 'Replacement');
        expect(result).toMatchObject({ note: 'Winning insert', initialSnapshot: snapshot });
        expect(mocks.rows).toEqual([winner]);
    });

    it('recovers a duplicate-key upsert race with the saved user-scoped record', async () => {
        const winner = row(HK_SYMBOL, { note: 'Saved by another request', initialSnapshot: snapshot });
        mocks.update.mockImplementationOnce(async () => { mocks.rows.push(winner); throw { code: 11000 }; });
        expect(await addToWatchlist(HK_SYMBOL, 'Replacement')).toMatchObject({ note: winner.note, initialSnapshot: snapshot });
        expect(mocks.findOne.mock.calls.at(-1)?.[0]).toMatchObject({ userId: 'owner' });
    });
});

describe('observation reads and aliases', () => {
    it('defaults legacy status without writes or quote backfills and excludes internal identity', async () => {
        mocks.rows = [row()];
        const [entry] = await getUserWatchlist();
        expect(entry).toMatchObject({ symbol: HK_SYMBOL, reviewStatus: 'watching', addedAt });
        expect(entry.reviewedAt).toBeUndefined();
        expect(entry.observationUpdatedAt).toBeUndefined();
        expect(entry.initialSnapshot).toBeUndefined();
        expect(entry).not.toHaveProperty('userId');
        expect(entry).not.toHaveProperty('_id');
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.quotes).not.toHaveBeenCalled();
    });

    it('retains earliest addedAt, useful company, notes and snapshot across saved aliases', async () => {
        mocks.rows = [row('HKEX:700', { company: 'HKEX:700', note: 'First thesis', group: 'Core' }),
            row('0700.HK', { addedAt: asOf, note: 'Second thesis', initialSnapshot: snapshot, invalidation: 'Margins decline', targetPrice: 90 })];
        const before = JSON.stringify(mocks.rows);
        expect(await getUserWatchlist()).toEqual([expect.objectContaining({
            symbol: HK_SYMBOL, company: 'Tencent', addedAt, group: 'Core', note: 'First thesis\n\nSecond thesis',
            initialSnapshot: snapshot, invalidation: 'Margins decline', targetPrice: 90,
        })]);
        expect(JSON.stringify(mocks.rows)).toBe(before);
        const existing = await addToWatchlist(HK_SYMBOL, 'Replacement');
        expect(existing).toMatchObject({ note: 'First thesis\n\nSecond thesis', initialSnapshot: snapshot });
    });
});

describe('authenticated observation updates', () => {
    it('requires authentication before reading or writing', async () => {
        mocks.user.mockRejectedValue(new Error('Unauthorized'));
        await expect(updateWatchlistObservation('AAPL', { note: 'x' })).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('cannot update another user’s record via a symbol alias', async () => {
        mocks.rows = [row('0700.HK', { userId: 'someone-else', note: 'Private' })];
        expect(await updateWatchlistObservation('HKEX:700', { note: 'Attack' }, null)).toMatchObject({ success: false, code: 'NOT_FOUND' });
        expect(mocks.find).toHaveBeenCalledWith({ userId: 'owner', symbol: { $in: expect.arrayContaining(['HKEX:700', '0700.HK', HK_SYMBOL]) } });
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.rows[0].note).toBe('Private');
    });

    it.each([
        null, [], {}, { group: 'x'.repeat(81) }, { note: 'x'.repeat(2001) }, { invalidation: 'x'.repeat(2001) },
        { note: 1 }, { group: {} }, { targetPrice: 0 }, { targetPrice: -1 }, { targetPrice: NaN },
        { targetPrice: Infinity }, { targetPrice: '10' }, { reviewStatus: 'pending' }, { reviewStatus: null },
        { userId: 'attacker' }, { initialSnapshot: snapshot }, { observationUpdatedAt: asOf }, { $set: { note: 'unsafe' } },
    ])('rejects invalid or unowned payload fields %j before database access', async (input) => {
        await expect(updateWatchlistObservation('AAPL', input as never)).rejects.toThrow();
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('rejects unsafe symbols and malformed concurrency timestamps before database access', async () => {
        await expect(updateWatchlistObservation('<script>', { note: 'x' })).rejects.toThrow('股票代码');
        await expect(updateWatchlistObservation('AAPL', { note: 'x' }, 'yesterday')).rejects.toThrow('观察版本');
        expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('updates an alias for the owner, retaining other notes and the immutable snapshot', async () => {
        mocks.rows = [row('HKEX:700', { note: 'First thesis', group: 'Core' }),
            row('0700.HK', { addedAt: asOf, note: 'Second thesis', initialSnapshot: snapshot })];
        const result = await updateWatchlistObservation(HK_SYMBOL, { targetPrice: 80, reviewStatus: 'validated' }, null);
        expect(result).toMatchObject({ success: true, entry: {
            symbol: HK_SYMBOL, note: 'First thesis\n\nSecond thesis', group: 'Core', targetPrice: 80,
            initialSnapshot: snapshot, reviewStatus: 'validated', reviewedAt: expect.any(String), observationUpdatedAt: expect.any(String),
        } });
        const [query, update] = mocks.update.mock.calls[0];
        expect(query).toEqual({ _id: 'HKEX:700', userId: 'owner', symbol: 'HKEX:700', archivedAt: null, observationUpdatedAt: null, journalVersion: null });
        expect(update.$set).not.toHaveProperty('initialSnapshot');
        expect(update.$set).not.toHaveProperty('addedAt');
        expect(mocks.quotes).not.toHaveBeenCalled();
        expect((await getUserWatchlist())[0]).toEqual(result.success ? result.entry : undefined);
    });

    it.each([{ group: 'Research' }, { reviewStatus: 'validated' as const }])('saves a metadata patch %j without truncating two merged legal legacy notes', async (patch) => {
        const firstNote = '甲'.repeat(1000);
        const secondNote = '乙'.repeat(1000);
        const combined = `${firstNote}\n\n${secondNote}`;
        mocks.rows = [row('HKEX:700', { note: firstNote }),
            row('0700.HK', { addedAt: asOf, note: secondNote, initialSnapshot: snapshot })];
        const [initial] = await getUserWatchlist();
        expect(initial.note).toBe(combined);
        expect(initial.note).toHaveLength(2002);

        const result = await updateWatchlistObservation(HK_SYMBOL, patch, null);
        if (!result.success) throw new Error(result.error);
        expect(result.entry).toMatchObject({ ...patch, note: combined, initialSnapshot: snapshot });
        expect(mocks.update.mock.calls[0][1].$set.note).toBe(combined);
        expect((await getUserWatchlist())[0].note).toBe(combined);

        const followup = await updateWatchlistObservation('0700.HK', { group: 'Follow-up' }, result.entry.observationUpdatedAt);
        if (!followup.success) throw new Error(followup.error);
        expect(followup.entry).toMatchObject({ group: 'Follow-up', note: combined, initialSnapshot: snapshot });
        expect((await getUserWatchlist())[0].note).toBe(combined);
        expect(mocks.rows.find((item) => item.symbol === '0700.HK')?.note).toBe(secondNote);
    });

    it('trims input, supports explicit clears, and preserves those clears on alias reads', async () => {
        mocks.rows = [row('HKEX:700', { note: 'Old note', group: 'Old group', targetPrice: 100 }),
            row('0700.HK', { note: 'Alias note', initialSnapshot: snapshot })];
        const first = await updateWatchlistObservation('HKEX:700', { note: '  New thesis  ', reviewStatus: 'invalidated' }, null);
        expect(first.success && first.entry.note).toBe('New thesis');
        const next = await updateWatchlistObservation('0700.HK', {
            note: '', group: null, targetPrice: null, invalidation: '  Debt increases  ', reviewStatus: 'watching',
        }, first.success ? first.entry.observationUpdatedAt : undefined);
        expect(next).toMatchObject({ success: true, entry: { invalidation: 'Debt increases', reviewStatus: 'watching', initialSnapshot: snapshot } });
        const [entry] = await getUserWatchlist();
        expect(entry.note).toBeUndefined();
        expect(entry.group).toBeUndefined();
        expect(entry.targetPrice).toBeUndefined();
        expect(entry.reviewedAt).toBeUndefined();
    });

    it('preserves alias-only fields when an older partial observation revision omits them', async () => {
        mocks.rows = [row('HKEX:700', { group: 'Research', observationUpdatedAt: asOf }),
            row('0700.HK', { note: 'Alias thesis', invalidation: 'Revenue falls', initialSnapshot: snapshot })];
        expect((await getUserWatchlist())[0]).toMatchObject({ group: 'Research', note: 'Alias thesis', invalidation: 'Revenue falls', initialSnapshot: snapshot });
        expect(await updateWatchlistObservation('0700.HK', { targetPrice: 90 }, asOf)).toMatchObject({
            success: true, entry: { group: 'Research', note: 'Alias thesis', invalidation: 'Revenue falls', initialSnapshot: snapshot },
        });
    });

    it('rejects a stale UI revision without touching the saved edit', async () => {
        mocks.rows = [row(HK_SYMBOL, { note: 'Latest', observationUpdatedAt: asOf })];
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Stale edit' }, null)).toMatchObject({ success: false, code: 'CONFLICT' });
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.rows[0].note).toBe('Latest');
    });

    it('detects a write racing the read even when no client revision was supplied', async () => {
        mocks.rows = [row()];
        mocks.update.mockResolvedValueOnce(null);
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Edit' })).toMatchObject({ success: false, code: 'CONFLICT' });
        expect(mocks.revalidate).not.toHaveBeenCalled();
    });

    it('increments revision monotonically when two saves happen within a millisecond', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        vi.spyOn(Date, 'now').mockReturnValueOnce(now.getTime());
        mocks.rows = [row(HK_SYMBOL, { observationUpdatedAt: now.toISOString() })];
        const result = await updateWatchlistObservation(HK_SYMBOL, { group: 'Research' }, now.toISOString());
        expect(result.success && result.entry.observationUpdatedAt).toBe('2026-01-01T00:00:00.001Z');
        vi.restoreAllMocks();
    });
});

const reviewInput = (overrides: Partial<WatchlistReviewInput> = {}): WatchlistReviewInput => ({
    tradingDate: '2026-11-06', hypothesis: 'Margins will improve', changes: 'New quarterly filing',
    conclusion: 'Continue watching', verificationType: 'fact', evidenceURLs: ['https://example.com/filing'],
    clientRequestId: 'request-1', ...overrides,
});
const savedReview = (overrides: Partial<WatchlistReview> = {}): WatchlistReview => ({
    ...reviewInput(), evidenceURLs: ['https://example.com/filing'], kind: 'review', id: 'review-1', createdAt: asOf, ...overrides,
});

describe('append-only observation journal', () => {
    it('captures unknown legacy time and both states atomically without making history on reads', async () => {
        mocks.rows = [row(HK_SYMBOL, { note: 'Old reason', invalidation: 'Old invalidation', targetPrice: 80, initialSnapshot: snapshot })];
        expect(await getWatchlistJournal(HK_SYMBOL)).toEqual({ success: true, entries: [] });
        expect(mocks.update).not.toHaveBeenCalled();
        const result = await updateWatchlistObservation(HK_SYMBOL, { note: 'New reason', targetPrice: 90, reviewStatus: 'validated' }, null);
        expect(result.success).toBe(true);
        const journal = mocks.rows[0].journal!;
        expect(journal).toHaveLength(2);
        expect(journal[0]).toMatchObject({ kind: 'observation', source: 'legacy-capture', modifiedAt: null,
            observation: { note: 'Old reason', invalidation: 'Old invalidation', targetPrice: 80, reviewStatus: 'watching' } });
        expect(journal[1]).toMatchObject({ kind: 'observation', source: 'edit', modifiedAt: expect.any(String),
            observation: { note: 'New reason', invalidation: 'Old invalidation', targetPrice: 90, reviewStatus: 'validated' } });
        expect(mocks.update.mock.calls[0][1]).toHaveProperty('$push.journal.$each', journal);
        expect(mocks.rows[0].initialSnapshot).toEqual(snapshot);
        const original = JSON.stringify(journal);
        const next = await updateWatchlistObservation(HK_SYMBOL, { invalidation: null }, result.success ? result.entry.observationUpdatedAt : undefined);
        expect(next.success).toBe(true);
        expect(mocks.rows[0].journal).toHaveLength(3);
        expect(JSON.stringify(mocks.rows[0].journal!.slice(0, 2))).toBe(original);
        expect((await getUserWatchlist())[0]).not.toHaveProperty('journal');
        expect((await getUserWatchlist())[0]).not.toHaveProperty('journalVersion');
    });

    it('retains a known prior revision time but records real wall time separately from monotonic CAS', async () => {
        mocks.rows = [row(HK_SYMBOL, { note: 'Before', observationUpdatedAt: asOf })];
        const frozen = new Date(asOf).getTime();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(frozen);
        try {
            const result = await updateWatchlistObservation(HK_SYMBOL, { note: 'After' }, asOf);
            expect(result.success && result.entry.observationUpdatedAt).toBe('2025-02-01T04:00:00.001Z');
            expect(mocks.rows[0].journal![0]).toMatchObject({ source: 'saved-revision', modifiedAt: asOf });
            expect(mocks.rows[0].journal![1]).toMatchObject({ source: 'edit', modifiedAt: asOf, recordedAt: asOf });
        } finally { clock.mockRestore(); }
    });

    it('reuses archived A after JSON/Mongoose Mixed reorders its fields instead of appending another baseline', async () => {
        mocks.rows = [row('600' + '519.SS')];
        const first = await updateWatchlistObservation('600' + '519.SS', { note: 'A', group: 'Core', targetPrice: 80 }, null);
        if (!first.success) throw new Error(first.error);
        const originalA = mocks.rows[0].journal![1];
        const reordered = mocks.rows[0].journal!.map((item) => item.kind === 'observation'
            ? { ...item, observation: Object.fromEntries(Object.entries(item.observation).reverse()) } : item);
        const { Watchlist: RealWatchlist } = await vi.importActual<typeof import('@/database/models/watchlist.model')>('@/database/models/watchlist.model');
        const document = new RealWatchlist({ userId: 'owner', symbol: '600' + '519.SS', company: 'Moutai', journal: reordered });
        mocks.rows[0].journal = JSON.parse(JSON.stringify(document.toJSON().journal));
        const roundTrippedA = mocks.rows[0].journal![1];
        expect(roundTrippedA).toEqual(originalA);
        expect(roundTrippedA.kind === 'observation' && JSON.stringify(roundTrippedA.observation))
            .not.toBe(originalA.kind === 'observation' && JSON.stringify(originalA.observation));

        const second = await updateWatchlistObservation('600' + '519.SS', { note: 'B' }, first.entry.observationUpdatedAt);
        expect(second.success).toBe(true);
        expect(mocks.rows[0].journal).toHaveLength(3); // Original empty state, A, then B.
        expect(mocks.rows[0].journal!.filter((item) => item.kind === 'observation' && item.observation.note === 'A')).toEqual([originalA]);
        expect(mocks.update.mock.calls[1][1].$push?.journal.$each).toHaveLength(1);
        const page = await getWatchlistJournal('600' + '519.SS');
        if (!page.success) throw new Error(page.error);
        expect(page.entries.filter((item) => item.kind === 'observation').map((item) => item.observation.note)).toEqual(['B', 'A', undefined]);
    });

    it('reuses archived B after real Mongoose/BSON hydration converts optional Mixed fields to null', async () => {
        const symbol = '600' + '519.SS';
        mocks.rows = [row(symbol)];
        const first = await updateWatchlistObservation(symbol, { note: 'B', nextReviewDate: '2026-11-13', proximityPercent: 0 }, null);
        if (!first.success) throw new Error(first.error);
        const rawJournal = (mocks.update.mock.calls[0][1] as Update).$push!.journal.$each;
        const originalId = mocks.rows[0]._id;
        const { Watchlist: RealWatchlist } = await vi.importActual<typeof import('@/database/models/watchlist.model')>('@/database/models/watchlist.model');
        const operation = mocks.update.mock.calls[0][1] as Update;
        const query = RealWatchlist.findOneAndUpdate({ userId: 'owner', symbol }, { $set: operation.$set, $push: { journal: { $each: rawJournal } } });
        // Cast with the real Mongoose update schema without executing the query, then use the
        // driver's BSON defaults. Mixed undefined keys persist as null on this update path.
        const castUpdate = (query as unknown as { _castUpdate: (value: unknown) => object })._castUpdate(query.getUpdate());
        const storedUpdate = BSON.deserialize(BSON.serialize(castUpdate, { ignoreUndefined: false }));
        const document = new RealWatchlist({ ...mocks.rows[0], ...storedUpdate.$set, _id: undefined, journal: storedUpdate.$push.journal.$each });
        const stored = BSON.deserialize(BSON.serialize(document.toObject(), { ignoreUndefined: false }));
        const leanJSON = JSON.parse(JSON.stringify(RealWatchlist.hydrate(stored).toJSON()));
        mocks.rows[0] = { ...leanJSON, _id: originalId };
        expect(mocks.rows[0].reviewedAt).toBeNull();
        const archivedB = mocks.rows[0].journal![1];
        if (archivedB.kind !== 'observation') throw new Error('Expected observation');
        expect(archivedB.observation.reviewedAt).toBeNull();
        expect(archivedB.observation.group).toBeNull();
        expect(archivedB.observation.targetPrice).toBeNull();
        expect(archivedB.observation.proximityPercent).toBe(0);
        const capturedB = JSON.stringify(archivedB);

        const second = await updateWatchlistObservation(symbol, { note: 'C' }, first.entry.observationUpdatedAt);
        expect(second.success).toBe(true);
        expect(mocks.rows[0].journal).toHaveLength(3);
        expect(mocks.update.mock.calls[1][1].$push?.journal.$each).toHaveLength(1);
        expect(JSON.stringify(mocks.rows[0].journal![1])).toBe(capturedB);
        expect(mocks.rows[0].journal!.filter((item) => item.kind === 'observation' && item.observation.note === 'B')).toHaveLength(1);
        expect(second.success && second.entry).toMatchObject({ note: 'C', nextReviewDate: '2026-11-13', proximityPercent: 0 });
    });

    it('does not append or manufacture revision times for an unchanged patch', async () => {
        mocks.rows = [row(HK_SYMBOL, { note: 'Same', nextReviewDate: '2026-11-09' })];
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Same', nextReviewDate: '2026-11-09' }, null)).toMatchObject({ success: true });
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.rows[0].journal).toBeUndefined();
    });

    it('merges legacy metadata into the captured baseline and preserves history on all aliases', async () => {
        const old = savedReview();
        mocks.rows = [row('HKEX:700', { note: 'One', nextReviewDate: '2026-11-09', journal: [old] }),
            row('0700.HK', { note: 'Two', addedAt: asOf, proximityPercent: 0, journal: [savedReview({ id: 'other', clientRequestId: 'other' })] })];
        await updateWatchlistObservation(HK_SYMBOL, { group: 'Core' }, null);
        const page = await getWatchlistJournal('0700.HK', { limit: 100 });
        expect(page.success && page.entries).toHaveLength(6);
        expect(mocks.rows[0].journal).toContainEqual(expect.objectContaining({ observation: expect.objectContaining({ note: 'One\n\nTwo', nextReviewDate: '2026-11-09', proximityPercent: 0 }) }));
        expect(mocks.rows[0].journal![0]).toEqual(old);
        expect((await getUserWatchlist())[0]).toMatchObject({ nextReviewDate: '2026-11-09', proximityPercent: 0 });
    });

    it('archives every original alias opinion with its own known time before the first merged edit', async () => {
        const february = '2025-02-01T04:00:00.000Z';
        const march = '2025-03-01T04:00:00.000Z';
        mocks.rows = [row('HKEX:700', { note: 'Opinion A', targetPrice: 80, group: 'Original A',
            invalidation: 'Condition A', reviewStatus: 'invalidated', reviewedAt: february, observationUpdatedAt: february }),
        row('0700.HK', { addedAt: asOf, note: 'Opinion B', targetPrice: 90, group: 'Original B',
            invalidation: 'Condition B', reviewStatus: 'validated', reviewedAt: march, observationUpdatedAt: march })];
        const result = await updateWatchlistObservation(HK_SYMBOL, { note: 'Opinion C' }, march);
        expect(result.success).toBe(true);
        const journal = mocks.rows[1].journal!;
        expect(journal).toHaveLength(3);
        expect(journal[0]).toMatchObject({ sourceSymbol: 'HKEX:700', modifiedAt: february, source: 'saved-revision',
            observation: { note: 'Opinion A', targetPrice: 80, group: 'Original A', invalidation: 'Condition A', reviewStatus: 'invalidated', reviewedAt: february } });
        expect(journal[1]).toMatchObject({ sourceSymbol: '0700.HK', modifiedAt: march, source: 'saved-revision',
            observation: { note: 'Opinion B', targetPrice: 90, group: 'Original B', invalidation: 'Condition B', reviewStatus: 'validated', reviewedAt: march } });
        expect(journal[2]).toMatchObject({ sourceSymbol: '0700.HK', source: 'edit', observation: { note: 'Opinion C' } });
        expect(mocks.rows[0].journal).toBeUndefined(); // Captures are atomic on the current owner's document.
        expect(mocks.update.mock.calls[0][0]).toMatchObject({ symbol: '0700.HK', observationUpdatedAt: new Date(march), journalVersion: null });
        const captured = JSON.stringify(journal);
        await updateWatchlistObservation('HKEX:700', { group: 'Next group' }, result.success ? result.entry.observationUpdatedAt : undefined);
        expect(mocks.rows[1].journal).toHaveLength(4);
        expect(JSON.stringify(mocks.rows[1].journal!.slice(0, 3))).toBe(captured);
        const all = [];
        let before: string | undefined;
        do {
            const page = await getWatchlistJournal('0700.HK', { limit: 1, before });
            if (!page.success) throw new Error(page.error);
            all.push(...page.entries);
            before = page.nextCursor;
        } while (before);
        expect(all.map((item) => item.id)).toHaveLength(4);
        expect(new Set(all.map((item) => item.id)).size).toBe(4);
        expect(all).toContainEqual(expect.objectContaining({ sourceSymbol: 'HKEX:700', modifiedAt: february }));
    });

    it('places the effective merged before-state next to the first edit even when an earlier raw alias already matches it', async () => {
        mocks.rows = [row('HKEX:700', { note: 'original saved opinion' }), row(HK_SYMBOL, { addedAt: asOf })];
        expect((await getUserWatchlist())[0].note).toBe('original saved opinion');
        const result = await updateWatchlistObservation(HK_SYMBOL, { note: 'updated opinion' }, null);
        expect(result.success).toBe(true);
        const journal = mocks.rows[0].journal!;
        expect(journal).toHaveLength(4);
        expect(journal[0]).toMatchObject({ sourceSymbol: 'HKEX:700', observation: { note: 'original saved opinion' } });
        expect(journal[1]).toMatchObject({ sourceSymbol: HK_SYMBOL, observation: { reviewStatus: 'watching' } });
        expect(journal[1].kind === 'observation' && journal[1].observation.note).toBeUndefined();
        expect(journal[2]).toMatchObject({ source: 'legacy-capture', observation: { note: 'original saved opinion' } });
        expect(journal[2]).not.toHaveProperty('sourceSymbol');
        expect(journal[3]).toMatchObject({ source: 'edit', observation: { note: 'updated opinion' } });
    });

    it('captures unknown alias times and full long raw notes without repeating archived aliases', async () => {
        const first = '甲'.repeat(1000);
        const second = '乙'.repeat(1000);
        mocks.rows = [row('HKEX:700', { note: first }), row('0700.HK', { addedAt: asOf, note: second })];
        await updateWatchlistObservation(HK_SYMBOL, { group: 'New group' }, null);
        const journal = mocks.rows[0].journal!;
        expect(journal).toHaveLength(4); // Both originals, the effective merged state, and the edit.
        expect(journal[0]).toMatchObject({ sourceSymbol: 'HKEX:700', modifiedAt: null, source: 'legacy-capture', observation: { note: first } });
        expect(journal[1]).toMatchObject({ sourceSymbol: '0700.HK', modifiedAt: null, source: 'legacy-capture', observation: { note: second } });
        expect(journal[2]).toMatchObject({ modifiedAt: null, observation: { note: `${first}\n\n${second}` } });
        await updateWatchlistObservation('0700.HK', { group: 'Later group' });
        expect(mocks.rows[0].journal).toHaveLength(5);
        expect(mocks.rows[0].journal!.filter((item) => item.kind === 'observation' && item.source === 'legacy-capture')).toHaveLength(3);
    });

    it('uses journal CAS to reject a review racing an observation save without losing either history', async () => {
        mocks.rows = [row()];
        mocks.update.mockImplementationOnce(async () => { mocks.rows[0].journalVersion = 1; return null; });
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Edit' })).toMatchObject({ code: 'CONFLICT' });
        expect(mocks.rows[0].note).toBeUndefined();
        expect(mocks.update.mock.calls[0][0]).toHaveProperty('journalVersion', null);
    });

    it('rejects document capacity explicitly without truncating or dropping an entry', async () => {
        const huge = savedReview({ conclusion: 'x'.repeat(12 * 1024 * 1024) });
        mocks.rows = [row(HK_SYMBOL, { journal: [huge] })];
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'New' })).toMatchObject({ success: false, code: 'JOURNAL_CAPACITY', error: expect.stringContaining('容量限制') });
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.rows[0].journal).toEqual([huge]);
    });
});

describe('observation scheduling input', () => {
    it.each([
        { nextReviewDate: '2026-02-30' }, { nextReviewDate: '2026-2-01' }, { nextReviewDate: '2026-11-08T00:00:00Z' },
        { nextReviewDate: 123 }, { proximityPercent: NaN }, { proximityPercent: Infinity },
        { proximityPercent: -0.1 }, { proximityPercent: 100.1 }, { proximityPercent: '2' },
    ])('rejects invalid date/percentage patch %j', async (patch) => {
        await expect(updateWatchlistObservation(HK_SYMBOL, patch as never)).rejects.toThrow();
        expect(mocks.connect).not.toHaveBeenCalled();
    });

    it.each([
        ['1899-12-31', false], ['1900-01-01', true], ['1900-02-29', false],
        ['2000-02-29', true], ['2100-02-29', false], ['9999-12-31', true],
        ['10000-01-01', false], ['0000-01-01', false], ['2026-11-08T00:00:00Z', false],
    ])('validates market calendar date %s within the preserved range', (value, expected) => {
        expect(isMarketDate(value)).toBe(expected);
    });

    it('accepts calendar dates and zero/100 bounds; null clears across aliases', async () => {
        mocks.rows = [row('HKEX:700'), row('0700.HK', { addedAt: asOf, nextReviewDate: '2026-11-09', proximityPercent: 20 })];
        const first = await updateWatchlistObservation(HK_SYMBOL, { nextReviewDate: '2028-02-29', proximityPercent: 0 });
        expect(first.success && first.entry).toMatchObject({ nextReviewDate: '2028-02-29', proximityPercent: 0 });
        await updateWatchlistObservation(HK_SYMBOL, { proximityPercent: 100 });
        await updateWatchlistObservation(HK_SYMBOL, { nextReviewDate: null, proximityPercent: null });
        const [entry] = await getUserWatchlist();
        expect(entry.nextReviewDate).toBeUndefined();
        expect(entry.proximityPercent).toBeUndefined();
        expect(getProximityPercent(entry.proximityPercent)).toBe(2);
        expect(getProximityPercent(0)).toBe(0);
        expect(getProximityPercent(100)).toBe(100);
        expect(getProximityPercent(NaN)).toBe(2);
        expect(isMarketDate('2028-02-29')).toBe(true);
        expect(isMarketDate('2026-02-29')).toBe(false);
    });
});

describe('immutable daily review actions', () => {
    it('requires authentication for history and review writes', async () => {
        mocks.user.mockRejectedValue(new Error('Unauthorized'));
        await expect(getWatchlistJournal(HK_SYMBOL)).rejects.toThrow('Unauthorized');
        await expect(appendWatchlistReview(HK_SYMBOL, reviewInput())).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('scopes reads, correction references, and writes to the authenticated user and canonical aliases', async () => {
        mocks.rows = [row('0700.HK', { userId: 'someone-else', journal: [savedReview()] })];
        expect(await getWatchlistJournal(HK_SYMBOL)).toMatchObject({ code: 'NOT_FOUND' });
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput())).toMatchObject({ code: 'NOT_FOUND' });
        mocks.rows.push(row('HKEX:700'));
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput({ correctionOf: 'review-1' }))).toMatchObject({ code: 'INVALID_CORRECTION' });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('appends the selected market date with server creation time and actual optional quote', async () => {
        mocks.rows = [row('0700.HK', { initialSnapshot: snapshot })];
        mocks.quotes.mockResolvedValue({ [HK_SYMBOL]: snapshot });
        const result = await appendWatchlistReview('HKEX:700', reviewInput());
        expect(result).toMatchObject({ success: true, deduplicated: false, review: {
            tradingDate: '2026-11-06', createdAt: expect.any(String), sourceQuote: snapshot,
            verificationType: 'fact', hypothesis: 'Margins will improve', changes: 'New quarterly filing',
        } });
        expect(mocks.rows[0].observationUpdatedAt).toBeUndefined();
        expect(mocks.rows[0].initialSnapshot).toEqual(snapshot);
        expect(mocks.update.mock.calls[0][0]).toMatchObject({ userId: 'owner', symbol: '0700.HK', journalVersion: null });
        expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('$set');
        expect(mocks.rows[0].journal).toHaveLength(1);
    });

    it.each([undefined, { ...snapshot, priceBasis: 'previous-close' }, { ...snapshot, asOf: undefined }, { ...snapshot, fetchedAt: undefined }])('saves notes without fabricating incomplete quote provenance %j', async (quote) => {
        mocks.rows = [row()];
        mocks.quotes.mockResolvedValue({ [HK_SYMBOL]: quote });
        const result = await appendWatchlistReview(HK_SYMBOL, reviewInput());
        expect(result.success && result.review.sourceQuote).toBeUndefined();
        expect(mocks.rows[0].journal).toHaveLength(1);
    });

    it('does not block a note when its optional quote provider fails', async () => {
        mocks.rows = [row()];
        mocks.quotes.mockRejectedValue(new Error('offline'));
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput())).toMatchObject({ success: true });
        expect(mocks.rows[0].journal![0]).not.toHaveProperty('sourceQuote');
    });

    it('deduplicates retries across aliases before fetching another quote and rejects key reuse', async () => {
        mocks.rows = [row('0700.HK')];
        const first = await appendWatchlistReview(HK_SYMBOL, reviewInput());
        const second = await appendWatchlistReview('HKEX:700', reviewInput());
        expect(second).toMatchObject({ success: true, deduplicated: true });
        expect(first.success && second.success && second.review).toEqual(first.success && first.review);
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.quotes).toHaveBeenCalledTimes(1);
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput({ conclusion: 'Different request' }))).toMatchObject({ code: 'CONFLICT' });
        expect(mocks.rows[0].journal).toHaveLength(1);
    });

    it('returns a simultaneous retry winner with the original id, quote, and time', async () => {
        mocks.rows = [row()];
        mocks.update.mockImplementationOnce(async (_query: Query, update: Update) => {
            mocks.rows[0].journal = update.$push!.journal.$each;
            mocks.rows[0].journalVersion = 1;
            return null;
        });
        const result = await appendWatchlistReview(HK_SYMBOL, reviewInput());
        expect(result).toMatchObject({ success: true, deduplicated: true, review: { clientRequestId: 'request-1' } });
        expect(mocks.rows[0].journal).toHaveLength(1);
    });

    it('returns every alias capture and date revision on success and on a concurrent retry winner', async () => {
        mocks.rows = [row('HKEX:700', { note: 'A', observationUpdatedAt: addedAt, targetPrice: 80 }),
            row('0700.HK', { note: 'B', observationUpdatedAt: asOf, targetPrice: 90 })];
        mocks.update.mockImplementationOnce(async (query: Query, update: Update) => {
            const owner = mocks.rows.find((record) => record.symbol === query.symbol)!;
            Object.assign(owner, JSON.parse(JSON.stringify(update.$set)));
            owner.journal = JSON.parse(JSON.stringify(update.$push!.journal.$each));
            owner.journalVersion = 1;
            return null;
        });
        const request = reviewInput({ nextReviewDate: '2026-11-13' });
        const first = await appendWatchlistReview(HK_SYMBOL, request);
        if (!first.success) throw new Error(first.error);
        expect(first.deduplicated).toBe(true);
        expect(first.entries).toEqual(mocks.rows[1].journal);
        expect(first.entries).toHaveLength(4);
        expect(first.entries.filter((item) => item.kind === 'observation').every((item) => item.reviewId === first.review.id)).toBe(true);
        expect(first.entries).toContainEqual(expect.objectContaining({ sourceSymbol: 'HKEX:700', modifiedAt: addedAt, observation: expect.objectContaining({ note: 'A', targetPrice: 80 }) }));
        expect(first.entries).toContainEqual(expect.objectContaining({ sourceSymbol: '0700.HK', modifiedAt: asOf, observation: expect.objectContaining({ note: 'B', targetPrice: 90 }) }));
        const second = await appendWatchlistReview('HKEX:700', request);
        expect(second.success && second.entries).toEqual(first.entries);
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.quotes).toHaveBeenCalledTimes(1);
    });

    it('returns conflict for a different concurrent append, allowing an explicit retry', async () => {
        mocks.rows = [row()];
        mocks.update.mockResolvedValueOnce(null);
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput())).toMatchObject({ code: 'CONFLICT' });
        expect(mocks.rows[0].journal).toBeUndefined();
    });

    it('retains correction chains without editing original reviews or cross-symbol references', async () => {
        const original = savedReview();
        mocks.rows = [row('HKEX:700', { journal: [original] }), row('AAPL', { journal: [savedReview({ id: 'apple-review' })] })];
        const first = await appendWatchlistReview('0700.HK', reviewInput({ clientRequestId: 'correction-1', correctionOf: original.id }));
        if (!first.success) throw new Error(first.error);
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput({ clientRequestId: 'correction-2', correctionOf: first.review.id }))).toMatchObject({ success: true });
        expect(mocks.rows[0].journal![0]).toEqual(original);
        expect(mocks.rows[0].journal).toHaveLength(3);
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput({ clientRequestId: 'bad', correctionOf: 'apple-review' }))).toMatchObject({ code: 'INVALID_CORRECTION' });
    });

    it('updates an explicit next plan in the same CAS with old/new versions and preserves it on retries or omission', async () => {
        mocks.rows = [row(HK_SYMBOL, { note: 'Long-term thesis', nextReviewDate: '2026-11-09' })];
        const first = await appendWatchlistReview(HK_SYMBOL, reviewInput({ nextReviewDate: '2026-11-13' }));
        expect(first).toMatchObject({ success: true, entry: { nextReviewDate: '2026-11-13', observationUpdatedAt: expect.any(String) } });
        if (!first.success) throw new Error(first.error);
        expect(first.entries).toEqual(mocks.rows[0].journal);
        expect(first.entries).toHaveLength(3);
        expect(first.entries.slice(0, 2)).toEqual(expect.arrayContaining([
            expect.objectContaining({ reviewId: first.review.id, kind: 'observation' }),
        ]));
        expect(mocks.rows[0].journal).toHaveLength(3);
        expect(mocks.rows[0].journal![0]).toMatchObject({ observation: { nextReviewDate: '2026-11-09' } });
        expect(mocks.rows[0].journal![1]).toMatchObject({ observation: { nextReviewDate: '2026-11-13' } });
        expect(mocks.update.mock.calls[0][1]).toHaveProperty('$set.nextReviewDate', '2026-11-13');
        await updateWatchlistObservation(HK_SYMBOL, { nextReviewDate: '2026-11-20' });
        const duplicate = await appendWatchlistReview(HK_SYMBOL, reviewInput({ nextReviewDate: '2026-11-13' }));
        expect(duplicate).toMatchObject({ success: true, deduplicated: true, entry: { nextReviewDate: '2026-11-20' } });
        expect(duplicate.success && duplicate.entries).toEqual(first.entries);
        await appendWatchlistReview(HK_SYMBOL, reviewInput({ clientRequestId: 'no-plan' }));
        expect(mocks.rows[0].nextReviewDate).toBe('2026-11-20');
        const cleared = await appendWatchlistReview(HK_SYMBOL, reviewInput({ clientRequestId: 'clear-plan', nextReviewDate: null }));
        expect(cleared.success && cleared.review.nextReviewDate).toBeNull();
        expect(cleared.success && cleared.entry.nextReviewDate).toBeUndefined();
        expect(mocks.rows[0].nextReviewDate).toBeNull();
    });

    it.each([
        { tradingDate: '2026-02-30' }, { tradingDate: undefined }, { tradingDate: '2026-11-06T00:00:00Z' },
        { hypothesis: '' }, { changes: 'x'.repeat(2001) }, { conclusion: null }, { verificationType: 'unknown' },
        { evidenceURLs: ['javascript:alert(1)'] }, { evidenceURLs: ['https://user:pass@example.com'] },
        { evidenceURLs: Array(11).fill('https://example.com') }, { evidenceURLs: [100] },
        { nextReviewDate: '2026-13-01' }, { correctionOf: { $ne: null } }, { clientRequestId: '' },
        { clientRequestId: 'x'.repeat(101) }, { createdAt: asOf }, { userId: 'someone-else' }, { sourceQuote: snapshot },
    ])('validates untrusted review fields before database access %j', async (patch) => {
        await expect(appendWatchlistReview(HK_SYMBOL, reviewInput(patch as never))).rejects.toThrow();
        expect(mocks.connect).not.toHaveBeenCalled();
    });
});

describe('research archive lifecycle', () => {
    it('archives every owned alias without deleting any identity, snapshot or journal, then restores on add', async () => {
        mocks.rows = [row('HKEX:700', { note: 'Original thesis', initialSnapshot: snapshot, journal: [savedReview()], journalVersion: 3 }),
            row('0700.HK', { addedAt: asOf, invalidation: 'Debt', journal: [savedReview({ id: 'alias-review', clientRequestId: 'alias' })] }),
            row(HK_SYMBOL, { userId: 'someone-else', note: 'Private' }), row('AAPL', { archivedAt: null })];
        const before = JSON.parse(JSON.stringify(mocks.rows)) as Row[];
        await removeFromWatchlist(HK_SYMBOL);
        expect(mocks.rows).toHaveLength(4);
        for (const [index, item] of mocks.rows.slice(0, 2).entries()) {
            expect(item).toEqual({ ...before[index], archivedAt: expect.any(String), journalVersion: (before[index].journalVersion || 0) + 1 });
        }
        expect(mocks.rows.slice(2)).toEqual(before.slice(2));
        expect(await isStockInWatchlist('0700.HK')).toBe(false);
        expect((await getUserWatchlist()).map((entry) => entry.symbol)).toEqual(['AAPL']);
        expect(await getArchivedWatchlist()).toEqual([expect.objectContaining({ symbol: HK_SYMBOL, archivedAt: expect.any(String), initialSnapshot: snapshot, note: 'Original thesis' })]);
        const page = await getWatchlistJournal('0700.HK', { limit: 100 });
        expect(page.success && page.entries.map((entry) => entry.id)).toEqual(['review-1', 'alias-review']);
        const once = JSON.stringify(mocks.rows);
        await removeFromWatchlist('HKEX:700');
        expect(JSON.stringify(mocks.rows)).toBe(once);
        const restored = await addToWatchlist('0700.HK', 'Replacement name');
        expect(restored).toMatchObject({ symbol: HK_SYMBOL, company: 'Tencent', addedAt, note: 'Original thesis', initialSnapshot: snapshot });
        expect(restored).not.toHaveProperty('archivedAt');
        expect(mocks.rows.slice(0, 2)).toEqual(before.slice(0, 2).map((item) => ({ ...item, archivedAt: null, journalVersion: (item.journalVersion || 0) + 2 })));
        expect(await isStockInWatchlist(HK_SYMBOL)).toBe(true);
        expect(await getArchivedWatchlist()).toEqual([]);
        expect(mocks.quotes).not.toHaveBeenCalled();
    });

    it('counts only active records for insertion and restoration and never spends a slot on an existing active add', async () => {
        mocks.rows = Array.from({ length: 50 }, (_, index) => row(`OLD${index}`, { archivedAt: asOf }));
        expect(await addToWatchlist('AAPL', 'Apple')).toMatchObject({ symbol: 'AAPL' });
        expect(mocks.count).toHaveBeenCalledWith({ userId: 'owner', archivedAt: null });
        mocks.rows = [...Array.from({ length: 50 }, (_, index) => row(`ACTIVE${index}`)), row(HK_SYMBOL, { archivedAt: asOf, initialSnapshot: snapshot })];
        const before = JSON.stringify(mocks.rows);
        expect(await restoreWatchlist('HKEX:700')).toMatchObject({ success: false, code: 'WATCHLIST_CAPACITY' });
        expect(await addToWatchlist('0700.HK', 'Replacement')).toHaveProperty('error');
        expect(await addToWatchlist('MSFT', 'Microsoft')).toHaveProperty('error');
        expect(await addToWatchlist('ACTIVE0', 'Replacement')).toMatchObject({ symbol: 'ACTIVE0' });
        expect(JSON.stringify(mocks.rows)).toBe(before);
        await removeFromWatchlist('ACTIVE0');
        expect(await restoreWatchlist(HK_SYMBOL)).toMatchObject({ success: true, entry: { symbol: HK_SYMBOL, initialSnapshot: snapshot } });
        const updates = mocks.updateMany.mock.calls.length;
        expect(await restoreWatchlist('HKEX:700')).toMatchObject({ success: true });
        expect(mocks.updateMany).toHaveBeenCalledTimes(updates);
    });

    it('requires authentication and scopes restoration and archived reads to the current user', async () => {
        mocks.rows = [row(HK_SYMBOL, { userId: 'someone-else', archivedAt: asOf })];
        expect(await restoreWatchlist('HKEX:700')).toMatchObject({ code: 'NOT_FOUND' });
        expect(await getArchivedWatchlist()).toEqual([]);
        expect(mocks.updateMany).not.toHaveBeenCalled();
        mocks.user.mockRejectedValue(new Error('Unauthorized'));
        await expect(restoreWatchlist(HK_SYMBOL)).rejects.toThrow('Unauthorized');
        await expect(getArchivedWatchlist()).rejects.toThrow('Unauthorized');
        await expect(removeFromWatchlist(HK_SYMBOL)).rejects.toThrow('Unauthorized');
    });

    it('blocks new edits and reviews while archived but preserves exact review retries and their atomic entries', async () => {
        mocks.rows = [row(HK_SYMBOL, { nextReviewDate: '2026-11-09' })];
        const input = reviewInput({ nextReviewDate: '2026-11-13' });
        const saved = await appendWatchlistReview(HK_SYMBOL, input);
        if (!saved.success) throw new Error(saved.error);
        await removeFromWatchlist(HK_SYMBOL);
        const before = JSON.stringify(mocks.rows);
        mocks.quotes.mockClear();
        mocks.update.mockClear();
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Edit' })).toMatchObject({ success: false, code: 'ARCHIVED' });
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput({ clientRequestId: 'new' }))).toMatchObject({ success: false, code: 'ARCHIVED' });
        expect(await appendWatchlistReview(HK_SYMBOL, input)).toMatchObject({ success: true, deduplicated: true, review: saved.review, entries: JSON.parse(JSON.stringify(saved.entries)), entry: { archivedAt: expect.any(String) } });
        expect(await appendWatchlistReview(HK_SYMBOL, { ...input, conclusion: 'Changed' })).toMatchObject({ code: 'CONFLICT' });
        expect(JSON.stringify(mocks.rows)).toBe(before);
        expect(mocks.quotes).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it.each(['archive', 'archive-and-restore'] as const)('serializes a concurrent %s after the atomic observation write', async (race) => {
        mocks.rows = [row(HK_SYMBOL, { note: 'Before' })];
        const save = mocks.update.getMockImplementation()!;
        let archive: ReturnType<typeof removeFromWatchlist> | undefined;
        mocks.update.mockImplementationOnce(async (query: Query, update: Update) => {
            archive = removeFromWatchlist(HK_SYMBOL);
            expect(mocks.updateMany).not.toHaveBeenCalled();
            return save(query, update);
        });
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Racing edit' })).toMatchObject({ success: true });
        expect(await archive).toMatchObject({ success: true });
        if (race === 'archive-and-restore') expect(await restoreWatchlist(HK_SYMBOL)).toMatchObject({ success: true });
        expect(mocks.rows[0].note).toBe('Racing edit');
        expect(mocks.rows[0].journal).toHaveLength(2);
        expect(Boolean(mocks.rows[0].archivedAt)).toBe(race === 'archive');
    });

    it('serializes archive after an append without splitting its review and next-plan batch', async () => {
        mocks.rows = [row(HK_SYMBOL, { nextReviewDate: '2026-11-09' })];
        const save = mocks.update.getMockImplementation()!;
        let archive: ReturnType<typeof removeFromWatchlist> | undefined;
        mocks.update.mockImplementationOnce(async (query: Query, update: Update) => {
            archive = removeFromWatchlist(HK_SYMBOL);
            return save(query, update);
        });
        const review = await appendWatchlistReview(HK_SYMBOL, reviewInput({ nextReviewDate: '2026-11-20' }));
        expect(review).toMatchObject({ success: true });
        expect(await archive).toMatchObject({ success: true });
        expect(mocks.rows[0].nextReviewDate).toBe('2026-11-20');
        expect(mocks.rows[0].journal).toHaveLength(3);
        expect(mocks.rows[0].archivedAt).toEqual(expect.any(String));
    });

    it('prevents the reproduced A-archive/restore/B-archive split and hides intermediate aliases from readers', async () => {
        mocks.rows = [row('HKEX:700', { note: 'Original alias', initialSnapshot: snapshot }),
            row(HK_SYMBOL, { note: 'Authoritative opinion', observationUpdatedAt: asOf })];
        const apply = mocks.updateMany.getMockImplementation()!;
        let firstChanged!: () => void;
        let resume!: () => void;
        const changed = new Promise<void>((resolve) => { firstChanged = resolve; });
        const paused = new Promise<void>((resolve) => { resume = resolve; });
        mocks.updateMany.mockImplementationOnce(async (query: Query, update: Update) => {
            await apply({ ...query, _id: 'HKEX:700' }, update);
            firstChanged();
            await paused;
            await apply({ ...query, _id: HK_SYMBOL }, update);
            return { modifiedCount: 2 };
        });
        const archive = removeFromWatchlist(HK_SYMBOL);
        await changed;
        expect(mocks.rows.map((item) => Boolean(item.archivedAt))).toEqual([true, false]);
        const restore = restoreWatchlist(HK_SYMBOL);
        const active = getUserWatchlist();
        const archived = getArchivedWatchlist();
        // All concurrent actions must wait at the mutex instead of observing half an alias group.
        await vi.waitFor(() => expect(mocks.lockAcquire.mock.calls.length).toBeGreaterThanOrEqual(4));
        expect(mocks.updateMany).toHaveBeenCalledTimes(1);
        resume();
        expect(await archive).toMatchObject({ success: true });
        expect(await restore).toMatchObject({ success: true });
        expect((await active)[0]).toMatchObject({ note: 'Authoritative opinion', initialSnapshot: snapshot });
        expect(await archived).toEqual([]);
        expect(mocks.rows.every((item) => item.archivedAt === null)).toBe(true);
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Can still edit' }, asOf)).toMatchObject({ success: true });
    });

    it.each(['restore', 'add'] as const)('serializes two distinct concurrent %ss when only one of 50 slots remains', async (operation) => {
        mocks.rows = [...Array.from({ length: 49 }, (_, index) => row(`ACTIVE${index}`)),
            ...(operation === 'restore' ? [row('AAPL', { archivedAt: asOf }), row('MSFT', { archivedAt: asOf })] : [])];
        const results = operation === 'restore'
            ? await Promise.all([restoreWatchlist('AAPL'), restoreWatchlist('MSFT')])
            : await Promise.all([addToWatchlist('AAPL', 'Apple'), addToWatchlist('MSFT', 'Microsoft')]);
        expect(results.filter((result) => 'error' in result)).toHaveLength(1);
        if (operation === 'restore') expect(results.find((result) => 'error' in result)).toMatchObject({ code: 'WATCHLIST_CAPACITY' });
        expect(mocks.rows.filter((item) => !item.archivedAt)).toHaveLength(50);
    });

    it('does not restore multiple persisted aliases into fewer available raw-record slots', async () => {
        mocks.rows = [...Array.from({ length: 49 }, (_, index) => row(`ACTIVE${index}`)),
            row('HKEX:700', { archivedAt: asOf }), row(HK_SYMBOL, { archivedAt: asOf })];
        expect(await restoreWatchlist(HK_SYMBOL)).toMatchObject({ code: 'WATCHLIST_CAPACITY' });
        expect(mocks.rows.filter((item) => !item.archivedAt)).toHaveLength(49);
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it('retains the token and non-sensitive intent after a partial alias write and blocks further publication', async () => {
        mocks.rows = [row('HKEX:700', { note: 'Private thesis' }), row(HK_SYMBOL)];
        const apply = mocks.updateMany.getMockImplementation()!;
        mocks.updateMany.mockImplementationOnce(async (query: Query, update: Update) => {
            await apply({ ...query, _id: 'HKEX:700' }, update);
            throw new Error('Write failed after first alias');
        });
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            expect(await removeFromWatchlist(HK_SYMBOL)).toMatchObject({ success: false, code: 'LIFECYCLE_MAINTENANCE', retryable: false });
            expect(mocks.locks.get('owner')).toMatchObject({ operation: 'archive', symbol: HK_SYMBOL, lockToken: expect.any(String), maintenanceRequired: true });
            expect(JSON.stringify(mocks.locks.get('owner'))).not.toContain('Private thesis');
            await expect(getUserWatchlist()).rejects.toMatchObject({ code: 'LIFECYCLE_MAINTENANCE' });
            await expect(getArchivedWatchlist()).rejects.toMatchObject({ code: 'LIFECYCLE_MAINTENANCE' });
            expect(await restoreWatchlist(HK_SYMBOL)).toMatchObject({ code: 'LIFECYCLE_MAINTENANCE', retryable: false });
            expect(mocks.updateMany).toHaveBeenCalledTimes(1);
        } finally { log.mockRestore(); }
    });

    it('bounds contention without stealing an orphaned token or disguising it as an empty watchlist', async () => {
        vi.useFakeTimers();
        mocks.locks.set('owner', { _id: 'owner', lockToken: 'existing-holder', operation: 'archive', symbol: HK_SYMBOL });
        const read = expect(getUserWatchlist()).rejects.toMatchObject({ code: 'LIFECYCLE_BUSY', retryable: true });
        const restore = restoreWatchlist(HK_SYMBOL);
        await vi.runAllTimersAsync();
        await read;
        expect(await restore).toMatchObject({ success: false, code: 'LIFECYCLE_BUSY', retryable: true });
        expect(mocks.locks.get('owner')?.lockToken).toBe('existing-holder');
        expect(mocks.find).not.toHaveBeenCalled();
        expect(mocks.updateMany).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('returns structured capacity failures without applying any batch fields and still deduplicates a saved retry', async () => {
        const huge = savedReview({ id: 'huge-review', conclusion: 'x'.repeat(12 * 1024 * 1024), clientRequestId: 'huge' });
        const original = savedReview();
        mocks.rows = [row(HK_SYMBOL, { journal: [huge, original], note: 'Original thesis', nextReviewDate: '2026-11-09', journalVersion: 5 })];
        const before = JSON.stringify(mocks.rows);
        expect(await appendWatchlistReview(HK_SYMBOL, reviewInput({ clientRequestId: 'new', nextReviewDate: '2026-11-20' }))).toMatchObject({ success: false, code: 'JOURNAL_CAPACITY' });
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'New thesis', nextReviewDate: '2026-11-20' })).toMatchObject({ success: false, code: 'JOURNAL_CAPACITY' });
        expect(JSON.stringify(mocks.rows)).toBe(before);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.revalidate).not.toHaveBeenCalled();
        mocks.quotes.mockClear();
        expect(await appendWatchlistReview('0700.HK', reviewInput())).toMatchObject({ success: true, deduplicated: true, review: original, entries: [original] });
        expect(mocks.quotes).not.toHaveBeenCalled();
        expect(await updateWatchlistObservation(HK_SYMBOL, { note: 'Original thesis' })).toMatchObject({ success: true });
        expect(mocks.update).not.toHaveBeenCalled();
    });
});

describe('journal pagination', () => {
    it('pages every alias deterministically even when creation times tie, without hidden entries', async () => {
        mocks.rows = [row('HKEX:700', { journal: [savedReview({ id: 'a' }), savedReview({ id: 'c', clientRequestId: 'c' })] }),
            row('0700.HK', { journal: [savedReview({ id: 'b', clientRequestId: 'b' })] })];
        const first = await getWatchlistJournal(HK_SYMBOL, { limit: 2 });
        if (!first.success) throw new Error(first.error);
        expect(first.entries.map((item) => item.id)).toEqual(['c', 'b']);
        expect(first.nextCursor).toEqual(expect.any(String));
        const second = await getWatchlistJournal('0700.HK', { limit: 2, before: first.nextCursor });
        expect(second).toEqual({ success: true, entries: [savedReview({ id: 'a' })] });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { before: 'invalid' }, { before: 'x'.repeat(501) }])('rejects invalid pagination options %j', async (options) => {
        await expect(getWatchlistJournal(HK_SYMBOL, options)).rejects.toThrow();
        expect(mocks.connect).not.toHaveBeenCalled();
    });
});
