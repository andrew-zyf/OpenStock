import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedWatchlistRecord } from '@/lib/watchlist-observation';

type Row = SavedWatchlistRecord & { userId: string };
type Query = { userId: string; _id?: string; symbol?: string | { $in: string[] }; observationUpdatedAt?: Date | null };
type Update = { $setOnInsert?: Partial<Row>; $set?: Partial<Row> };
const mocks = vi.hoisted(() => ({
    rows: [] as Row[], user: vi.fn(), connect: vi.fn(), quotes: vi.fn(), revalidate: vi.fn(),
    find: vi.fn(), findOne: vi.fn(), count: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.user }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/realtime-market', () => ({ fetchRealtimeQuotes: mocks.quotes }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: {
    find: mocks.find, findOne: mocks.findOne, countDocuments: mocks.count, findOneAndUpdate: mocks.update,
} }));

import { addToWatchlist, getUserWatchlist, updateWatchlistObservation } from '@/lib/actions/watchlist.actions';

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
        && (!Object.hasOwn(query, 'observationUpdatedAt') || (item.observationUpdatedAt ?? null) === (query.observationUpdatedAt?.toISOString() ?? null));
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.user.mockResolvedValue('owner');
    mocks.quotes.mockResolvedValue({});
    mocks.find.mockImplementation((query: Query) => ({ sort: async () => mocks.rows.filter((item) => matches(item, query)) }));
    mocks.findOne.mockImplementation(async (query: Query) => mocks.rows.find((item) => matches(item, query)) || null);
    mocks.count.mockImplementation(async (query: Query) => mocks.rows.filter((item) => matches(item, query)).length);
    mocks.update.mockImplementation(async (query: Query, update: Update) => {
        const existing = mocks.rows.find((item) => matches(item, query));
        if (update.$setOnInsert) {
            if (existing) return existing;
            const created = JSON.parse(JSON.stringify({ _id: 'new', ...update.$setOnInsert })) as Row;
            mocks.rows.push(created);
            return created;
        }
        if (!existing) return null;
        Object.assign(existing, JSON.parse(JSON.stringify(update.$set)));
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
        expect(query).toEqual({ _id: 'HKEX:700', userId: 'owner', symbol: 'HKEX:700', observationUpdatedAt: null });
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
