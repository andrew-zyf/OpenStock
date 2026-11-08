import { describe, expect, it } from 'vitest';
import { buildReviewQueue, isReviewDate, observationDistance, reviewQueueItem, type ReviewQueueQuote } from '@/lib/market/review-queue';

const now = new Date('2026-11-06T15:00:00Z');
const entry = { symbol: 'AAPL', targetPrice: 100 };
const quote: ReviewQueueQuote = { c: 101, currency: 'USD', source: 'Finnhub', asOf: '2026-11-06T14:59:30Z', priceBasis: 'last-trade' };

describe('review queue', () => {
    it('uses exchange-local dates instead of the browser or UTC date, including the US DST change', () => {
        const instant = new Date('2026-11-06T01:00:00Z');
        expect(reviewQueueItem({ ...entry, nextReviewDate: '2026-11-06' }, null, instant)).toMatchObject({ exchangeDate: '2026-11-05', timeZone: 'America/New_York' });
        expect(reviewQueueItem({ ...entry, nextReviewDate: '2026-11-06' }, null, instant).dueDate).toBeUndefined();
        expect(reviewQueueItem({ symbol: '2330.TW', nextReviewDate: '2026-11-06' }, null, instant).dueDate).toBe('2026-11-06');
        expect(reviewQueueItem(entry, null, new Date('2026-07-01T04:30:00Z')).exchangeDate).toBe('2026-07-01');
    });
    it.each([98, 99, 100, 101, 102])('includes both sides and the exact threshold at %s', c => {
        const item = reviewQueueItem(entry, { ...quote, c }, now);
        expect(item.proximity?.signedPercent).toBeCloseTo(c - 100);
        expect(item.proximity?.absolutePercent).toBeCloseTo(Math.abs(c - 100));
        expect(item.proximity?.threshold).toBe(2);
        expect(item.proximity?.source).toBe('Finnhub');
        expect(item).not.toHaveProperty('crossing');
    });
    it('honors an explicit zero and custom proximity without treating zero as the default', () => {
        expect(reviewQueueItem({ ...entry, proximityPercent: 0 }, quote, now).proximity).toBeUndefined();
        expect(reviewQueueItem({ ...entry, proximityPercent: 0 }, { ...quote, c: 100 }, now).proximity).toBeDefined();
        expect(reviewQueueItem({ ...entry, proximityPercent: 10 }, { ...quote, c: 90 }, now).proximity).toBeDefined();
        expect(reviewQueueItem(entry, { ...quote, c: 102.01 }, now).proximity).toBeUndefined();
    });
    it.each([
        { asOf: undefined }, { asOf: 'invalid' }, { asOf: '2026-11-06T15:00:01Z' }, { asOf: '2026-11-06T14:57:59Z' },
        { source: '' }, { source: ' ' }, { priceBasis: 'previous-close' as const }, { priceBasis: undefined },
        { stale: true }, { c: undefined }, { c: 0 }, { c: -100 }, { c: Infinity }, { currency: 'HKD' }, { currency: undefined },
    ])('excludes invalid/old/previous-close quotes while retaining independently due plans: %j', patch => {
        const item = reviewQueueItem({ ...entry, nextReviewDate: '2026-11-01' }, { ...quote, ...patch }, now);
        expect(item.proximity).toBeUndefined();
        expect(item.dueDate).toBe('2026-11-01');
    });
    it('does not turn previous close alone into a price', () => {
        expect(reviewQueueItem(entry, { ...quote, c: undefined, pc: 100 } as ReviewQueueQuote, now).proximity).toBeUndefined();
    });
    it.each(['2026-11-07T15:00:00Z', '2026-11-06T21:00:00Z', '2026-11-26T15:00:00Z', '2029-11-05T15:00:00Z'])('excludes weekends, closed, holiday and unverified calendars even with fresh timestamps: %s', instant => {
        expect(reviewQueueItem(entry, { ...quote, asOf: instant }, new Date(instant)).proximity).toBeUndefined();
    });
    it('requires the source sample itself to be inside the trading session', () => {
        expect(reviewQueueItem(entry, { ...quote, asOf: '2026-11-06T14:29:30Z' }, new Date('2026-11-06T14:30:30Z')).proximity).toBeUndefined();
    });
    it('sorts due plans first and proximity by absolute distance, and omits future plans without eligible prices', () => {
        const entries = [{ ...entry, symbol: 'MSFT' }, { ...entry, symbol: 'NVDA', nextReviewDate: '2026-11-05' },
            { ...entry, nextReviewDate: '2026-11-03' }, { ...entry, symbol: 'AMD', nextReviewDate: '2026-11-10' }];
        const queue = buildReviewQueue(entries, { MSFT: quote, AAPL: null, NVDA: quote }, now);
        expect(queue.map(item => item.symbol)).toEqual(['AAPL', 'NVDA', 'MSFT']);
    });
    it('rejects invalid dates and distances without throwing', () => {
        for (const value of ['2026-02-30', '2026-11-31', '2026-1-1', 'invalid', '']) expect(isReviewDate(value)).toBe(false);
        expect(isReviewDate('2028-02-29')).toBe(true);
        for (const price of [undefined, 0, -1, NaN, Infinity]) expect(observationDistance(100, price)).toBeUndefined();
        expect(observationDistance(0, 100)).toBeUndefined();
        expect(buildReviewQueue([{ ...entry, nextReviewDate: '2026-02-30' }], {}, now)).toEqual([]);
        expect(buildReviewQueue([entry], { AAPL: quote }, new Date(NaN))).toEqual([]);
    });
});
