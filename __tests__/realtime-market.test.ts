import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCapitalFlow, fetchLevel1OrderBook, fetchRealtimeQuotes, fetchUnifiedChartSeries } from '@/lib/realtime-market';

const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function tencent(code: string, fields: Record<number, string | number> = {}) {
    const parts = Array(65).fill('');
    Object.assign(parts, { 1: 'Fixture', 3: 10, 4: 9, 5: 9.5, 6: 123, 30: '20261106150000', 31: 1, 32: 11.111, 33: 12, 34: 8, ...fields });
    return `v_${code}="${parts.join('~')}";`;
}
const twItem = (overrides: Record<string, unknown> = {}) => ({
    c: '2330', ex: 'tse', n: 'Fixture', z: '100', y: '95', h: '110', l: '90', o: '96', v: '123',
    t: '13:29:59', tlong: String(Date.parse('2026-11-06T05:29:59Z')),
    b: '99_98_', g: '2_0_', a: '101_102_', f: '3_4_', tv: '7', ...overrides,
});
const mockFetch = (handler: (url: string) => Response | Promise<Response>) => {
    const mock = vi.fn((input: string | URL | Request) => Promise.resolve(handler(String(input))));
    vi.stubGlobal('fetch', mock);
    return mock;
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('provider quotes', () => {
    it('deduplicates aliases, fans out original keys, normalizes units and uses source time', async () => {
        const fetch = mockFetch(url => {
            expect(url).toBe('https://qt.gtimg.cn/q=sh600519,r_hk00700,usAAPL');
            return new Response(tencent('sh600519', { 37: 12, 45: 2, 39: 0 }) + tencent('r_hk00700', { 37: 1200 }) + tencent('usAAPL', { 37: 3456, 30: '2026-11-06 16:00:00' }));
        });
        const quotes = await fetchRealtimeQuotes(['600519.SS', 'SSE:600519', '700', '0700.HK', 'AAPL']);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(quotes['600519.SS']).toMatchObject({ symbol: '600519.SS', volume: 12300, volumeUnit: 'shares', turnover: 120000, marketCap: 200000000, pe: 0, source: 'tencent', asOf: '2026-11-06T07:00:00.000Z', t: Date.parse('2026-11-06T07:00:00Z') / 1000 });
        expect(quotes['SSE:600519']).toEqual({ ...quotes['600519.SS'], symbol: 'SSE:600519' });
        expect(quotes['0700.HK']).toEqual({ ...quotes['700'], symbol: '0700.HK' });
        expect(quotes['700']).toMatchObject({ volume: 123, turnover: 1200 });
        expect(quotes.AAPL).toMatchObject({ volume: 123, turnover: 3456, asOf: '2026-11-06T21:00:00.000Z' });
        expect(quotes.AAPL?.pb).toBeUndefined();
        expect(quotes.AAPL?.fetchedAt).toBeTruthy();
    });
    it('does not label fetch time as a source trade time or invent missing optional numbers', async () => {
        mockFetch(() => new Response(tencent('sh600519', { 30: '', 37: '-', 38: '', 39: '-', 43: '', 45: '', 46: '', 47: '0' })));
        const quote = (await fetchRealtimeQuotes(['600519.SS']))['600519.SS'];
        expect(quote).toMatchObject({ t: 0, updatedAt: '', limitUp: 0 });
        for (const key of ['asOf', 'turnover', 'turnoverRate', 'pe', 'marketCap', 'amplitude', 'pb'] as const) expect(quote?.[key]).toBeUndefined();
    });
    it.each([['', undefined], ['-', undefined], ['0', 0]] as const)('distinguishes missing quote volume from reported zero across markets: %s', async (rawVolume, expected) => {
        mockFetch(url => {
            if (url.includes('qt.gtimg')) return new Response(tencent('sh600519', { 6: rawVolume }) + tencent('r_hk00700', { 6: rawVolume }) + tencent('usAAPL', { 6: rawVolume }));
            if (url.includes('mis.twse')) return response({ msgArray: [twItem({ v: rawVolume })] });
            return url.includes('BWIBBU') ? response([]) : response([{ '公司代號': '2330', '已發行普通股數或TDR原股發行股數': '1000000' }]);
        });
        const quotes = await fetchRealtimeQuotes(['600519.SS', '700', 'AAPL', '2330.TW']);
        for (const quote of Object.values(quotes)) {
            expect(quote).not.toBeNull();
            expect(quote?.volume).toBe(expected);
        }
        expect(quotes['2330.TW']?.turnoverRate).toBe(expected);
    });
    it('leaves missing OHLC, references and changes absent across all quote markets', async () => {
        mockFetch(url => {
            if (url.includes('qt.gtimg')) return new Response(['sh600519', 'r_hk00700', 'usAAPL'].map(code => tencent(code, { 4: '-', 5: '', 31: '', 32: '-', 33: '-', 34: '' })).join(''));
            return url.includes('mis.twse') ? response({ msgArray: [twItem({ y: '-', o: '', h: '-', l: '' })] }) : response([]);
        });
        const quotes = await fetchRealtimeQuotes(['600519.SS', '700', 'AAPL', '2330.TW']);
        for (const quote of Object.values(quotes)) {
            expect(quote?.price).toBeGreaterThan(0);
            expect(quote?.c).toBe(quote?.price);
            for (const key of ['prevClose', 'open', 'high', 'low', 'change', 'changePercent', 'pc', 'o', 'h', 'l', 'd', 'dp'] as const) expect(quote?.[key]).toBeUndefined();
        }
        expect(quotes['2330.TW']?.amplitude).toBeUndefined();
    });
    it.each(['', '-', '0', '-1'])('does not derive Tencent changes from an invalid reference: %s', async reference => {
        mockFetch(() => new Response(tencent('sh600519', { 4: reference, 31: '', 32: '-' })));
        const quote = (await fetchRealtimeQuotes(['600519.SS']))['600519.SS'];
        for (const key of ['change', 'changePercent', 'd', 'dp'] as const) expect(quote?.[key]).toBeUndefined();
    });
    it('retains provider changes without a reference and derives only from a valid reference', async () => {
        mockFetch(() => new Response(tencent('sh600519', { 4: '', 31: 0, 32: 0 }) + tencent('usAAPL', { 4: 9, 31: '', 32: '-' })));
        const quotes = await fetchRealtimeQuotes(['600519.SS', 'AAPL']);
        expect(quotes['600519.SS']).toMatchObject({ change: 0, changePercent: 0, d: 0, dp: 0 });
        expect(quotes['600519.SS']?.prevClose).toBeUndefined();
        expect(quotes.AAPL).toMatchObject({ change: 1, changePercent: 11.111, d: 1 });
        expect(quotes.AAPL?.dp).toBeCloseTo(11.111111);
    });
    it('marks Taiwan previous-close display prices without inventing a trade or day change', async () => {
        mockFetch(url => url.includes('mis.twse') ? response({ msgArray: [twItem({ z: '-', o: '-', h: '', l: '-' })] }) : response([]));
        const quote = (await fetchRealtimeQuotes(['2330.TW']))['2330.TW'];
        const book = await fetchLevel1OrderBook('2330.TW');
        expect(quote).toMatchObject({ price: 95, c: 95, prevClose: 95, pc: 95, priceBasis: 'previous-close' });
        for (const key of ['open', 'high', 'low', 'change', 'changePercent', 'o', 'h', 'l', 'd', 'dp', 'amplitude'] as const) expect(quote?.[key]).toBeUndefined();
        expect(book).toMatchObject({ latestPrice: 95, priceBasis: 'previous-close', prevClose: 95, ticks: [] });
        expect(book?.change).toBeUndefined();
        expect(book?.changePercent).toBeUndefined();
    });
    it.each(['600519.SS', '2330.TW'])('preserves missing references in order books: %s', async symbol => {
        mockFetch(url => {
            if (url.includes('details/get')) return response({ data: { details: [] } });
            if (url.includes('qt.gtimg')) return new Response(tencent('sh600519', { 4: '-', 31: '-', 32: '', 9: 9, 10: 2 }));
            return response({ msgArray: [twItem({ y: '-' })] });
        });
        const book = await fetchLevel1OrderBook(symbol);
        expect(book).not.toBeNull();
        expect(book?.prevClose).toBeUndefined();
        expect(book?.change).toBeUndefined();
        expect(book?.changePercent).toBeUndefined();
    });
    it('does not send unsupported BSE to Shenzhen or any other endpoint', async () => {
        const fetch = mockFetch(() => { throw new Error('unexpected network'); });
        expect(await fetchRealtimeQuotes(['830799', '920001.BJ'])).toEqual({ '830799': null, '920001.BJ': null });
        expect(await fetchLevel1OrderBook('BSE:430047')).toBeNull();
        expect(await fetchCapitalFlow('830799.BJ')).toBeNull();
        expect(await fetchUnifiedChartSeries('920001', '1m')).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each(['reject', 'bad object', 'bad json', 'null rows'])('keeps valid MIS quotes when optional fundamentals fail: %s', async mode => {
        mockFetch(url => {
            if (url.includes('mis.twse')) return response({ msgArray: [twItem()] });
            if (mode === 'reject') return Promise.reject(new Error('optional unavailable'));
            if (mode === 'bad json') return new Response('{');
            if (mode === 'null rows') return response([null, 42]);
            return response({ error: 'unavailable' });
        });
        const quote = (await fetchRealtimeQuotes(['2330.TW']))['2330.TW'];
        expect(quote).toMatchObject({ price: 100, volume: 123000, volumeUnit: 'shares', source: 'twse-mis', asOf: '2026-11-06T05:29:59.000Z' });
        expect(quote?.turnover).toBeUndefined();
        expect(quote?.marketCap).toBeUndefined();
        expect(quote?.pe).toBeUndefined();
        expect(quote?.pb).toBeUndefined();
    });
    it('bounds optional fundamentals even if fetch ignores AbortSignal', async () => {
        vi.useFakeTimers();
        mockFetch(url => url.includes('mis.twse') ? response({ msgArray: [twItem()] }) : new Promise(() => {}));
        const pending = fetchRealtimeQuotes(['2330.TW']);
        await vi.advanceTimersByTimeAsync(1201);
        expect((await pending)['2330.TW']?.price).toBe(100);
    });
    it('enriches only from validated official fields and retains actual zero valuations', async () => {
        mockFetch(url => url.includes('mis.twse') ? response({ msgArray: [twItem()] })
            : url.includes('BWIBBU') ? response([{ Code: '2330', PEratio: '0', PBratio: '2' }])
                : response([{ '公司代號': '2330', '已發行普通股數或TDR原股發行股數': '1000000' }]));
        expect((await fetchRealtimeQuotes(['2330.TW']))['2330.TW']).toMatchObject({ marketCap: 100000000, turnoverRate: 12.3, pe: 0, pb: 2 });
    });
    it('uses exact OTC identity and never borrows listed-company fundamentals', async () => {
        const fetch = mockFetch(url => {
            expect(url).toContain('ex_ch=otc_6488.two');
            expect(url.match(/otc_6488.two/g)).toHaveLength(1);
            return response({ msgArray: [twItem({ c: '6488', ex: 'tse', z: '1' }), twItem({ c: '6488', ex: 'otc', z: '200', tlong: '-' })] });
        });
        const quotes = await fetchRealtimeQuotes(['6488.TWO', 'TPEX:6488']);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(quotes['6488.TWO']).toMatchObject({ symbol: '6488.TWO', price: 200, exchange: '台湾柜买中心', t: 0, updatedAt: '' });
        expect(quotes['TPEX:6488']?.price).toBe(200);
    });
    it('bounds essential quote requests too', async () => {
        vi.useFakeTimers();
        mockFetch(() => new Promise(() => {}));
        const pending = fetchRealtimeQuotes(['AAPL']);
        await vi.advanceTimersByTimeAsync(6001);
        expect(await pending).toEqual({ AAPL: null });
    });
});

describe('real depth, executions and capital flow', () => {
    it('returns no HK depth or synthetic ratios while preserving actual ticks', async () => {
        mockFetch(url => url.includes('details/get') ? response({ data: { details: ['15:59:59,100,200,1,2'] } }) : new Response(tencent('r_hk00700')));
        const book = await fetchLevel1OrderBook('700');
        expect(book).toMatchObject({ bids: [], asks: [], depthAvailable: false, tickKind: 'history', ticks: [{ time: '15:59:59', price: 100, volume: 200, side: 'B' }] });
        expect(book?.totalBidVol).toBeUndefined();
        expect(book?.orderRatio).toBeUndefined();
        expect(book?.orderDelta).toBeUndefined();
    });
    it('returns null for HK when no actual executions are supplied', async () => {
        mockFetch(url => url.includes('details/get') ? response({ data: { details: [] } }) : new Response(tencent('r_hk00700')));
        expect(await fetchLevel1OrderBook('700')).toBeNull();
    });
    it('only returns validated CN depth tiers and normalizes lots to shares', async () => {
        mockFetch(url => url.includes('details/get') ? response({ data: { details: [] } }) : new Response(tencent('sh600519', { 9: 9.9, 10: 2, 11: '-', 12: 100, 19: 10.1, 20: 3 })));
        expect(await fetchLevel1OrderBook('600519.SS')).toMatchObject({ depthAvailable: true, bids: [{ price: 9.9, volume: 200 }], asks: [{ price: 10.1, volume: 300 }], totalBidVol: 200, totalAskVol: 300, orderRatio: -20 });
    });
    it.each(['600519.SS', '2330.TW'])('preserves source depth levels across missing price and size slots: %s', async symbol => {
        mockFetch(url => {
            if (url.includes('details/get')) return response({ data: { details: [] } });
            if (url.includes('qt.gtimg')) return new Response(tencent('sh600519', { 9: '-', 10: 1, 11: 9.8, 12: '-', 13: 9.7, 14: 2, 19: 10.1, 20: '-', 21: 10.2, 22: 3 }));
            return response({ msgArray: [twItem({ b: '-_9.8_9.7_', g: '1_-_2_', a: '10.1_10.2_', f: '-_3_' })] });
        });
        const factor = symbol.endsWith('.TW') ? 1000 : 100;
        const book = await fetchLevel1OrderBook(symbol);
        expect(book?.bids).toEqual([{ level: 3, price: 9.7, volume: 2 * factor }]);
        expect(book?.asks).toEqual([{ level: 2, price: 10.2, volume: 3 * factor }]);
    });
    it('uses OTC MIS identity and returns one real neutral execution snapshot', async () => {
        mockFetch(url => {
            expect(url).toContain('otc_6488.two');
            return response({ msgArray: [twItem({ c: '6488', ex: 'otc' })] });
        });
        const book = await fetchLevel1OrderBook('6488.TWO');
        expect(book).toMatchObject({ tickKind: 'snapshot', volumeUnit: 'shares', bids: [{ price: 99, volume: 2000 }, { price: 98, volume: 0 }], ticks: [{ time: '13:29:59', price: 100, volume: 7000, side: 'N' }], asOf: '2026-11-06T05:29:59.000Z' });
    });
    it('preserves a real TW execution when depth is absent without deriving depth metrics', async () => {
        mockFetch(() => response({ msgArray: [twItem({ b: '-', g: '-', a: '-', f: '-' })] }));
        const book = await fetchLevel1OrderBook('2330.TW');
        expect(book).toMatchObject({ depthAvailable: false, bids: [], asks: [], ticks: [{ time: '13:29:59', price: 100, volume: 7000, side: 'N' }] });
        expect(book?.totalBidVol).toBeUndefined();
        expect(book?.orderRatio).toBeUndefined();
    });
    it.each([{ tv: '-' }, { t: '' }, { z: '-' }])('does not invent a snapshot when execution fields are absent: %j', overrides => {
        mockFetch(() => response({ msgArray: [twItem(overrides)] }));
        return expect(fetchLevel1OrderBook('2330.TW')).resolves.toMatchObject({ ticks: [] });
    });
    it('never derives Taiwan capital flow from quote direction', async () => {
        const fetch = mockFetch(() => { throw new Error('unexpected'); });
        expect(await fetchCapitalFlow('2330.TW')).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
    it('keeps actual zero HK flow, missing categories absent, and source time distinct', async () => {
        mockFetch(url => {
            expect(url).toContain('secids=116.00005');
            return response({ data: { diff: [{ f14: 'Fixture', f62: 0, f66: '-', f184: '-', f72: '25', f124: 1793952000 }] } });
        });
        const flow = await fetchCapitalFlow('5.HK');
        expect(flow).toMatchObject({ mainNetInflow: 0, largeInflow: 25, source: 'eastmoney', asOf: new Date(1793952000000).toISOString() });
        expect(flow?.superLargeInflow).toBeUndefined();
        expect(flow?.mainNetRatio).toBeUndefined();
        expect(flow?.smallRatio).toBeUndefined();
    });
    it('returns null for all missing flow fields', async () => {
        mockFetch(() => response({ data: { diff: [{ f62: '-', f66: '' }] } }));
        expect(await fetchCapitalFlow('600519.SS')).toBeNull();
    });
});

const daily = (date: string, close: number) => [date, close - 1, close, close + 5, close - 5, 10];
describe('chart interval semantics', () => {
    it.each(['600519.SS', '700'])('does not substitute five daily candles for five intraday sessions: %s', async symbol => {
        const fetch = mockFetch(() => { throw new Error('unexpected'); });
        expect(await fetchUnifiedChartSeries(symbol, '5d')).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each([
        ['1m', 'day', 160], ['3m', 'day', 240], ['1y', 'week', 172], ['5y', 'month', 180],
    ] as const)('requests native CN/HK %s resolution with sufficient warmup', async (period, interval, count) => {
        mockFetch(url => {
            expect(url).toContain(`hk00700,${interval},,,${count},qfq`);
            return new Response(`kline=${JSON.stringify({ data: { hk00700: { [`qfq${interval}`]: [daily('2026-11-06', 20), daily('2026-11-05', 10)] } } })};`);
        });
        const chart = await fetchUnifiedChartSeries('700', period);
        expect(chart).toMatchObject({ interval, volumeUnit: 'shares', periodHigh: 25, periodLow: 5, source: 'tencent-kline' });
        expect(chart?.points.map(point => point.date)).toEqual(['2026-11-05', '2026-11-06']);
    });
    it('uses actual Tencent session date and quote previous close, without fake VWAP', async () => {
        mockFetch(() => response({ data: { sh600519: { data: { date: '20261106', data: ['0931 110 1', '0930 100 0'] }, qt: { sh600519: ['', '', '', '110', '90'] } } } }));
        const chart = await fetchUnifiedChartSeries('600519.SS', '1d');
        expect(chart).toMatchObject({ interval: 'minute', prevClose: 90, change: 20, asOf: '2026-11-06T01:31:00.000Z' });
        expect(chart?.points[0]).toMatchObject({ time: '09:30', date: '2026-11-06' });
        expect(chart?.points[0].avgPrice).toBeUndefined();
        expect(chart?.points[1].volume).toBe(100);
    });
    it('uses actual source session highs/lows rather than only sampled minute closes', async () => {
        const parts = Array(60).fill('');
        Object.assign(parts, { 4: '90', 5: '95', 6: '100', 33: '125', 34: '80', 37: '1000' });
        mockFetch(() => response({ data: { sh600519: { data: { date: '20261106', data: ['0930 100 1'] }, qt: { sh600519: parts } } } }));
        expect(await fetchUnifiedChartSeries('600519.SS', '1d')).toMatchObject({ periodHigh: 125, periodLow: 80, high: 125, low: 80, open: 95, volume: 10000, turnover: 10000000 });
    });
    it('computes VWAP only from actual cumulative amount and normalized volume', async () => {
        mockFetch(() => response({ data: { sh600519: { data: { date: '20261106', data: ['0930 100 2 20000', '0931 110 3 31000'] } } } }));
        const chart = await fetchUnifiedChartSeries('600519.SS', '1d');
        expect(chart?.points[0].avgPrice).toBe(100);
        expect(chart?.points[1].avgPrice).toBeCloseTo(103.333333);
        expect(chart?.prevClose).toBeUndefined();
    });
    it.each([
        ['1m', 'D', 160], ['3m', 'D', 240], ['1y', 'W', 172], ['5y', 'M', 180],
    ] as const)('requests Taiwan %s with native resolution and sorts descending responses', async (period, resolution, count) => {
        mockFetch(url => {
            expect(url).toContain(`resolution=${resolution}`);
            expect(url).toContain(`countback=${count}`);
            return response({ data: { t: [1793930400, 1793844000], c: [20, 10], o: [19, 9], h: [25, 15], l: [15, 5], v: [200, 100] } });
        });
        const chart = await fetchUnifiedChartSeries('2330.TW', period);
        expect(chart?.points.map(point => point.close)).toEqual([10, 20]);
        expect(chart?.points.map(point => point.volume)).toEqual([100000, 200000]);
        expect(chart).toMatchObject({ periodHigh: 25, periodLow: 5, volumeUnit: 'shares' });
        expect(chart?.points[0].avgPrice).toBeUndefined();
    });
    it.each([['1d', 5833, 5833000], ['1m', 110714.587, 110714587]] as const)('normalizes verified cnYES lot volumes to shares for %s', async (period, lots, shares) => {
        mockFetch(url => {
            if (url.includes('cnyes')) return response({ data: { t: [1793943000], c: [100], v: [lots] } });
            return url.includes('mis.twse') ? response({ msgArray: [twItem()] }) : response([]);
        });
        const chart = await fetchUnifiedChartSeries('2330.TW', period);
        expect(chart?.volumeUnit).toBe('shares');
        expect(chart?.points[0].volume).toBeCloseTo(shares, 3);
    });
    it('caps Taiwan five-day data at five actual sessions, not 1200 days or five daily bars', async () => {
        const dates = ['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
        mockFetch(url => {
            if (url.includes('cnyes')) {
                expect(url).toContain('resolution=1');
                const timestamps = dates.flatMap(date => [Date.parse(`${date}T01:00:00Z`) / 1000, Date.parse(`${date}T01:01:00Z`) / 1000]);
                return response({ data: { t: timestamps.reverse(), c: timestamps.map((_, i) => 20 - i), v: timestamps.map(() => 5833) } });
            }
            return url.includes('mis.twse') ? response({ msgArray: [twItem()] }) : response([]);
        });
        const chart = await fetchUnifiedChartSeries('2330.TW', '5d');
        expect([...new Set(chart?.points.map(point => point.date))]).toEqual(dates.slice(-5));
        expect(chart?.points).toHaveLength(10);
        expect(chart?.points.every(point => point.volume === 5833000)).toBe(true);
        expect(chart?.prevClose).toBe(95);
    });
    it('rejects five daily bars returned in response to a Taiwan minute request', async () => {
        mockFetch(() => response({ data: { t: [1, 2, 3, 4, 5].map(day => Date.parse(`2026-11-0${day}T05:30:00Z`) / 1000), c: [1, 2, 3, 4, 5] } }));
        expect(await fetchUnifiedChartSeries('2330.TW', '5d')).toBeNull();
    });
    it('returns null when Taiwan cannot supply five intraday sessions', async () => {
        mockFetch(() => response({ data: { t: [1793930400], c: [10] } }));
        expect(await fetchUnifiedChartSeries('2330.TW', '5d')).toBeNull();
    });
    it('does not route unverified OTC history to the listed cnYES exchange', async () => {
        const fetch = mockFetch(() => { throw new Error('unexpected'); });
        expect(await fetchUnifiedChartSeries('6488.TWO', '1m')).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
    it('uses Yahoo native weekly and monthly bars and actual candle extrema', async () => {
        const fetch = mockFetch(url => {
            expect(url).toMatch(/interval=1(wk|mo)/);
            return response({ chart: { result: [{ timestamp: [1793930400], meta: { chartPreviousClose: 9 }, indicators: { quote: [{ close: [10], high: [15], low: [5], volume: [0] }] } }] } });
        });
        for (const period of ['1y', '5y'] as const) {
            expect(await fetchUnifiedChartSeries('AAPL', period)).toMatchObject({ periodHigh: 15, periodLow: 5, prevClose: 9, points: [{ close: 10, high: 15, low: 5, volume: 0 }] });
        }
        expect(fetch).toHaveBeenCalledTimes(2);
    });
    it('bounds chart upstream calls', async () => {
        vi.useFakeTimers();
        mockFetch(() => new Promise(() => {}));
        const pending = fetchUnifiedChartSeries('600519.SS', '1m');
        await vi.advanceTimersByTimeAsync(6001);
        expect(await pending).toBeNull();
    });
});
