import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeries } from '@/lib/realtime-market';
import { compareRelativeHistory, getHistoricalBenchmarkOptions, relativeHistoryUnavailableReason } from '@/lib/market/relative-history';
import { getBenchmarkOptions } from '@/lib/market/comparison';

function history(symbol: string, closes = [100, 110, 111], overrides: Partial<ChartSeries> = {}): ChartSeries {
    return {
        symbol, market: 'cn', currency: 'CNY', source: 'tencent-kline', period: '1m', interval: 'day',
        adjustment: 'forward', provenance: { requestedAdjustment: 'forward', requestedKey: 'qfqday', actualKey: 'qfqday', sourceInterval: 'day' },
        points: closes.map((close, i) => ({ date: `2026-01-${String(i + 5).padStart(2, '0')}`, time: '', close })),
        latestPrice: 999, prevClose: 999, change: -900, changePercent: -90,
        periodHigh: 999, periodLow: 1, volumeUnit: 'shares', fetchedAt: '2026-11-07T00:00:00Z', ...overrides,
    };
}
const compare = (stock = history('600519.SS'), benchmark = history('000001.SS', [200, 210, 220])) => compareRelativeHistory('600519.SS', stock, '000001.SS', benchmark);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T01:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('common-date historical price comparison', () => {
    it('normalizes both starting closes to100 and compares endpoint ratios, ignoring daily/change/prevClose fields', () => {
        const result = compare();
        expect(result.status).toBe('available');
        if (result.status !== 'available') return;
        expect(result.points[0]).toMatchObject({ stockNormalized: 100, benchmarkNormalized: 100 });
        expect(result.stockChangePercent).toBeCloseTo(11);
        expect(result.benchmarkChangePercent).toBeCloseTo(10);
        expect(result.differencePercentagePoints).toBeCloseTo(1);
        expect(result).toMatchObject({ startDate: '2026-01-05', endDate: '2026-01-07', shortHistory: true, partialDates: false });
        expect(result.provenance.stock.actualKey).toBe('qfqday');
    });
    it('preserves real zero and negative changes', () => {
        const result = compare(history('600519.SS', [100, 100]), history('000001.SS', [200, 180]));
        expect(result).toMatchObject({ status: 'available', stockChangePercent: 0 });
        if (result.status === 'available') {
            expect(result.benchmarkChangePercent).toBeCloseTo(-10);
            expect(result.differencePercentagePoints).toBeCloseTo(10);
        }
    });
    it('selects the last20 actual common sessions from warmup history, with no calendar30-day cutoff', () => {
        const dates = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)))
            .filter(date => date.getUTCDay() > 0 && date.getUTCDay() < 6)
            .filter((_, i) => i % 2 === 0).map(date => date.toISOString().slice(0, 10));
        const points = dates.map((date, i) => ({ date, time: date, close: i + 100 }));
        const result = compare(history('600519.SS', [], { points: [...points].reverse() }), history('000001.SS', [], { points }));
        expect(result.status).toBe('available');
        if (result.status !== 'available') return;
        expect(result.points.map(point => point.date)).toEqual(dates.slice(-20));
        expect(result.shortHistory).toBe(false);
        expect(Date.parse(result.endDate) - Date.parse(result.startDate)).toBeGreaterThan(30 * 86400_000);
        expect(result.points[0].stockNormalized).toBe(100);
    });
    it('takes the date intersection without forward filling and discloses internal and trailing missing dates', () => {
        const stock = history('600519.SS', [100, 110, 120, 130, 140]);
        const benchmark = history('000001.SS', [200, 220, 240, 260]);
        benchmark.points.splice(1, 1);
        const result = compare(stock, benchmark);
        expect(result.status).toBe('available');
        if (result.status !== 'available') return;
        expect(result.points.map(point => point.date)).toEqual(['2026-01-05', '2026-01-07', '2026-01-08']);
        expect(result).toMatchObject({ partialDates: true, missingStockDates: [], missingBenchmarkDates: ['2026-01-06', '2026-01-09'], endDate: '2026-01-08' });
        expect(result.stockChangePercent).toBeCloseTo(30);
        expect(result.benchmarkChangePercent).toBeCloseTo(30);
    });
    it('discloses the other missing side and anchors at the first common date', () => {
        const stock = history('600519.SS', [100, 110, 120, 130]);
        stock.points.splice(0, 1);
        stock.points.splice(1, 1);
        const result = compare(stock, history('000001.SS', [200, 220, 240, 260]));
        expect(result).toMatchObject({ status: 'available', startDate: '2026-01-06', missingStockDates: ['2026-01-07'], partialDates: true });
        if (result.status === 'available') expect(result.points[0].stockNormalized).toBe(100);
    });
    it('excludes a forming current exchange day using exchange-local date, including the UTC date boundary', () => {
        vi.setSystemTime(new Date('2026-01-06T16:01:00Z'));
        const result = compare();
        expect(result).toMatchObject({ status: 'available', endDate: '2026-01-06' });
        if (result.status === 'available') expect(result.points).toHaveLength(2);
    });
    it('rejects null data, disjoint dates and a single common point', () => {
        expect(compareRelativeHistory('600519.SS', null, '000001.SS', history('000001.SS'))).toMatchObject({ status: 'unavailable' });
        for (const points of [[], [history('000001.SS').points[0]], [{ date: '2026-02-01', time: '', close: 1 }]]) {
            expect(compare(history('600519.SS'), history('000001.SS', [], { points }))).toMatchObject({ status: 'unavailable' });
        }
    });
    it.each([0, -1, NaN, Infinity])('rejects invalid close %s rather than dropping and filling it', close => {
        expect(compare(history('600519.SS', [100, close, 110]))).toMatchObject({ status: 'unavailable' });
    });
    it.each(['bad', '2026-02-30', '2026-1-06'])('rejects malformed date %s', date => {
        const stock = history('600519.SS');
        stock.points[1].date = date;
        expect(compare(stock)).toMatchObject({ status: 'unavailable' });
    });
    it('rejects duplicate dates and overflowing price ratios', () => {
        const stock = history('600519.SS');
        stock.points[1].date = stock.points[0].date;
        expect(compare(stock)).toMatchObject({ status: 'unavailable' });
        expect(compare(history('600519.SS', [Number.MIN_VALUE, Number.MAX_VALUE]))).toMatchObject({ status: 'unavailable' });
    });
});

describe('verified identity and adjustment gates', () => {
    it('offers the verified CN ETF proxy only for history, preserving daily benchmark choices', () => {
        expect(getHistoricalBenchmarkOptions('600519.SS')[0]).toEqual({ symbol: '510300.SS', label: '沪深300 ETF 代理（510300）', proxy: true });
        expect(getBenchmarkOptions('600519.SS').some(option => option.symbol === '510300.SS')).toBe(false);
        expect(getHistoricalBenchmarkOptions('600519.SS').slice(1)).toEqual(getBenchmarkOptions('600519.SS'));
        expect(getHistoricalBenchmarkOptions('832982.BJ')).toEqual([]);
        expect(getHistoricalBenchmarkOptions('700.HK')).toEqual(getBenchmarkOptions('700.HK'));
        const proxy = compareRelativeHistory('600519.SS', history('600519.SS'), '510300.SS', history('510300.SS'));
        expect(proxy).toMatchObject({ status: 'available', adjustment: 'forward', benchmark: { symbol: '510300.SS', proxy: true } });
    });
    it.each([
        { source: 'yahoo' }, { source: '' }, { symbol: '000001.SZ' }, { currency: 'USD' }, { market: 'hk' as const },
        { adjustment: 'unknown' as const }, { interval: 'week' as const }, { period: '1d' as const },
        { provenance: { requestedAdjustment: 'forward' as const, actualKey: 'day', sourceInterval: 'day' as const } },
    ])('rejects incompatible series: %j', override => {
        expect(compare(history('600519.SS', undefined, override))).toMatchObject({ status: 'unavailable' });
    });
    it('does not treat requested forward adjustment as proof when one series fell back to day', () => {
        const bare = history('000001.SS', undefined, { adjustment: 'unadjusted', provenance: { requestedAdjustment: 'forward', requestedKey: 'qfqday', actualKey: 'day', sourceInterval: 'day' } });
        expect(compare(history('600519.SS'), bare)).toMatchObject({ status: 'unavailable', reason: '前复权与不复权日线不能混合比较' });
        const bothBare = compare({ ...bare, symbol: '600519.SS' }, bare);
        expect(bothBare).toMatchObject({ status: 'available', adjustment: 'unadjusted' });
    });
    it('retains HK ETF proxy labels and permits both matched forward and matched bare fallback', () => {
        const hk = (symbol: string, adjustment: 'forward' | 'unadjusted') => history(symbol, undefined, {
            market: 'hk', currency: 'HKD', adjustment,
            provenance: { requestedAdjustment: 'forward', requestedKey: 'qfqday', actualKey: adjustment === 'forward' ? 'qfqday' : 'day', sourceInterval: 'day' },
        });
        for (const adjustment of ['forward', 'unadjusted'] as const) {
            expect(compareRelativeHistory('700.HK', hk('00700.HK', adjustment), '2800.HK', hk('02800.HK', adjustment))).toMatchObject({
                status: 'available', benchmark: { proxy: true, label: '盈富基金（恒指 ETF 代理）' }, adjustment,
            });
        }
        expect(compareRelativeHistory('700.HK', hk('00700.HK', 'forward'), '2800.HK', hk('02800.HK', 'unadjusted'))).toMatchObject({ status: 'unavailable' });
    });
    it('rejects unsupported benchmark/market and mismatching requested currency before fetching', () => {
        expect(relativeHistoryUnavailableReason('600519.SS', 'SPY')).toBeTruthy();
        expect(relativeHistoryUnavailableReason('832982.BJ', '000001.SS')).toBeTruthy();
        expect(relativeHistoryUnavailableReason('6488.TWO', '0050.TW')).toBeTruthy();
        expect(relativeHistoryUnavailableReason('600519.SS', '000001.SS', 'USD')).toContain('币种');
    });
    it.each([['AAPL', 'SPY'], ['2330.TW', '0050.TW']])('explicitly rejects the unverified source for %s', (symbol, benchmark) => {
        expect(relativeHistoryUnavailableReason(symbol, benchmark)).toContain('复权口径未验证');
        expect(compareRelativeHistory(symbol, history(symbol), benchmark, history(benchmark))).toMatchObject({ status: 'unavailable' });
    });
});
