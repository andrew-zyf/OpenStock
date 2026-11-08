import { describe, expect, it } from 'vitest';
import { evaluateSample, validObservation, type AlertObservation, type AlertQuote, type AlertSession } from '@/lib/alerts/evaluation';

const now = new Date('2026-11-09T02:00:00.000Z');
const session: AlertSession = { isTrading: true, calendarStatus: 'verified', exchangeDate: '2026-11-09' };
const quote: AlertQuote = { price: 101, source: 'tencent', asOf: '2026-11-09T01:59:30.000Z', priceBasis: 'last-trade' };
const sample = (price: number, asOf = quote.asOf!): AlertObservation => ({ price, asOf, source: 'tencent' });

 describe('fresh source observations', () => {
    it('retains source time rather than inventing current/fetch time', () => {
        expect(validObservation(quote, session, session, now)).toEqual(sample(101));
    });
    it.each([0, -1, NaN, Infinity])('rejects invalid prices: %s', price => {
        expect(validObservation({ ...quote, price }, session, session, now)).toBeNull();
    });
    it.each([
        null,
        { ...quote, asOf: undefined },
        { ...quote, asOf: 'invalid' },
        { ...quote, asOf: '2026-11-09T01:57:59.999Z' },
        { ...quote, asOf: '2026-11-09T02:00:00.001Z' },
        { ...quote, priceBasis: 'previous-close' as const },
        { ...quote, priceBasis: undefined },
        { ...quote, source: '' },
    ])('rejects missing, unknown-time, stale, future or fallback quotes (%j)', invalid => {
        expect(validObservation(invalid, session, session, now)).toBeNull();
    });
    it('accepts the two-minute freshness boundary, not older sources', () => {
        expect(validObservation({ ...quote, asOf: '2026-11-09T01:58:00.000Z' }, session, session, now)).not.toBeNull();
    });
    it.each(['now', 'source'])('requires a verified calendar at %s time', when => {
        const unavailable = { ...session, calendarStatus: 'unverified' as const };
        expect(validObservation(quote, when === 'now' ? unavailable : session, when === 'source' ? unavailable : session, now)).toBeNull();
    });
    it('accepts a fresh trading observation just after closing, but rejects observations produced while closed', () => {
        expect(validObservation(quote, { ...session, isTrading: false }, session, now)).toEqual(sample(101));
        expect(validObservation(quote, session, { ...session, isTrading: false }, now)).toBeNull();
    });
    it('rejects a quote from a different exchange date', () => {
        expect(validObservation(quote, session, { ...session, exchangeDate: '2026-11-06' }, now)).toBeNull();
    });
});

describe('sampled crossing and explicit legacy threshold behavior', () => {
    const base = { mode: 'crossing' as const, targetPrice: 100, condition: 'ABOVE' as const };
    const previous = (price: number) => sample(price, '2026-11-09T01:55:00.000Z');
    it('first valid sample only seeds, including when already above or below', () => {
        expect(evaluateSample(base, sample(101))).toBe('observe');
        expect(evaluateSample({ ...base, condition: 'BELOW' }, sample(99))).toBe('observe');
    });
    it('fires upward crossing, including reaching the target exactly', () => {
        expect(evaluateSample({ ...base, lastObservation: previous(99) }, sample(101))).toBe('trigger');
        expect(evaluateSample({ ...base, lastObservation: previous(99) }, sample(100))).toBe('trigger');
    });
    it('fires downward crossing, including reaching the target exactly', () => {
        expect(evaluateSample({ ...base, condition: 'BELOW', lastObservation: previous(101) }, sample(99))).toBe('trigger');
        expect(evaluateSample({ ...base, condition: 'BELOW', lastObservation: previous(101) }, sample(100))).toBe('trigger');
    });
    it.each([[101, 102], [99, 98], [100, 101]])('does not invent an upward crossing from %s to %s', (before, after) => {
        expect(evaluateSample({ ...base, lastObservation: previous(before) }, sample(after))).toBe('observe');
    });
    it('waits for a return below then upward crossing if already above at creation', () => {
        expect(evaluateSample({ ...base, lastObservation: previous(101) }, sample(102))).toBe('observe');
        expect(evaluateSample({ ...base, lastObservation: previous(102) }, sample(99))).toBe('observe');
        expect(evaluateSample({ ...base, lastObservation: previous(99) }, sample(101))).toBe('trigger');
    });
    it('ignores duplicate timestamps and out-of-order samples even when price differs', () => {
        for (const asOf of ['2026-11-09T01:55:00.000Z', '2026-11-09T01:54:00.000Z']) {
            expect(evaluateSample({ ...base, lastObservation: previous(99) }, sample(101, asOf))).toBe('ignore');
        }
    });
    it('preserves old inclusive threshold alerts with no mode or explicit legacy mode', () => {
        expect(evaluateSample({ targetPrice: 100, condition: 'ABOVE' }, sample(100))).toBe('trigger');
        expect(evaluateSample({ mode: 'legacy-threshold', targetPrice: 100, condition: 'BELOW' }, sample(99))).toBe('trigger');
    });
});
