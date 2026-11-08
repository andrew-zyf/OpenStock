import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeries } from '@/lib/realtime-market';
import { getRelativeHistoryComparison } from '@/lib/actions/relative-history.actions';

const { fetchHistory } = vi.hoisted(() => ({ fetchHistory: vi.fn() }));
vi.mock('@/lib/actions/realtime-market.actions', () => ({ getUnifiedChartSeries: fetchHistory }));

const history = (symbol: string): ChartSeries => ({
    symbol, market: 'cn', currency: 'CNY', source: 'tencent-kline', period: '1m', interval: 'day',
    adjustment: 'forward', provenance: { requestedAdjustment: 'forward', actualKey: 'qfqday', sourceInterval: 'day' },
    points: [{ date: '2026-01-05', time: '', close: 100 }, { date: '2026-01-06', time: '', close: 110 }],
    latestPrice: 110, change: 10, changePercent: 10, periodHigh: 110, periodLow: 100,
    volumeUnit: 'shares', fetchedAt: '2026-11-07T00:00:00Z',
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T00:00:00Z')); fetchHistory.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('bounded targeted historical comparison action', () => {
    it('starts exactly two daily-history requests in parallel and canonicalizes aliases', async () => {
        let resolveStock!: (series: ChartSeries) => void;
        let resolveBenchmark!: (series: ChartSeries) => void;
        fetchHistory.mockImplementationOnce(() => new Promise(resolve => { resolveStock = resolve; }))
            .mockImplementationOnce(() => new Promise(resolve => { resolveBenchmark = resolve; }));
        const result = getRelativeHistoryComparison('SSE:600519', 'SSE:000001', 'CNY');
        expect(fetchHistory.mock.calls).toEqual([['600519.SS', '1m'], ['000001.SS', '1m']]);
        resolveStock(history('600519.SS'));
        resolveBenchmark(history('000001.SS'));
        await expect(result).resolves.toMatchObject({ status: 'available', differencePercentagePoints: 0 });
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each([['AAPL', 'SPY'], ['2330.TW', '0050.TW'], ['600519.SS', 'SPY'], ['832982.BJ', '000001.SS']])(
        'does not request history for unsupported %s / %s', async (symbol, benchmark) => {
            await expect(getRelativeHistoryComparison(symbol, benchmark)).resolves.toMatchObject({ status: 'unavailable' });
            expect(fetchHistory).not.toHaveBeenCalled();
        },
    );
    it('requests and compares the history-only CN ETF proxy through the same verified daily adapter', async () => {
        fetchHistory.mockImplementation(async (symbol: string) => history(symbol));
        await expect(getRelativeHistoryComparison('600519.SS', '510300.SS', 'CNY')).resolves.toMatchObject({
            status: 'available', adjustment: 'forward', benchmark: { symbol: '510300.SS', proxy: true },
        });
        expect(fetchHistory.mock.calls).toEqual([['600519.SS', '1m'], ['510300.SS', '1m']]);
    });
    it('does not request a mismatched page currency', async () => {
        await expect(getRelativeHistoryComparison('600519.SS', '000001.SS', 'USD')).resolves.toMatchObject({ status: 'unavailable' });
        expect(fetchHistory).not.toHaveBeenCalled();
    });
    it('rejects missing provider data so a resource refresh can retain the prior snapshot', async () => {
        fetchHistory.mockResolvedValue(null);
        await expect(getRelativeHistoryComparison('600519.SS', '000001.SS')).rejects.toThrow('暂不可用');
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('bounds even an adapter promise that never settles, without retries or extra requests', async () => {
        fetchHistory.mockImplementation(() => new Promise(() => {}));
        const result = getRelativeHistoryComparison('600519.SS', '000001.SS');
        const rejection = expect(result).rejects.toThrow('超时');
        await vi.advanceTimersByTimeAsync(7_000);
        await rejection;
        expect(fetchHistory).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('propagates adapter rejection and clears its timeout', async () => {
        fetchHistory.mockRejectedValue(new Error('adapter error'));
        await expect(getRelativeHistoryComparison('600519.SS', '000001.SS')).rejects.toThrow('adapter error');
        expect(vi.getTimerCount()).toBe(0);
    });
});
