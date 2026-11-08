import { describe, expect, it } from 'vitest';
import { compareDailyQuotes, getBenchmarkOptions, type ComparisonQuote } from '@/lib/market/comparison';

const quote: ComparisonQuote = {
    c: 102, pc: 100, dp: 2, currency: 'CNY', source: 'tencent',
    asOf: '2026-11-06T06:00:00.000Z', priceBasis: 'last-trade',
};
const benchmark: ComparisonQuote = { ...quote, c: 100.5, dp: 0.5 };
const compare = (q: ComparisonQuote | null = quote, b: ComparisonQuote | null = benchmark) => compareDailyQuotes('600519.SS', q, '000001.SS', b);

describe('daily source-reference comparison', () => {
    it('reports percentage points, including a real zero difference', () => {
        expect(compare()).toMatchObject({ value: 1.5, basis: 'source-prev-close', unit: 'percentage-points' });
        expect(compare({ ...quote, dp: 0 }, { ...benchmark, dp: 0 }).value).toBe(0);
        expect(compare({ ...quote, dp: -2 }).value).toBe(-2.5);
    });
    it('requires an explicit supported local benchmark', () => {
        expect(compareDailyQuotes('600519.SS', quote, 'SPY', benchmark).value).toBeUndefined();
        expect(getBenchmarkOptions('832982.BJ')).toEqual([]);
        expect(getBenchmarkOptions('6488.TWO')).toEqual([]);
    });
    it('retains proxy labels and canonical Hong Kong aliases', () => {
        expect(getBenchmarkOptions('2330.TW')[0]).toMatchObject({ symbol: '0050.TW', proxy: true });
        const hk = { ...quote, currency: 'HKD' };
        expect(compareDailyQuotes('09988.HK', hk, '2800.HK', { ...hk, dp: 1 }).value).toBe(1);
        expect(getBenchmarkOptions('AAPL').every((option) => option.proxy)).toBe(true);
        expect(getBenchmarkOptions('600519.SS')[1].symbol).toBe('399' + '001.SZ');
    });
    it('does not compare missing or failed quotes', () => {
        expect(compare(null).value).toBeUndefined();
        expect(compare(quote, null).value).toBeUndefined();
        expect(compare({ ...quote, stale: true }).reason).toContain('更新失败');
        expect(compare(quote, { ...benchmark, stale: true }).value).toBeUndefined();
    });
    it.each([
        { c: 0 }, { c: undefined }, { c: NaN }, { pc: 0 }, { pc: undefined },
        { dp: undefined }, { dp: Infinity }, { priceBasis: 'previous-close' as const },
    ])('keeps invalid values absent: %j', (change) => {
        expect(compare({ ...quote, ...change }).value).toBeUndefined();
    });
    it('requires matching known provider and currency', () => {
        expect(compare({ ...quote, source: undefined }).value).toBeUndefined();
        expect(compare({ ...quote, source: 'finnhub' }).reason).toContain('来源不同');
        expect(compare({ ...quote, currency: undefined }).value).toBeUndefined();
        expect(compare({ ...quote, currency: 'HKD' }).value).toBeUndefined();
    });
    it('uses source times, allowing at most two minutes of observation skew', () => {
        expect(compare(quote, { ...benchmark, asOf: '2026-11-06T05:58:00.000Z' }).value).toBe(1.5);
        expect(compare(quote, { ...benchmark, asOf: '2026-11-06T05:57:59.000Z' }).reason).toContain('相差超过');
        expect(compare({ ...quote, asOf: undefined, t: undefined }).reason).toBe('源时间未提供');
        expect(compare({ ...quote, asOf: 'invalid' }).value).toBeUndefined();
    });
    it('compares exchange dates, including cross-midnight UTC boundaries', () => {
        expect(compare({ ...quote, asOf: '2026-11-05T15:59:30.000Z' }, { ...benchmark, asOf: '2026-11-05T16:00:00.000Z' }).reason).toContain('同一交易日');
    });
    it('supports a real provider epoch time without substituting fetch time', () => {
        expect(compare({ ...quote, asOf: undefined, t: Date.parse(quote.asOf!) / 1000 }).value).toBe(1.5);
    });
});
