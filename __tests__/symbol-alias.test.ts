import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSymbolAliases, isInternationalSymbol, tvToAppSymbol, formatSymbolForTradingView, formatNumber } from '@/lib/utils';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { hasFinnhubQuotes } from '@/lib/markets';

const HK_SYMBOL = '00700' + '.HK';

type SavedRow = { _id: string; userId: string; symbol: string; company: string; addedAt: string; note?: string };
type Query = { userId: string; symbol?: string | { $in: string[] } };
const mocks = vi.hoisted(() => ({
    rows: [] as SavedRow[],
    requireUserId: vi.fn(), getSession: vi.fn(), revalidatePath: vi.fn(),
    findOne: vi.fn(), find: vi.fn(), countDocuments: vi.fn(), findOneAndUpdate: vi.fn(), deleteMany: vi.fn(),
    realtime: vi.fn(), yahoo: vi.fn(), localSearch: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: vi.fn() }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: {
    findOne: mocks.findOne, find: mocks.find, countDocuments: mocks.countDocuments,
    findOneAndUpdate: mocks.findOneAndUpdate, deleteMany: mocks.deleteMany,
} }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.requireUserId, getSession: mocks.getSession }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/realtime-market', () => ({ fetchRealtimeQuotes: mocks.realtime }));
vi.mock('@/lib/actions/yahoo.actions', () => ({ getYahooDailyQuotes: mocks.yahoo }));
vi.mock('@/lib/actions/china-market.actions', () => ({ getMultiMarketNews: vi.fn() }));
vi.mock('@/lib/chinese-stocks', () => ({ findChineseStocks: mocks.localSearch }));
vi.mock('@/lib/market-data', () => ({ QUOTE_TTL_SECONDS: 15 }));

function matches(row: SavedRow, query: Query) {
    return row.userId === query.userId && (!query.symbol || (typeof query.symbol === 'string'
        ? row.symbol === query.symbol : query.symbol.$in.includes(row.symbol)));
}
function row(symbol: string, overrides: Partial<SavedRow> = {}): SavedRow {
    return { _id: symbol, userId: 'user-123', symbol, company: symbol, addedAt: '2025-01-01T00:00:00.000Z', ...overrides };
}
let watchlist: typeof import('@/lib/actions/watchlist.actions');
let finnhub: typeof import('@/lib/actions/finnhub.actions');
beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('FINNHUB_API_KEYS', 'symbol-test-key');
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.rows = [];
    mocks.requireUserId.mockResolvedValue('user-123');
    mocks.getSession.mockResolvedValue({ user: { id: 'user-123' } });
    mocks.findOne.mockImplementation(async (query: Query) => mocks.rows.find((item) => matches(item, query)) || null);
    mocks.find.mockImplementation((query: Query) => ({ sort: async () => mocks.rows.filter((item) => matches(item, query)) }));
    mocks.countDocuments.mockImplementation(async (query: Query) => mocks.rows.filter((item) => matches(item, query)).length);
    mocks.findOneAndUpdate.mockImplementation(async (_query: Query, update: { $setOnInsert: Omit<SavedRow, '_id'> }) => ({ _id: 'new', ...update.$setOnInsert }));
    mocks.deleteMany.mockImplementation(async (query: Query) => {
        mocks.rows = mocks.rows.filter((item) => !matches(item, query));
        return { acknowledged: true };
    });
    mocks.realtime.mockResolvedValue({});
    mocks.yahoo.mockResolvedValue({});
    mocks.localSearch.mockReturnValue([]);
    mocks.fetch.mockResolvedValue(new Response('v_hint="N"'));
    watchlist = await import('@/lib/actions/watchlist.actions');
    finnhub = await import('@/lib/actions/finnhub.actions');
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('canonical symbol identity', () => {
    it.each(['HKEX:700', '0700.HK', HK_SYMBOL, '700'])('normalizes %s to the same five-digit HK instrument', (symbol) => {
        expect(tvToAppSymbol(symbol)).toBe(HK_SYMBOL);
        expect(formatSymbolForTradingView(symbol)).toBe('HKEX:700');
        expect(isInternationalSymbol(symbol)).toBe(true);
        expect(hasFinnhubQuotes(symbol)).toBe(false);
    });

    it('keeps TPEx and TWSE listings distinct in both symbol helpers and alias queries', () => {
        expect(tvToAppSymbol('TPEX:6488')).toBe('6488.TWO');
        expect(formatSymbolForTradingView('TPEX:6488')).toBe('TPEX:6488');
        expect(getSymbolAliases('6488.TWO')).toContain('TPEX:6488');
        expect(getSymbolAliases('6488.TWO')).not.toContain('6488.TW');
        expect(getSymbolAliases('6488.TW')).not.toContain('6488.TWO');
    });

    it.each(['920001.BJ', 'BSE:920001', '920001'])('recognizes Beijing %s as CN/CNY without Finnhub coverage', (symbol) => {
        expect(identifyMarketAndCode(symbol)).toMatchObject({ normalizedSymbol: '920001.BJ', market: 'cn', currency: 'CNY', exchangeId: 'BSE' });
        expect(isInternationalSymbol(symbol)).toBe(true);
        expect(hasFinnhubQuotes(symbol)).toBe(false);
    });

    it('preserves US share classes and existing Finnhub coverage boundaries', () => {
        expect(tvToAppSymbol('BRK.B')).toBe('BRK.B');
        expect(hasFinnhubQuotes('BRK.B')).toBe(true);
        expect(hasFinnhubQuotes('BINANCE:BTCUSDT')).toBe(true);
        expect(hasFinnhubQuotes('NASDAQ:AAPL')).toBe(false);
        expect(hasFinnhubQuotes('RELIANCE.NS')).toBe(false);
    });
});

describe('watchlist aliases without a database migration', () => {
    it('normalizes new writes and only sets insertion metadata', async () => {
        const result = await watchlist.addToWatchlist(' hkex:700 ', 'Tencent');
        expect(result).toMatchObject({ symbol: HK_SYMBOL });
        expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
            { userId: 'user-123', symbol: HK_SYMBOL },
            { $setOnInsert: { userId: 'user-123', symbol: HK_SYMBOL, company: 'Tencent', addedAt: expect.any(Date) } },
            { upsert: true, new: true },
        );
    });

    it('reuses a saved alias at the limit without changing its metadata', async () => {
        const saved = row('0700.HK', { company: 'Saved Tencent', note: 'keep me' });
        mocks.rows = [saved];
        mocks.countDocuments.mockResolvedValue(50);
        expect(await watchlist.addToWatchlist(HK_SYMBOL, 'Replacement')).toMatchObject({
            symbol: HK_SYMBOL, company: saved.company, addedAt: saved.addedAt, note: saved.note, reviewStatus: 'watching',
        });
        expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.rows).toEqual([saved]);
    });

    it('returns one canonical result with a useful name and earliest addedAt, leaving all rows intact', async () => {
        const saved = [
            row(HK_SYMBOL, { company: 'Tencent', addedAt: '2025-02-01T00:00:00.000Z' }),
            row('HKEX:700', { note: 'earliest metadata' }),
            row('0700.HK', { company: '0700.HK', addedAt: '2025-03-01T00:00:00.000Z' }),
            row('6488.TWO', { company: 'TPEx' }), row('6488.TW', { company: 'TWSE' }),
        ];
        mocks.rows = saved;
        const result = await watchlist.getUserWatchlist();
        expect(result).toHaveLength(3);
        expect(result.find((item) => item.symbol === HK_SYMBOL)).toMatchObject({ company: 'Tencent', addedAt: '2025-01-01T00:00:00.000Z', note: 'earliest metadata' });
        expect(mocks.rows).toEqual(saved);
        expect(mocks.deleteMany).not.toHaveBeenCalled();
        expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('checks and explicitly removes all aliases only for the signed-in user', async () => {
        mocks.rows = [row('0700.HK'), row('HKEX:700'), row(HK_SYMBOL, { userId: 'other-user' }), row('AAPL')];
        expect(await watchlist.isStockInWatchlist(HK_SYMBOL)).toBe(true);
        expect(mocks.findOne).toHaveBeenCalledWith({ userId: 'user-123', symbol: { $in: expect.arrayContaining(['0700.HK', 'HKEX:700', HK_SYMBOL]) } });
        await watchlist.removeFromWatchlist(HK_SYMBOL);
        expect(mocks.rows.map((item) => [item.userId, item.symbol])).toEqual([['other-user', HK_SYMBOL], ['user-123', 'AAPL']]);
    });

    it('finds legacy Shanghai and Beijing aliases without matching a different Taiwan exchange', async () => {
        mocks.rows = [row('600519.SH'), row('BSE:920001'), row('TPEX:6488')];
        expect(await watchlist.isStockInWatchlist('600519.SS')).toBe(true);
        expect(await watchlist.isStockInWatchlist('920001.BJ')).toBe(true);
        expect(await watchlist.isStockInWatchlist('6488.TWO')).toBe(true);
        expect(await watchlist.isStockInWatchlist('6488.TW')).toBe(false);
    });
});

describe('search merges canonical symbols across providers', () => {
    it('deduplicates local, Smartbox and Finnhub HK spellings while retaining TPEx identity', async () => {
        mocks.localSearch.mockReturnValue([
            { symbol: 'HKEX:700', name: 'Tencent', exchange: 'HKEX', type: '股票' },
            { symbol: '0700.HK', name: 'Duplicate', exchange: 'HKEX', type: '股票' },
            { symbol: '6488.TWO', name: 'TPEx', exchange: 'TPEX', type: '股票' },
        ]);
        mocks.fetch.mockImplementation(async (url: string) => url.includes('smartbox')
            ? new Response('v_hint="hk~00700~Tencent~~GP^bj~920001~Beijing~~GP-A"')
            : Response.json({ result: [
                { symbol: HK_SYMBOL, description: 'Finnhub Tencent', type: 'Common Stock' },
                { symbol: 'TWSE:6488', description: 'TWSE', type: 'Common Stock' },
                { symbol: 'AAPL', description: 'Apple', type: 'Common Stock', __exchange: 'NASDAQ' },
            ] }));
        const result = await finnhub.searchStocks('test');
        expect(result.map((item) => item.symbol)).toEqual([HK_SYMBOL, '6488.TWO', '920001.BJ', '6488.TW', 'AAPL']);
        expect(result.find((item) => item.symbol === HK_SYMBOL)?.name).toBe('Tencent');
        expect(result.find((item) => item.symbol === '920001.BJ')?.exchange).toBe('北交所 A股');
        expect(result.find((item) => item.symbol === 'AAPL')?.exchange).toBe('NASDAQ');
    });
});

describe('watchlist quote shaping preserves observation and source metadata', () => {
    it('retains saved fields and source-valid native quote metadata without changing the snapshot', async () => {
        const snapshot = { price: 90, currency: 'HKD', source: 'tencent', asOf: '2025-01-01T04:00:00.000Z',
            fetchedAt: '2025-01-01T04:00:01.000Z', priceBasis: 'last-trade' as const, adjustment: 'unadjusted' as const };
        const entry = { symbol: HK_SYMBOL, company: 'Tencent', addedAt: '2025-01-01T00:00:00.000Z',
            group: 'Core', note: 'Durable thesis', invalidation: 'Margin decline', targetPrice: 80,
            reviewStatus: 'validated' as const, reviewedAt: '2025-01-02T00:00:00.000Z',
            observationUpdatedAt: '2025-01-02T00:00:00.000Z', initialSnapshot: snapshot,
            nextReviewDate: '2026-11-09', proximityPercent: 0 };
        const quote = { price: 100, prevClose: 99, change: 1, changePercent: 1.01, currency: 'HKD',
            priceBasis: 'last-trade', source: 'tencent', asOf: '2025-02-01T04:00:00.000Z', fetchedAt: '2025-02-01T04:00:01.000Z' };
        mocks.realtime.mockResolvedValue({ [HK_SYMBOL]: quote });
        const [result] = await finnhub.getWatchlistData([entry]);
        expect(result).toMatchObject({ ...entry, price: 100, previousClose: 99, priceBasis: 'last-trade',
            source: 'tencent', asOf: quote.asOf, fetchedAt: quote.fetchedAt });
        expect(entry.initialSnapshot).toEqual(snapshot);
    });

    it('preserves observation fields in Finnhub fallback without manufacturing snapshot or fetch time', async () => {
        const entry = { symbol: 'AAPL', company: 'Apple', addedAt: '2025-01-01T00:00:00.000Z',
            note: 'Legacy note', reviewStatus: 'watching' as const,
            nextReviewDate: '2026-11-10', proximityPercent: 3 };
        mocks.fetch.mockImplementation(async (url: string) => Response.json(url.includes('profile2') ? {} : { c: 10, pc: 0, d: 0, dp: 0, t: 1_730_000_000 }));
        const [result] = await finnhub.getWatchlistData([entry]);
        expect(result).toMatchObject({ ...entry, price: 10, previousClose: 0, change: 0, changePercent: 0,
            source: 'Finnhub', priceBasis: 'last-trade', asOf: new Date(1_730_000_000_000).toISOString() });
        expect(result.initialSnapshot).toBeUndefined();
        expect(result.fetchedAt).toBeUndefined();
    });

    it.each([undefined, 0, 1e20])('does not invent or overflow a source timestamp for %s', async (timestamp) => {
        mocks.fetch.mockImplementation(async (url: string) => Response.json(url.includes('profile2') ? {} : { c: 10, t: timestamp }));
        const [result] = await finnhub.getWatchlistData(['AAPL']);
        expect(result.price).toBe(10);
        expect(result.asOf).toBeUndefined();
    });

    it('keeps Taiwan previous-close basis and Yahoo unknown basis distinct from last trade', async () => {
        mocks.realtime.mockResolvedValue({ '2330.TW': { price: 100, prevClose: 100, currency: 'TWD', priceBasis: 'previous-close', source: 'twse' } });
        mocks.yahoo.mockResolvedValue({ '2222.SR': { price: 30, prevClose: 29, currency: 'SAR' } });
        const [tw, saudi] = await finnhub.getWatchlistData([
            { symbol: '2330.TW', company: 'TSMC', addedAt: '2025-01-01T00:00:00.000Z', reviewStatus: 'watching', nextReviewDate: '2026-11-09', proximityPercent: 4 },
            { symbol: '2222.SR', company: 'Aramco', addedAt: '2025-01-01T00:00:00.000Z', reviewStatus: 'watching', nextReviewDate: '2026-11-10', proximityPercent: 0 },
        ]);
        expect(tw).toMatchObject({ priceBasis: 'previous-close', previousClose: 100, reviewStatus: 'watching', nextReviewDate: '2026-11-09', proximityPercent: 4 });
        expect(saudi).toMatchObject({ source: 'Yahoo Finance', previousClose: 29, nextReviewDate: '2026-11-10', proximityPercent: 0 });
        expect(saudi.priceBasis).toBeUndefined();
        expect(saudi.asOf).toBeUndefined();
    });
});

describe('Finnhub fallback quote provenance', () => {
    it('keeps absent OHLC, previous close, change and volume missing', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ c: 10 }));
        const { AAPL: quote } = await finnhub.getLiveQuotes(['AAPL']);
        expect(quote).toMatchObject({ price: 10, c: 10, t: 0 });
        for (const field of ['prevClose', 'open', 'high', 'low', 'change', 'changePercent', 'o', 'h', 'l', 'pc', 'd', 'dp', 'volume', 'asOf'] as const) {
            expect(quote?.[field]).toBeUndefined();
        }
    });

    it('preserves reported zeros in optional fields', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ c: 10, pc: 0, o: 0, h: 0, l: 0, d: 0, dp: 0 }));
        const { AAPL: quote } = await finnhub.getLiveQuotes(['AAPL']);
        expect(quote).toMatchObject({ prevClose: 0, open: 0, high: 0, low: 0, change: 0, changePercent: 0, pc: 0, o: 0, h: 0, l: 0, d: 0, dp: 0 });
    });

    it('rejects blank, null and invalid optional numbers without manufacturing zeros', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ c: 10, pc: null, o: '', h: '-', l: 'NaN', d: null, dp: '' }));
        const { AAPL: quote } = await finnhub.getLiveQuotes(['AAPL']);
        for (const field of ['prevClose', 'open', 'high', 'low', 'change', 'changePercent', 'o', 'h', 'l', 'pc', 'd', 'dp'] as const) {
            expect(quote?.[field]).toBeUndefined();
        }
    });

    it('derives missing change only from a positive previous close', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ c: 10, pc: 8 }));
        const { AAPL: quote } = await finnhub.getLiveQuotes(['AAPL']);
        expect(quote).toMatchObject({ prevClose: 8, change: 2, changePercent: 25, pc: 8, d: 2, dp: 25 });
    });

    it.each([0, -1, null])('does not derive change from invalid previous close %s', async (prevClose) => {
        mocks.fetch.mockResolvedValue(Response.json({ c: 10, pc: prevClose }));
        const { AAPL: quote } = await finnhub.getLiveQuotes(['AAPL']);
        expect(quote?.change).toBeUndefined();
        expect(quote?.changePercent).toBeUndefined();
    });

    it('keeps reported zero change rather than deriving a replacement', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ c: 10, pc: 8, d: 0, dp: 0 }));
        const { AAPL: quote } = await finnhub.getLiveQuotes(['AAPL']);
        expect(quote).toMatchObject({ change: 0, changePercent: 0, d: 0, dp: 0 });
    });

    it.each([null, 0, -1, 'NaN'])('requires a valid positive current price, rejecting %s', async (price) => {
        mocks.fetch.mockResolvedValue(Response.json({ c: price, pc: 8 }));
        expect((await finnhub.getLiveQuotes(['AAPL'])).AAPL).toBeNull();
    });

    it.each([0, 1_730_000_000])('preserves provider time %s without inventing a trade timestamp', async (timestamp) => {
        mocks.fetch.mockResolvedValue(Response.json({ c: 10, t: timestamp }));
        const result = await finnhub.getLiveQuotes(['AAPL']);
        expect(result.AAPL).toMatchObject({ source: 'Finnhub', fetchedAt: expect.any(String), volumeUnit: 'shares', t: timestamp });
        expect(result.AAPL?.asOf).toBe(timestamp ? new Date(timestamp * 1000).toISOString() : undefined);
    });
});

describe('Finnhub market capitalization ingestion', () => {
    it('converts explicit millions exactly once for cached profile and watchlist consumers', async () => {
        const raw = { name: 'Small cap', marketCapitalization: 24.88, currency: 'USD' };
        mocks.fetch.mockImplementation(async (url: string) => Response.json(url.includes('profile2') ? raw : { c: 10 }));
        expect((await finnhub.getCompanyProfile('SMALL'))?.marketCapitalization).toBe(24_880_000);
        expect((await finnhub.getCompanyProfile('SMALL'))?.marketCapitalization).toBe(24_880_000);
        const [result] = await finnhub.getWatchlistData(['SMALL']);
        expect(result.marketCap).toBe(24_880_000);
        expect(formatNumber(result.marketCap)).toBe('2488.00万');
        expect(raw.marketCapitalization).toBe(24.88);
        expect(mocks.fetch.mock.calls.filter(([url]) => String(url).includes('profile2'))).toHaveLength(1);
    });

    it('converts even million values above the old magnitude threshold', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ marketCapitalization: 100_000_000 }));
        expect((await finnhub.getCompanyProfile('LARGE'))?.marketCapitalization).toBe(100_000_000_000_000);
    });

    it('keeps omitted caps missing for profile and watchlist formatting', async () => {
        mocks.fetch.mockImplementation(async (url: string) => Response.json(url.includes('profile2') ? {} : { c: 10 }));
        expect((await finnhub.getCompanyProfile('MISSING'))?.marketCapitalization).toBeUndefined();
        const [result] = await finnhub.getWatchlistData(['MISSING']);
        expect(result.marketCap).toBeUndefined();
        expect(formatNumber(result.marketCap)).toBe('—');
    });

    it('passes absolute native small-cap values through unchanged', async () => {
        mocks.realtime.mockResolvedValue({ '600001.SS': { price: 10, marketCap: 24_880_000, currency: 'CNY' } });
        const [result] = await finnhub.getWatchlistData(['600001.SS']);
        expect(result.marketCap).toBe(24_880_000);
        expect(formatNumber(result.marketCap)).toBe('2488.00万');
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
});
