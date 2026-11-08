import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeries } from '@/lib/realtime-market';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), find: vi.fn(), group: vi.fn(), history: vi.fn(), lifecycle: vi.fn(), locked: false }));
vi.mock('@/lib/watchlist-lifecycle', () => ({ withWatchlistLifecycle: mocks.lifecycle }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { find: mocks.find } }));
vi.mock('@/lib/actions/peer-groups.actions', () => ({ getPeerGroup: mocks.group }));
vi.mock('@/lib/actions/realtime-market.actions', () => ({ getUnifiedChartSeries: mocks.history }));
function history(symbol: string): ChartSeries {
    return { symbol, market: 'cn', currency: 'CNY', period: '3m', interval: 'day', source: 'tencent-kline', adjustment: 'forward', provenance: { requestedAdjustment: 'forward', actualKey: 'qfqday', sourceInterval: 'day' }, volumeUnit: 'shares', fetchedAt: '2026-11-07T01:00:00Z', points: Array.from({ length: 25 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, time: '', close: 100 + i, volume: 1000 })), latestPrice: 124, periodHigh: 124, periodLow: 100, change: 24, changePercent: 24 };
}
function watched(symbols: string[]) {
    mocks.find.mockReturnValue({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => symbols.map(symbol => ({ symbol })) }) }) }) });
}
beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T01:00:00Z'));
    mocks.locked = false;
    mocks.lifecycle.mockImplementation(async (_userId: string, _intent: unknown, callback: () => Promise<unknown>) => {
        mocks.locked = true;
        try { return await callback(); } finally { mocks.locked = false; }
    });
    mocks.auth.mockResolvedValue('owner-a'); mocks.connect.mockResolvedValue(undefined); watched(['000001.SZ', '000002.SZ']);
    mocks.history.mockImplementation(async (symbol: string) => history(symbol));
    mocks.group.mockResolvedValue({ id: 'abcdef012345678901234567', name: '同业', membershipSavedAt: '2026-11-08T00:00:00Z', members: [{ symbol: '000001.SZ', symbolId: 'SZSE:000001.SZ' }, { symbol: '000002.SZ', symbolId: 'SZSE:000002.SZ' }] });
});
afterEach(() => vi.useRealTimers());

describe('on-demand daily comparison actions', () => {
    it('requires authentication before any query or upstream request', async () => {
        mocks.auth.mockRejectedValueOnce(new Error('Unauthorized'));
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        await expect(getDailyResearch({ scope: 'watched', benchmarkSymbol: '510300.SS' })).rejects.toThrow('Unauthorized');
        expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
    });
    it('reads membership under the owner read-only lifecycle lock and releases it before history HTTP', async () => {
        mocks.find.mockImplementationOnce(() => {
            expect(mocks.locked).toBe(true);
            return { select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ symbol: '000001.SZ' }] }) }) }) };
        });
        mocks.history.mockImplementation(async (symbol: string) => {
            expect(mocks.locked).toBe(false);
            return history(symbol);
        });
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        await getDailyResearch({ scope: 'watched', benchmarkSymbol: '399006.SZ' });
        expect(mocks.lifecycle).toHaveBeenCalledWith('owner-a', { operation: 'daily-research-membership', readOnly: true }, expect.any(Function));
        expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
    });
    it('does not fetch or read partial membership when the lifecycle lock is unavailable', async () => {
        mocks.lifecycle.mockRejectedValueOnce(new Error('LIFECYCLE_BUSY'));
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        await expect(getDailyResearch({ scope: 'watched', benchmarkSymbol: '399006.SZ' })).rejects.toThrow('LIFECYCLE_BUSY');
        expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
    });
    it('uses only active current-owner watchlist records and fetches the benchmark once with a bounded row cap', async () => {
        watched([...Array.from({ length: 25 }, (_, i) => `${String(i + 1).padStart(6, '0')}.SZ`), 'AAPL', '2330.TW']);
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        const result = await getDailyResearch({ scope: 'watched', benchmarkSymbol: '510300.SS' });
        expect(mocks.find).toHaveBeenCalledWith({ userId: 'owner-a', archivedAt: null });
        expect(result.rows).toHaveLength(20); expect(result.omittedMembers).toHaveLength(7);
        expect(mocks.history).toHaveBeenCalledTimes(21);
        expect(mocks.history.mock.calls.filter(([symbol]) => symbol === '510300.SS')).toHaveLength(1);
        expect(mocks.history.mock.calls.every(([, period]) => period === '3m')).toBe(true);
        expect(mocks.history.mock.calls.some(([symbol]) => symbol === 'AAPL' || symbol === '2330.TW')).toBe(false);
        await getDailyResearch({ scope: 'watched', benchmarkSymbol: '510300.SS' });
        expect(mocks.history).toHaveBeenCalledTimes(21);
    });
    it('shares actual dates across included fixed members and retains membership save date without backfilling', async () => {
        mocks.history.mockImplementation(async (symbol: string) => {
            const series = history(symbol); if (symbol === '000002.SZ') series.points.splice(20, 1); return series;
        });
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        const result = await getDailyResearch({ scope: 'group', groupId: 'abcdef012345678901234567', benchmarkSymbol: '510300.SS' });
        expect(mocks.group).toHaveBeenCalledWith('abcdef012345678901234567');
        expect(mocks.find).not.toHaveBeenCalled();
        expect(result.group?.membershipSavedAt).toBe('2026-11-08T00:00:00Z');
        const intervals = result.rows.map(row => row.comparison.status === 'available' && row.comparison.twenty);
        expect(intervals[0]).toMatchObject({ status: 'available', commonPoints: 21 });
        expect(intervals[0] && intervals[0].status === 'available' && intervals[0].dates).toEqual(intervals[1] && intervals[1].status === 'available' && intervals[1].dates);
        expect(result.commonDates).not.toContain('2026-09-21');
    });
    it('does not fetch a foreign or missing group, nor arbitrary benchmarks', async () => {
        mocks.group.mockRejectedValueOnce(new Error('未找到当前账户的同业组'));
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        await expect(getDailyResearch({ scope: 'group', groupId: 'abcdef012345678901234567', benchmarkSymbol: '510300.SS' })).rejects.toThrow('当前账户');
        await expect(getDailyResearch({ scope: 'watched', benchmarkSymbol: 'AAPL' })).rejects.toThrow('明确基准');
        expect(mocks.history).not.toHaveBeenCalled();
    });
    it('issues a trusted draft for exactly the displayed result, retaining sources even for failed/excluded rows', async () => {
        mocks.history.mockImplementation(async (symbol: string) => symbol === '000002.SZ' ? null : history(symbol));
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        const { comparisonDrafts } = await import('@/lib/research-comparisons');
        const result = await getDailyResearch({ scope: 'group', groupId: 'abcdef012345678901234567', benchmarkSymbol: '510300.SS' });
        const { draft, ...displayed } = result;
        const trusted = comparisonDrafts.read('owner-a', draft.id);
        expect(trusted.result).toEqual(displayed);
        expect(trusted.originalSeries).toEqual(expect.arrayContaining([{ symbol: '000002.SZ', series: null }, { symbol: '510300.SS', series: history('510300.SS') }]));
        const requests = mocks.history.mock.calls.length;
        result.rows[0].volume.volume = 123456;
        expect(comparisonDrafts.read('owner-a', draft.id).result.rows[0].volume.volume).toBe(1000);
        expect(() => comparisonDrafts.read('other-owner', draft.id)).toThrow('当前账户');
        expect(mocks.history).toHaveBeenCalledTimes(requests);
    });
    it('discloses an excluded basis mismatch while retaining other comparable members', async () => {
        mocks.history.mockImplementation(async (symbol: string) => ({ ...history(symbol), ...(symbol === '000002.SZ' ? { source: 'unknown' } : {}) }));
        const { getDailyResearch } = await import('@/lib/actions/relative-history.actions');
        const result = await getDailyResearch({ scope: 'group', groupId: 'abcdef012345678901234567', benchmarkSymbol: '510300.SS' });
        expect(result.rows[0].comparison).toMatchObject({ status: 'available', twenty: { status: 'available' } });
        expect(result.rows[1].comparison).toMatchObject({ status: 'unavailable' });
    });
});
