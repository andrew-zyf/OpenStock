import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ObservationEditor, { observationInputFromDraft, validateObservationDraft, type ObservationDraft } from '@/components/watchlist/ObservationEditor';
import WatchlistTable, { observationPriceChange } from '@/components/watchlist/WatchlistTable';
import type { WatchlistEntry } from '@/lib/watchlist-observation';
import type { LiveQuoteMap } from '@/hooks/useLiveQuotes';

const { quoteResource, updateObservation, queueClock } = vi.hoisted(() => ({ quoteResource: vi.fn(), updateObservation: vi.fn(), queueClock: { tick: null as Date | null } }));
vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual, useState: ((initial: unknown) => actual.useState(initial === null && queueClock.tick ? queueClock.tick : initial)) as typeof actual.useState };
});
vi.mock('@/hooks/useLiveQuotes', () => ({ useLiveQuoteResource: quoteResource }));
vi.mock('@/lib/actions/watchlist.actions', () => ({ updateWatchlistObservation: updateObservation }));
vi.mock('@/components/watchlist/CreateAlertModal', () => ({ default: () => null }));
vi.mock('@/components/WatchlistButton', () => ({ default: () => null }));
vi.mock('@/components/PriceFlash', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/SearchCommand', () => ({ SearchButton: () => null }));

const entry: WatchlistEntry = { symbol: 'AAPL', company: 'Apple', addedAt: '2026-11-06T07:00:00Z', reviewStatus: 'watching' };
const draft: ObservationDraft = { group: '', note: '', invalidation: '', targetPrice: '', reviewStatus: 'watching', nextReviewDate: '', proximityPercent: '' };
const snapshot = { price: 100, currency: 'USD', source: 'Finnhub', asOf: '2026-11-06T20:00:00Z', fetchedAt: '2026-11-06T20:01:00Z', priceBasis: 'last-trade' as const, adjustment: 'unadjusted' as const };

afterEach(() => { queueClock.tick = null; vi.useRealTimers(); });

beforeEach(() => {
    quoteResource.mockReset();
    quoteResource.mockReturnValue({ data: {}, loading: true, stale: false, error: null });
    updateObservation.mockReset();
});

describe('observation form', () => {
    it('renders visible labels, named controls, native limits and an enabled submit before interaction', () => {
        const html = renderToStaticMarkup(<ObservationEditor entry={entry} currency="USD" onSaved={vi.fn()} onClose={vi.fn()} />);
        expect(html).toContain('method="post"');
        for (const name of ['group', 'note', 'invalidation', 'targetPrice', 'reviewStatus', 'nextReviewDate', 'proximityPercent']) expect(html).toContain(`name="${name}"`);
        expect(html).toContain('maxLength="80"');
        expect(html).toContain('maxLength="2000"');
        expect(html).toContain('min="5e-324"');
        expect(html).toContain('step="any"');
        expect(html).toContain('aria-describedby=');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('type="submit"');
        expect(html).not.toContain('disabled=');
        expect(html).not.toContain('aria-invalid="true"');
        expect(html).not.toContain('须为大于 0 的有限数值');
        expect(updateObservation).not.toHaveBeenCalled();
    });
    it.each(['0', '-1', 'Infinity', '1e309', 'not-a-price'])('rejects invalid key price %s', (targetPrice) => {
        expect(validateObservationDraft({ ...draft, targetPrice }).targetPrice).toBeDefined();
    });
    it('enforces text limits while accepting blank clears and finite positive values', () => {
        expect(validateObservationDraft({ ...draft, group: 'x'.repeat(81), note: 'x'.repeat(2001), invalidation: 'x'.repeat(2001) })).toEqual({
            group: '自定义分组最多 80 字', note: '观察理由最多 2000 字', invalidation: '失效条件最多 2000 字',
        });
        expect(validateObservationDraft(draft)).toEqual({});
        expect(validateObservationDraft({ ...draft, targetPrice: '0.00001' })).toEqual({});
        expect(observationInputFromDraft(draft)).toEqual({ group: null, note: null, invalidation: null, targetPrice: null, reviewStatus: 'watching', nextReviewDate: null, proximityPercent: null });
        expect(observationInputFromDraft({ ...draft, group: '  test  ', note: '理由', targetPrice: '1.25', reviewStatus: 'validated' })).toMatchObject({ group: 'test', note: '理由', targetPrice: 1.25, reviewStatus: 'validated' });
    });
    it('validates deadlines and proximity only when changed and preserves explicit zero and nullable clears', () => {
        expect(validateObservationDraft({ ...draft, nextReviewDate: '2026-02-30', proximityPercent: '101' })).toMatchObject({ nextReviewDate: expect.any(String), proximityPercent: expect.any(String) });
        expect(validateObservationDraft({ ...draft, nextReviewDate: '2026-11-09', proximityPercent: '0' })).toEqual({});
        expect(observationInputFromDraft({ ...draft, proximityPercent: '0', nextReviewDate: '2026-11-09' }, draft)).toEqual({ proximityPercent: 0, nextReviewDate: '2026-11-09' });
        const scheduled = { ...draft, nextReviewDate: '2026-11-09', proximityPercent: '5' };
        expect(observationInputFromDraft(draft, scheduled)).toEqual({ nextReviewDate: null, proximityPercent: null });
        const html = renderToStaticMarkup(<ObservationEditor entry={entry} currency="USD" onSaved={vi.fn()} onClose={vi.fn()} />);
        expect(html).toContain('America/New_York');
        expect(html).toContain('type="date"');
        expect(html).toContain('max="100"');
    });
    it('saves group/status changes without validating or resubmitting an untouched 2002-character legacy note', () => {
        const note = `${'甲'.repeat(1000)}\n\n${'乙'.repeat(1000)}`;
        const baseline = { ...draft, note };
        const changed: ObservationDraft = { ...baseline, group: '重点观察', reviewStatus: 'validated' };
        expect(note).toHaveLength(2002);
        expect(validateObservationDraft(changed, baseline)).toEqual({});
        expect(observationInputFromDraft(changed, baseline)).toEqual({ group: '重点观察', reviewStatus: 'validated' });
        expect(changed.note).toBe(note);
        const html = renderToStaticMarkup(<ObservationEditor entry={{ ...entry, note }} currency="USD" onSaved={vi.fn()} onClose={vi.fn()} />);
        expect(html).toContain(note);
        expect(html).toContain('已有超长记录完整保留');
        expect(html).not.toContain('aria-invalid="true"');
    });
    it('still validates edits to legacy text and allows an explicit clear without touching other fields', () => {
        const baseline = { ...draft, note: 'x'.repeat(2002), invalidation: 'y'.repeat(2002) };
        const changed = { ...baseline, note: `${baseline.note}!` };
        expect(validateObservationDraft(changed, baseline)).toEqual({ note: '观察理由最多 2000 字' });
        expect(validateObservationDraft({ ...baseline, note: '' }, baseline)).toEqual({});
        expect(observationInputFromDraft({ ...baseline, note: '' }, baseline)).toEqual({ note: null });
    });
    it('produces no patch for untouched or reverted fields, including legacy text', () => {
        const baseline = { ...draft, note: 'x'.repeat(2002), group: '原分组' };
        expect(validateObservationDraft({ ...baseline }, baseline)).toEqual({});
        expect(observationInputFromDraft({ ...baseline }, baseline)).toEqual({});
    });
    it('keeps edits made during a successful submission as the next patch', () => {
        const baseline = { ...draft, note: 'x'.repeat(2002) };
        const submitted = { ...baseline, group: '新分组' };
        const editedWhilePending = { ...submitted, invalidation: '新增失效条件' };
        expect(observationInputFromDraft(submitted, baseline)).toEqual({ group: '新分组' });
        expect(observationInputFromDraft(editedWhilePending, submitted)).toEqual({ invalidation: '新增失效条件' });
        expect(editedWhilePending.note).toBe(baseline.note);
    });
});

describe('honest observation and benchmark rendering', () => {
    it('accepts a new quote between clock ticks and expires it on a later render without new quote data', () => {
        vi.useFakeTimers();
        queueClock.tick = new Date('2026-11-06T15:00:00Z');
        vi.setSystemTime(new Date('2026-11-06T15:00:15Z'));
        quoteResource.mockReturnValue({ data: { AAPL: { c: 101, currency: 'USD', source: 'Finnhub', asOf: '2026-11-06T15:00:14Z', priceBasis: 'last-trade' } }, loading: false, stale: false, error: null });
        const rows = [{ ...entry, targetPrice: 100, name: 'Apple', price: 101, currency: 'USD', peRatio: 0 }];
        expect(renderToStaticMarkup(<WatchlistTable initialRows={rows} />)).toContain('接近观察价：现价 101');
        // The interval forces a render even when the live quote object has not changed.
        queueClock.tick = new Date('2026-11-06T15:02:30Z');
        vi.setSystemTime(queueClock.tick);
        expect(renderToStaticMarkup(<WatchlistTable initialRows={rows} />)).not.toContain('接近观察价：现价 101');
    });
    it('does not retrofit missing snapshots and declines stale, previous-close and cross-currency comparisons', () => {
        expect(observationPriceChange(entry, { c: 110, currency: 'USD', priceBasis: 'last-trade' }).reason).toContain('旧记录不补造');
        const observed = { ...entry, initialSnapshot: snapshot };
        expect(observationPriceChange(observed, { c: 110, currency: 'USD', priceBasis: 'last-trade' }).value).toBeCloseTo(10);
        for (const quote of [
            { c: -110, currency: 'USD', priceBasis: 'last-trade' as const },
            { c: 0, currency: 'USD', priceBasis: 'last-trade' as const },
            { c: 110, currency: 'USD', priceBasis: 'previous-close' as const },
            { c: 110, currency: 'USD', priceBasis: 'last-trade' as const, stale: true },
            { c: 110, currency: 'HKD', priceBasis: 'last-trade' as const },
        ]) expect(observationPriceChange(observed, quote).value).toBeUndefined();
    });
    it('includes actual benchmark symbols in the quote batch and distinguishes pp from unadjusted observation changes', () => {
        const data: LiveQuoteMap = {
            AAPL: { c: 110, pc: 100, dp: 10, currency: 'USD', source: 'Finnhub', asOf: '2026-11-06T20:00:00Z', priceBasis: 'last-trade' },
            SPY: { c: 102, pc: 100, dp: 2, currency: 'USD', source: 'Finnhub', asOf: '2026-11-06T20:00:00Z', priceBasis: 'last-trade' },
        };
        quoteResource.mockReturnValue({ data, loading: false, stale: false, error: null });
        const html = renderToStaticMarkup(<WatchlistTable initialRows={[{ ...entry, initialSnapshot: snapshot, name: 'Apple', price: 110, currency: 'USD', change: 10, changePercent: 10, peRatio: 0 }]} />);
        expect(quoteResource.mock.calls[0][0]).toEqual(['AAPL', 'SPY', 'QQQ']);
        expect(html).toContain('+8.00 个百分点');
        expect(html).toContain('+10.00%');
        expect(html).toContain('未处理除权/费用');
        expect(html).toContain('ETF 代理');
        expect(html).toContain('仅比较成交价，不代表实际收益');
        expect(html).toContain('财务与加入信息');
        expect(html).toContain('自定义分组');
        expect(html).toContain('复核状态');
        expect(updateObservation).not.toHaveBeenCalled();
    });
    it('renders explicit missing legacy state and source health instead of synthetic gains', () => {
        const html = renderToStaticMarkup(<WatchlistTable initialRows={[{ ...entry, name: 'Apple', price: 100, currency: 'USD', change: 0, changePercent: 0, peRatio: 0 }]} />);
        expect(html).toContain('未记录初始观察价（旧记录不补造）');
        expect(html).toContain('来源未提供');
        expect(html).toContain('等待标的与基准报价');
        expect(html).toContain('观察更新：未记录');
        expect(html).toContain('状态标记时间：未记录');
        expect(html).not.toContain('+0.00%');
    });
});
