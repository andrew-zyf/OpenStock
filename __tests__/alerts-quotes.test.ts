import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchQuotes = vi.hoisted(() => vi.fn());
vi.mock('@/lib/realtime-market', () => ({ fetchRealtimeQuotes: fetchQuotes }));
// These display paths must never supply an alert's freshness-critical quote.
const cachedQuote = vi.hoisted(() => vi.fn(() => { throw new Error('hourly quote path must not be used'); }));
vi.mock('@/lib/actions/finnhub.actions', () => ({ getQuote: cachedQuote, getLiveQuotes: cachedQuote }));
import { getAlertObservations, validateAlertQuote } from '@/lib/alerts/quotes';
import { evaluateSample } from '@/lib/alerts/evaluation';

const nativeNow = new Date('2026-11-09T02:00:00.000Z');
const usNow = new Date('2026-11-09T15:00:00.000Z');
const quote = (asOf = '2026-11-09T01:59:30.000Z') => ({ price: 101, priceBasis: 'last-trade' as const, source: 'tencent', asOf });
const network = vi.hoisted(() => vi.fn());
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', network);
    vi.stubEnv('FINNHUB_API_KEYS', 'mock-key');
    network.mockResolvedValue({ ok: true, status: 200, json: async () => ({ c: 101, t: usNow.getTime() / 1000 - 20 }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('native alert adapter with real session calendars', () => {
    it('prices CN/HK/TW/OTC through the fast adapter without hourly fallback', async () => {
        const symbols = ['600519.SS', '09988.HK', '2330.TW', '6488.TWO'];
        fetchQuotes.mockResolvedValue(Object.fromEntries(symbols.map(symbol => [symbol, quote()])));
        const result = await getAlertObservations(symbols, nativeNow);
        for (const symbol of symbols) expect(result[symbol]).toEqual({ price: 101, source: 'tencent', asOf: quote().asOf });
        expect(fetchQuotes).toHaveBeenCalledWith(symbols);
        expect(cachedQuote).not.toHaveBeenCalled();
        expect(network).not.toHaveBeenCalled();
    });
    it.each([
        ['600519.SS', '2026-11-09T04:00:00.000Z'], // CN lunch
        ['09988.HK', '2026-11-09T09:00:00.000Z'], // HK closed
        ['2330.TW', '2026-02-13T02:00:00.000Z'], // TW settlement-only date
        ['AAPL', '2026-11-26T15:00:00.000Z'], // US holiday
        ['600519.SS', '2027-01-04T02:00:00.000Z'], // weekday schedule, unverified year
    ])('rejects closed or unverified calendar for %s at %s', async (symbol, time) => {
        fetchQuotes.mockResolvedValue({ [symbol]: quote(time) });
        expect((await getAlertObservations([symbol], new Date(time)))[symbol]).toBeNull();
        expect(network).not.toHaveBeenCalled();
    });
    it.each([
        ['AAPL', '2026-11-09T21:00:00.000Z', '2026-11-09T20:59:50.000Z', '2026-11-09T20:55:00.000Z'],
        ['002594.SZ', '2026-11-09T03:30:00.000Z', '2026-11-09T03:29:50.000Z', '2026-11-09T03:25:00.000Z'],
    ])('keeps the last fresh real crossing when the cron reaches close/lunch: %s', async (symbol, checkedAt, sourceTime, priorTime) => {
        fetchQuotes.mockResolvedValue({ [symbol]: quote(sourceTime) });
        const result = (await getAlertObservations([symbol], new Date(checkedAt)))[symbol];
        expect(result).not.toBeNull();
        expect(evaluateSample({ mode: 'crossing', targetPrice: 100, condition: 'ABOVE', lastObservation: { price: 99, asOf: priorTime, source: 'tencent' } }, result!)).toBe('trigger');
        // A provider clock refreshed after the session closed must not pass as an actual trade.
        expect(validateAlertQuote(symbol, quote(checkedAt), new Date(checkedAt))).toBeNull();
    });
    it('does not treat a source timestamp during preopen as a regular-trading observation', () => {
        expect(validateAlertQuote('600519.SS', quote('2026-11-09T01:29:30.000Z'), new Date('2026-11-09T01:30:30.000Z'))).toBeNull();
    });
    it('does not use the Taiwanese previous-close substitution even with a recent source clock', async () => {
        fetchQuotes.mockResolvedValue({ '2330.TW': { ...quote(), priceBasis: 'previous-close' } });
        expect((await getAlertObservations(['2330.TW'], nativeNow))['2330.TW']).toBeNull();
    });
});

describe('legacy crypto compatibility without enabling new crypto alerts', () => {
    const symbol = 'BINANCE:BTCUSDT';
    const sunday = new Date('2026-11-08T02:00:00.000Z');
    it('uses a direct timestamped Finnhub quote on weekends only for explicit legacy records', async () => {
        fetchQuotes.mockResolvedValue({ [symbol]: null });
        network.mockResolvedValue({ ok: true, status: 200, json: async () => ({ c: 101, t: sunday.getTime() / 1000 - 20 }) });
        const sample = (await getAlertObservations([symbol], sunday, [symbol]))[symbol];
        expect(sample).toEqual({ price: 101, source: 'finnhub', asOf: '2026-11-08T01:59:40.000Z' });
        expect(evaluateSample({ targetPrice: 100, condition: 'ABOVE' }, sample!)).toBe('trigger');
        expect(network).toHaveBeenCalledWith('https://finnhub.io/api/v1/quote?symbol=BINANCE%3ABTCUSDT', expect.objectContaining({ cache: 'no-store' }));
        network.mockClear();
        expect((await getAlertObservations([symbol], sunday))[symbol]).toBeNull();
        expect(network).not.toHaveBeenCalled();
    });
    it.each([
        { c: 101, t: 0 }, { c: 101, t: sunday.getTime() / 1000 - 121 },
        { c: 101, t: sunday.getTime() / 1000 + 1 }, { c: 0, t: sunday.getTime() / 1000 },
    ])('still rejects missing-time, stale, future and invalid crypto values %j', async values => {
        fetchQuotes.mockResolvedValue({ [symbol]: null });
        network.mockResolvedValueOnce({ ok: true, status: 200, json: async () => values });
        expect((await getAlertObservations([symbol], sunday, [symbol]))[symbol]).toBeNull();
    });
});

describe('fresh US fallback', () => {
    it('uses an explicitly no-store Finnhub request when native data is stale', async () => {
        fetchQuotes.mockResolvedValue({ AAPL: quote('2026-11-09T14:45:00.000Z') });
        expect((await getAlertObservations(['AAPL'], usNow)).AAPL).toEqual({ price: 101, source: 'finnhub', asOf: '2026-11-09T14:59:40.000Z' });
        expect(network).toHaveBeenCalledWith('https://finnhub.io/api/v1/quote?symbol=AAPL', expect.objectContaining({ cache: 'no-store', headers: { 'X-Finnhub-Token': 'mock-key' } }));
        expect(cachedQuote).not.toHaveBeenCalled();
    });
    it('retains fresh native US samples without making an extra request', async () => {
        fetchQuotes.mockResolvedValue({ AAPL: quote('2026-11-09T14:59:30.000Z') });
        expect((await getAlertObservations(['AAPL'], usNow)).AAPL?.source).toBe('tencent');
        expect(network).not.toHaveBeenCalled();
    });
    it.each([
        { c: 101, t: 0 }, { c: 0, t: usNow.getTime() / 1000 },
        { c: 101, t: usNow.getTime() / 1000 - 121 },
        { c: 101, t: usNow.getTime() / 1000 + 1 }, { c: 101 },
    ])('rejects unsafe Finnhub source values %j', async values => {
        fetchQuotes.mockResolvedValue({ AAPL: null });
        network.mockResolvedValueOnce({ ok: true, status: 200, json: async () => values });
        expect((await getAlertObservations(['AAPL'], usNow)).AAPL).toBeNull();
    });
    it('does not invent a quote if no key is configured', async () => {
        vi.stubEnv('FINNHUB_API_KEYS', '');
        vi.stubEnv('NEXT_PUBLIC_FINNHUB_API_KEY', '');
        vi.stubEnv('FINNHUB_API_KEY', '');
        fetchQuotes.mockResolvedValue({ AAPL: null });
        expect((await getAlertObservations(['AAPL'], usNow)).AAPL).toBeNull();
        expect(network).not.toHaveBeenCalled();
    });
});
