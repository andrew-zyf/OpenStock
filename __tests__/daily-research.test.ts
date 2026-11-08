import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeries } from '@/lib/realtime-market';
import { canonicalPeerMember, compareDailyResearch, compareDailyVolume, createDailyHistoryLoader, validatePeerGroupInput } from '@/lib/market/daily-research';
import { compareRelativeHistory } from '@/lib/market/relative-history';

function history(symbol = '000001.SZ', count = 21, overrides: Partial<ChartSeries> = {}): ChartSeries {
    return {
        symbol, market: 'cn', currency: 'CNY', source: 'tencent-kline', period: '3m', interval: 'day',
        adjustment: 'forward', provenance: { requestedAdjustment: 'forward', actualKey: 'qfqday', sourceInterval: 'day' },
        points: Array.from({ length: count }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10), time: '', close: 100 + i, volume: 1000 + i * 100 })),
        latestPrice: 999, change: -99, changePercent: -99, periodHigh: 999, periodLow: 1, volumeUnit: 'shares', fetchedAt: '2026-11-07T00:00:00Z', ...overrides,
    };
}
const comparison = (count: number) => compareDailyResearch('000001.SZ', history('000001.SZ', count), '510300.SS', history('510300.SS', count));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T00:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('daily interval boundaries and completed basis', () => {
    it('requires six closes for five intervals and 21 closes for20; 20 closes cannot be called20 intervals', () => {
        expect(comparison(5)).toMatchObject({ status: 'available', five: { status: 'unavailable', commonPoints: 5, requiredPoints: 6 } });
        expect(comparison(6)).toMatchObject({ five: { status: 'available', commonPoints: 6, intervals: 5, stockReturn: 5.000000000000004 } });
        expect(comparison(20)).toMatchObject({ twenty: { status: 'unavailable', commonPoints: 20, requiredPoints: 21 } });
        const result = comparison(21);
        expect(result).toMatchObject({ five: { status: 'available', commonPoints: 6 }, twenty: { status: 'available', commonPoints: 21, startDate: '2026-09-01', endDate: '2026-09-21' } });
        if (result.status === 'available' && result.twenty.status === 'available') {
            expect(result.twenty.stockReturn).toBeCloseTo(20);
            expect(result.twenty.excessPercentagePoints).toBe(0);
            expect(result.twenty.stockCloses).toHaveLength(21);
        }
        const detail = compareRelativeHistory('000001.SZ', history(), '510300.SS', history('510300.SS'));
        expect(detail.status === 'available' && detail.points.length).toBe(20);
    });
    it('uses exchange-local completed dates, conservatively excluding current bars even after close', () => {
        vi.setSystemTime(new Date('2026-09-20T16:01:00Z'));
        const result = comparison(21);
        expect(result).toMatchObject({ twenty: { status: 'unavailable', commonPoints: 20 }, excludedCurrentDates: ['2026-09-21'] });
        vi.setSystemTime(new Date('2026-09-21T10:00:00Z'));
        expect(comparison(21)).toMatchObject({ twenty: { status: 'unavailable', commonPoints: 20 } });
    });
    it('intersects actual dates without fill and discloses missing internal and trailing dates', () => {
        const stock = history(); stock.points.splice(4, 1);
        const benchmark = history('510300.SS'); benchmark.points.splice(20, 1);
        const result = compareDailyResearch(stock.symbol, stock, benchmark.symbol, benchmark);
        expect(result).toMatchObject({ twenty: { status: 'unavailable', commonPoints: 19 }, missingStockDates: ['2026-09-05'], missingBenchmarkDates: ['2026-09-21'] });
    });
    it('can force common dates shared across all included group members', () => {
        const dates = history().points.slice(0, 6).map(point => point.date);
        expect(compareDailyResearch('000001.SZ', history(), '510300.SS', history('510300.SS'), new Date(), dates)).toMatchObject({ five: { status: 'available', endDate: dates[5] }, twenty: { status: 'unavailable', commonPoints: 6 } });
    });
    it.each([
        { source: 'unknown' }, { adjustment: 'unknown' as const }, { currency: 'USD' }, { symbol: '000002.SZ' },
        { provenance: { requestedAdjustment: 'forward' as const, actualKey: 'day', sourceInterval: 'day' as const } },
        { adjustment: 'unadjusted' as const, provenance: { requestedAdjustment: 'forward' as const, actualKey: 'day', sourceInterval: 'day' as const } },
    ])('exits comparisons on actual basis mismatch %j', override => {
        expect(compareDailyResearch('000001.SZ', history(undefined, undefined, override), '510300.SS', history('510300.SS'))).toMatchObject({ status: 'unavailable' });
    });
    it.each(['AAPL', '2330.TW', '6488.TWO'])('exits unverified source for%s even when manually supplied forward metadata', symbol => {
        expect(compareDailyResearch(symbol, history(symbol), symbol, history(symbol))).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('未验证') });
    });
    it('rejects duplicate dates, invalid dates and nonpositive closes', () => {
        for (const patch of [{ date: '2026-02-30' }, { date: '2026-09-01' }, { close: 0 }]) {
            const stock = history(); Object.assign(stock.points[1], patch);
            expect(compareDailyResearch(stock.symbol, stock, '510300.SS', history('510300.SS'))).toMatchObject({ status: 'unavailable' });
        }
    });
});

describe('completed volume median', () => {
    it('compares full latest-day shares with exactly20 preceding complete rows and exposes reproducible samples', () => {
        const result = compareDailyVolume('000001.SZ', history());
        expect(result).toMatchObject({ status: 'available', date: '2026-09-21', volume: 3000, median: 1950, sampleSize: 20, requiredSample: 20, volumeUnit: 'shares', missingDates: [] });
        expect(result.ratio).toBeCloseTo(3000 / 1950);
        expect(result.sampleDates.at(-1)).toBe('2026-09-20');
        expect(result.sampleVolumes).toEqual(history().points.slice(0, 20).map(point => point.volume));
    });
    it('preserves an actual zero volume as a valid zero ratio, while missing volume stays unknown', () => {
        const stock = history(); stock.points[20].volume = 0;
        expect(compareDailyVolume(stock.symbol, stock)).toMatchObject({ status: 'available', volume: 0, ratio: 0 });
        stock.points[20].volume = undefined;
        const result = compareDailyVolume(stock.symbol, stock);
        expect(result).toMatchObject({ status: 'unavailable', missingDates: ['2026-09-21'] });
        expect(result.volume).toBeUndefined(); expect(result.ratio).toBeUndefined();
    });
    it('does not replace a missing baseline volume with zero or an older row', () => {
        const stock = history(undefined, 30); stock.points[20].volume = undefined;
        expect(compareDailyVolume(stock.symbol, stock)).toMatchObject({ status: 'unavailable', sampleSize: 19, missingDates: ['2026-09-21'] });
        expect(compareDailyVolume('000001.SZ', history(undefined, 20))).toMatchObject({ status: 'unavailable', sampleSize: 19 });
    });
    it('excludes incomplete day volume from both latest value and baseline', () => {
        vi.setSystemTime(new Date('2026-09-21T01:00:00Z'));
        const stock = history(); stock.points[20].volume = 1_000_000;
        const result = compareDailyVolume(stock.symbol, stock);
        expect(result).toMatchObject({ status: 'unavailable', date: '2026-09-20', volume: 2900, sampleSize: 19 });
        expect(result.sampleDates).not.toContain('2026-09-21');
    });
    it('does not divide by a legitimate zero median, and rejects wrong units', () => {
        const stock = history(); stock.points.slice(0, 20).forEach(point => { point.volume = 0; });
        expect(compareDailyVolume(stock.symbol, stock)).toMatchObject({ status: 'unavailable', median: 0, sampleSize: 20 });
        expect(compareDailyVolume(stock.symbol, { ...stock, volumeUnit: 'lots' } as unknown as ChartSeries)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('单位') });
    });
});

describe('canonical fixed groups', () => {
    it('canonicalizes HK aliases and retains TWSE vs TPEx identities', () => {
        expect(validatePeerGroupInput({ name: '  我的同业  ', symbolIds: ['700.HK', 'HKEX:700', 'HKEX:00700.HK'] })).toEqual({ name: '我的同业', members: [{ symbolId: 'HKEX:00700.HK', symbol: '00700.HK' }] });
        expect(canonicalPeerMember('TWSE:2330').symbolId).toBe('TWSE:2330.TW');
        expect(canonicalPeerMember('TPEX:6488').symbolId).toBe('TPEX:6488.TWO');
        expect(canonicalPeerMember('US:AAPL').symbol).toBe('AAPL');
        expect(() => canonicalPeerMember('SSE:000001.SZ')).toThrow('身份');
    });
    it('bounds untrusted names and member counts before persistence', () => {
        for (const input of [{ name: '', symbolIds: ['AAPL'] }, { name: 'x', symbolIds: [] }, { name: 'x', symbolIds: Array(21).fill('AAPL') }, { name: 'x', symbolIds: ['$bad'] }]) expect(() => validatePeerGroupInput(input)).toThrow();
    });
});

describe('bounded on-demand cache', () => {
    it('coalesces duplicate requests, limits all concurrency, and expires cached data', async () => {
        let active = 0; let peak = 0;
        const releases: (() => void)[] = [];
        const fetcher = vi.fn(async (symbol: string) => { active++; peak = Math.max(peak, active); await new Promise<void>(resolve => releases.push(resolve)); active--; return history(symbol); });
        const load = createDailyHistoryLoader(fetcher, 2, 1000, 10);
        const a = load('a'); const duplicate = load('a'); const b = load('b'); const c = load('c');
        expect(a).toBe(duplicate); expect(fetcher).toHaveBeenCalledTimes(2);
        releases.shift()!(); await a; await Promise.resolve();
        expect(fetcher).toHaveBeenCalledTimes(3); expect(peak).toBe(2);
        releases.splice(0).forEach(release => release()); await Promise.all([b, c]);
        await load('a'); expect(fetcher).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1001);
        const refresh = load('a'); expect(fetcher).toHaveBeenCalledTimes(4); releases.shift()!(); await refresh;
    });
    it('caps queued work and cache size and caches failures briefly without making missing data zero', async () => {
        let release!: () => void;
        const fetcher = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return null; });
        const load = createDailyHistoryLoader(fetcher, 1, 60_000, 1);
        const first = load('first'); await expect(load('overflow')).resolves.toBeNull(); release(); await first;
        await expect(load('first')).resolves.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(30_001);
        const retry = load('first'); release(); await retry; expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
