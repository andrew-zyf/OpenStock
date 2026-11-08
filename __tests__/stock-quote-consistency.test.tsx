import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StockLivePrice, { StockQuoteProvider } from '@/components/stocks/StockLivePrice';
import StockQuoteStats from '@/components/stocks/StockQuoteStats';
import { fetchQuoteBatches, type LiveQuote, type LiveQuoteMap } from '@/hooks/useLiveQuotes';
import { formatPrice } from '@/lib/utils';

const { quoteResource, freshness } = vi.hoisted(() => ({ quoteResource: vi.fn(), freshness: vi.fn() }));
vi.mock('@/hooks/useLiveQuotes', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/hooks/useLiveQuotes')>(), useLiveQuoteResource: quoteResource,
}));
vi.mock('@/components/PriceFlash', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/DataFreshness', () => ({ default: (props: unknown) => { freshness(props); return null; } }));

const symbol = '600519.SS';
const initial: LiveQuote = {
    c: 100, d: 10, dp: 11.11, o: 91, h: 105, l: 89, pc: 90,
    volume: 12300, turnover: 90000, turnoverRate: 1.23, amplitude: 17.78,
    currency: 'CNY', source: 'tencent', t: 1794207600,
    asOf: '2026-11-09T07:00:00Z', fetchedAt: '2026-11-09T07:00:01Z',
};
const updated: LiveQuote = {
    c: 110, d: 10, dp: 10, o: 101, h: 115, l: 99, pc: 100,
    volume: 45600, turnover: 120000, turnoverRate: 2.34, amplitude: 16,
    currency: 'CNY', source: 'tencent', t: 1794207615,
    asOf: '2026-11-09T07:00:15Z', fetchedAt: '2026-11-09T07:00:16Z',
};

function renderSnapshot(data: LiveQuoteMap, options: { symbol?: string; stale?: boolean; loading?: boolean; layout?: 'native' | 'us' } = {}) {
    const currentSymbol = options.symbol ?? symbol;
    quoteResource.mockReturnValue({ data, stale: options.stale ?? false, loading: options.loading ?? false });
    const calls = quoteResource.mock.calls.length;
    const html = renderToStaticMarkup(<StockQuoteProvider symbol={currentSymbol} initial={initial} currency="CNY">
        <StockLivePrice />
        <StockQuoteStats symbol={currentSymbol} layout={options.layout ?? 'native'} />
    </StockQuoteProvider>);
    expect(quoteResource).toHaveBeenCalledTimes(calls + 1);
    return html;
}
function stat(html: string, label: string) {
    const match = html.match(new RegExp(`${label}</(?:span|div)><(?:span|p)[^>]*>([^<]*)</(?:span|p)>`));
    expect(match, `missing statistic ${label}`).not.toBeNull();
    return match![1];
}
function response(quote: LiveQuote | null) {
    return { ok: true, json: async () => ({ [symbol]: quote }) };
}

beforeEach(() => { quoteResource.mockReset(); freshness.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('stock header quote observation consistency', () => {
    it('replaces price, change, OHLC and volume statistics together with a single resource read', async () => {
        const first = renderSnapshot({ [symbol]: initial });
        expect(first).toContain(formatPrice(100, 'CNY'));
        expect(stat(first, '今开')).toBe(formatPrice(91, 'CNY'));
        expect(stat(first, '成交量')).toBe('123手（100股）');

        vi.stubGlobal('fetch', vi.fn(async () => response(updated)));
        const next = await fetchQuoteBatches([symbol], { [symbol]: initial });
        const second = renderSnapshot(next);
        expect(second).toContain(formatPrice(110, 'CNY'));
        expect(second).toContain('10.00');
        expect(stat(second, '今开')).toBe(formatPrice(101, 'CNY'));
        expect(stat(second, '昨收')).toBe(formatPrice(100, 'CNY'));
        expect(stat(second, '最高')).toBe(formatPrice(115, 'CNY'));
        expect(stat(second, '最低')).toBe(formatPrice(99, 'CNY'));
        expect(stat(second, '成交量')).toBe('456手（100股）');
        expect(stat(second, '成交额')).toBe('12.00万 CNY');
        expect(stat(second, '换手率')).toBe('2.34%');
        expect(stat(second, '振幅')).toBe('16.00%');
        expect(freshness).toHaveBeenLastCalledWith(expect.objectContaining({
            source: updated.source, asOf: updated.asOf, fetchedAt: updated.fetchedAt, stale: false,
        }));
    });

    it('clears missing fields on a new source observation rather than blending initial statistics', async () => {
        const sparse = { c: 111, currency: 'CNY', source: 'fallback', asOf: '2026-11-09T07:00:30Z' };
        vi.stubGlobal('fetch', vi.fn(async () => response(sparse)));
        const data = await fetchQuoteBatches([symbol], { [symbol]: initial });
        const html = renderSnapshot(data);
        expect(html).toContain(formatPrice(111, 'CNY'));
        for (const label of ['今开', '昨收', '最高', '最低', '成交量', '成交额', '换手率', '振幅']) expect(stat(html, label)).toBe('—');
        expect(freshness).toHaveBeenLastCalledWith(expect.objectContaining({
            source: 'fallback', asOf: sparse.asOf, fetchedAt: undefined, stale: false,
        }));
    });

    it('retains the complete previous observation and its timestamps after refresh failure, then recovers', async () => {
        let data: LiveQuoteMap = { [symbol]: initial };
        vi.stubGlobal('fetch', vi.fn(async () => response(null)));
        await expect(fetchQuoteBatches([symbol], data)).rejects.toThrow('行情暂不可用');
        const failed = renderSnapshot(data, { stale: true });
        expect(failed).toContain(formatPrice(100, 'CNY'));
        expect(stat(failed, '成交量')).toBe('123手（100股）');
        expect(stat(failed, '换手率')).toBe('1.23%');
        expect(freshness).toHaveBeenLastCalledWith(expect.objectContaining({
            source: initial.source, asOf: initial.asOf, fetchedAt: initial.fetchedAt, stale: true,
        }));
        vi.stubGlobal('fetch', vi.fn(async () => response(updated)));
        data = await fetchQuoteBatches([symbol], data);
        const recovered = renderSnapshot(data);
        expect(recovered).toContain(formatPrice(110, 'CNY'));
        expect(stat(recovered, '成交量')).toBe('456手（100股）');
        expect(freshness).toHaveBeenLastCalledWith(expect.objectContaining({ asOf: updated.asOf, stale: false }));
    });

    it.each([
        ['600519.SS', '123手（100股）', 'native'],
        ['2330.TW', '12.3张（1000股）', 'native'],
        ['00700.HK', '1.23万股', 'native'],
        ['AAPL', '1.23万股', 'us'],
    ] as const)('keeps normalized share units for %s', (currentSymbol, volume, layout) => {
        const html = renderSnapshot({ [currentSymbol]: initial }, { symbol: currentSymbol, layout });
        expect(stat(html, '成交量')).toBe(volume);
    });

    it('keeps real zero statistics and derives amplitude only from the current observation', () => {
        const zero: LiveQuote = { c: 10, d: 0, dp: 0, o: 0, pc: 10, h: 10, l: 10, volume: 0, turnover: 0, turnoverRate: 0 };
        const html = renderSnapshot({ [symbol]: zero });
        expect(stat(html, '今开')).toBe(formatPrice(0, 'CNY'));
        expect(stat(html, '成交量')).toBe('0手（100股）');
        expect(stat(html, '成交额')).toBe('0 CNY');
        expect(stat(html, '换手率')).toBe('0.00%');
        expect(stat(html, '振幅')).toBe('0.00%');
        expect(html).toContain('0.00%');
        const missingBaseline = renderSnapshot({ [symbol]: { c: 11, h: 12, l: 10 } });
        expect(stat(missingBaseline, '振幅')).toBe('—');
    });

    it('uses the current quote currency and preserves the explicit previous-close basis', () => {
        const html = renderSnapshot({ [symbol]: { c: 100, o: 99, currency: 'HKD', priceBasis: 'previous-close' } });
        expect(html).toContain(formatPrice(100, 'HKD'));
        expect(stat(html, '今开')).toBe(formatPrice(99, 'HKD'));
        expect(html).toContain('昨收参考价（暂无最新成交）');
    });
});
