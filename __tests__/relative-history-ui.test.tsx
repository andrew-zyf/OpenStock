import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RelativeHistoryComparison from '@/components/stocks/RelativeHistoryComparison';
import { compareRelativeHistory } from '@/lib/market/relative-history';
import type { ChartSeries } from '@/lib/realtime-market';

const { resourceMock, actionMock } = vi.hoisted(() => ({ resourceMock: vi.fn(), actionMock: vi.fn() }));
vi.mock('@/hooks/useMarketResource', () => ({ useMarketResource: resourceMock }));
vi.mock('@/lib/actions/relative-history.actions', () => ({ getRelativeHistoryComparison: actionMock }));

function result(adjustment: 'forward' | 'unadjusted' = 'forward', partial = false) {
    const series = (symbol: string): ChartSeries => ({
        symbol, market: 'hk', currency: 'HKD', source: 'tencent-kline', period: '1m', interval: 'day',
        adjustment, provenance: { requestedAdjustment: 'forward', requestedKey: 'qfqday', actualKey: adjustment === 'forward' ? 'qfqday' : 'day', sourceInterval: 'day' },
        points: Array.from({ length: 20 }, (_, i) => {
            const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
            return { date, time: date, close: 100 + i };
        }),
        latestPrice: 119, change: 19, changePercent: 19, periodHigh: 119, periodLow: 100,
        volumeUnit: 'shares', fetchedAt: '2026-11-07T00:00:00Z',
    });
    const benchmark = series('02800.HK');
    if (partial) benchmark.points.splice(10, 1);
    return compareRelativeHistory('00700.HK', series('00700.HK'), '02800.HK', benchmark);
}
const render = (symbol = '700.HK', currency?: string) => renderToStaticMarkup(createElement(RelativeHistoryComparison, { symbol, currency }));

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T00:00:00Z'));
    actionMock.mockReset(); resourceMock.mockReset();
    resourceMock.mockReturnValue({ data: result(), loading: false, error: null, stale: false });
});
afterEach(() => vi.useRealTimers());

describe('historical comparison table and disclosure', () => {
    it('shows the exact interval, endpoint changes and percentage-point difference with all20 dates', () => {
        const html = render();
        expect(html).toContain('2026-01-01 至 2026-01-20');
        expect(html).toContain('共 20 个共同收盘点');
        expect(html).toContain('+19.00%');
        expect(html).toContain('0.00 个百分点');
        expect(html.match(/scope="row"/g)).toHaveLength(20);
        expect(html).toContain('<caption');
        expect(html.match(/scope="col"/g)).toHaveLength(5);
        expect(html).toContain('归一为100');
        expect(html).toContain('盈富基金（恒指 ETF 代理）');
        expect(html).toContain('股息再投资、费用或汇率变动');
        expect(html).toContain('当天日K不参与');
        expect(html).not.toContain('<svg');
    });
    it('uses grouped labeled native radio controls and a keyboard-focusable table region', () => {
        const html = render();
        expect(html).toContain('<fieldset');
        expect(html).toContain('<legend');
        expect(html.match(/type="radio"/g)).toHaveLength(2);
        expect(html.match(/<label for=/g)).toHaveLength(2);
        expect(html).toContain('role="region" aria-label="共同日期价格明细" tabindex="0"');
        expect(html).toContain('overflow-x-auto');
    });
    it('defaults CN history to the explicit ETF proxy and preserves index options', () => {
        resourceMock.mockReturnValue({ data: undefined, loading: true, error: null, stale: false });
        const html = render('600519.SS', 'CNY');
        expect(html).toContain('沪深300 ETF 代理（510300）');
        expect(html).toContain('value="510300.SS"');
        expect(html).toContain('上证指数');
        expect(html.match(/type="radio"/g)).toHaveLength(4);
        expect(resourceMock.mock.calls.at(-1)![0].key).toContain(':510300.SS:');
    });
    it('makes same-basis unadjusted fallback and corporate-action effects explicit', () => {
        resourceMock.mockReturnValue({ data: result('unadjusted'), loading: false, error: null, stale: false });
        const html = render();
        expect(html).toContain('双方同为不复权');
        expect(html).toContain('除权除息影响');
        expect(html).toContain('标的 day / 基准 day');
    });
    it('discloses missing dates and short coverage rather than describing a full20-point interval', () => {
        resourceMock.mockReturnValue({ data: result('forward', true), loading: false, error: null, stale: false });
        const html = render();
        expect(html).toContain('共 19 个共同收盘点');
        expect(html).toContain('历史不足20');
        expect(html).toContain('缺失日不补值');
        expect(html).toContain('基准缺失日期：2026-01-11');
        expect(html.match(/scope="row"/g)).toHaveLength(19);
    });
    it('retains the successful comparison with an explicit stale warning when a refresh fails', () => {
        resourceMock.mockReturnValue({ data: result(), loading: false, error: new Error('refresh error'), stale: true });
        const html = render();
        expect(html).toContain('刷新失败');
        expect(html).toContain('上次成功获取');
        expect(html).toContain('<table');
    });
    it('shows unavailable/loading/error states without fabricated numbers', () => {
        for (const state of [
            { data: undefined, loading: true, error: null },
            { data: undefined, loading: false, error: new Error('upstream') },
            { data: { status: 'unavailable', reason: '口径不一致' }, loading: false, error: null },
        ]) {
            resourceMock.mockReturnValue({ ...state, stale: false });
            const html = render();
            expect(html).toContain('role="status"');
            expect(html).not.toContain('<table');
            expect(html).not.toContain('个百分点');
        }
    });
    it.each(['AAPL', '2330.TW'])('disables unverified historical requests for %s and shows why', symbol => {
        const html = render(symbol);
        expect(resourceMock.mock.calls.at(-1)![0].enabled).toBe(false);
        expect(html).toContain('复权口径未验证');
        expect(html).not.toContain('<table');
    });
    it('includes stock, benchmark and requested currency in resource identity with hourly refresh', async () => {
        render('HKEX:700', 'HKD');
        const first = resourceMock.mock.calls.at(-1)![0];
        expect(first).toMatchObject({ key: 'relative-history:00700.HK:02800.HK:HKD:20', intervalMs: 3_600_000, enabled: true });
        await first.loader();
        expect(actionMock).toHaveBeenCalledWith('00700.HK', '02800.HK', 'HKD');
        render('600519.SS', 'CNY');
        const second = resourceMock.mock.calls.at(-1)![0];
        expect(second.key).toBe('relative-history:600519.SS:510300.SS:CNY:20');
        await second.loader();
        expect(actionMock).toHaveBeenLastCalledWith('600519.SS', '510300.SS', 'CNY');
        render('600519.SS', 'USD');
        const third = resourceMock.mock.calls.at(-1)![0];
        expect(third.key).not.toBe(second.key);
        expect(third.enabled).toBe(false);
    });
});
