import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { addCalendarDays, exchangeDateForSymbol, validCalendarDate } from '@/lib/market/dates';
import { eventInUpcomingWeek, parseCnDisclosureEvents, parseTwseEvents, safeEvidenceUrl, validateEventInput, type EventInput } from '@/lib/market/events';
import TradingContext from '@/components/stocks/TradingContext';

const now = new Date('2026-11-08T01:00:00Z');
const input: EventInput = { symbol: '2330.TW', title: ' 核查公告 ', date: '2026-11-13', kind: 'other', clientRequestId: 'request-123' };
describe('calendar-date and event provenance', () => {
    it('keeps calendar dates location agnostic and validates leap dates', () => {
        expect(validCalendarDate('2028-02-29')).toBe(true);
        expect(validCalendarDate('2027-02-29')).toBe(false);
        expect(validCalendarDate('2026-11-08T00:00:00Z')).toBe(false);
        expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(exchangeDateForSymbol('2330.TW', now)).toBe('2026-11-08');
        expect(exchangeDateForSymbol('AAPL', now)).toBe('2026-11-07');
    });
    it('uses local market dates across daylight-saving changes', () => {
        expect(exchangeDateForSymbol('AAPL', new Date('2026-11-01T04:30:00Z'))).toBe('2026-11-01');
        expect(eventInUpcomingWeek({ symbol: '2330.TW', date: '2026-11-14' }, now)).toBe(true);
        expect(eventInUpcomingWeek({ symbol: '2330.TW', date: '2026-11-15' }, now)).toBe(false);
    });
    it('accepts only safe evidence links and explicit user fields', () => {
        expect(validateEventInput({ ...input, sourceUrl: 'https://www.twse.com.tw/' })).toMatchObject({ title: '核查公告', date: '2026-11-13' });
        expect(safeEvidenceUrl('')).toBeUndefined();
        expect(() => safeEvidenceUrl('javascript:alert(1)')).toThrow();
        expect(() => safeEvidenceUrl('https://:example@example.com/')).toThrow();
        expect(() => safeEvidenceUrl('https://user:password@example.com')).toThrow();
        expect(() => validateEventInput({ ...input, date: '2026-02-30' })).toThrow();
        expect(() => validateEventInput({ ...input, symbol: 'garbage:bad' })).toThrow();
    });
    it('reads ROC dates and only labels actual official rows as official schedules', () => {
        const events = parseTwseEvents([
            { Date: '1151113', Code: '2330', Name: '台積電', Exdividend: '息' },
            { Date: '1151106', Code: '2330' }, { Date: '1151113', Code: '0050' },
            { Date: '1150230', Code: '2330' },
        ], ['2330.TW'], now);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ date: '2026-11-13', certainty: 'official-schedule', kind: 'ex-dividend' });
        expect(events[0].note).toContain('可能变更');
        expect(parseTwseEvents([], ['6488.TWO'], now)).toEqual([]);
    });
    it('keeps A-share appointments estimated and excludes already disclosed or unmatched records', () => {
        const row = { SECUCODE: '600519.SH', REPORT_DATE: '2026-09-30', REPORT_TYPE_NAME: '三季报', APPOINT_PUBLISH_DATE: '2026-11-10 00:00:00', IS_PUBLISH: '0' };
        const events = parseCnDisclosureEvents([row, { ...row, IS_PUBLISH: '1' }, { ...row, SECUCODE: '300750.SZ' }], ['600519.SS'], now);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ symbol: '600519.SS', date: '2026-11-10', certainty: 'estimated' });
    });
    it('does not pretend a common board lot applies to every security', () => {
        const hk = renderToStaticMarkup(createElement(TradingContext, { symbol: '09988.HK' }));
        expect(hk).toContain('每手股数尚未核验');
        expect(hk).toContain('由具体证券发行人确定');
        const otc = renderToStaticMarkup(createElement(TradingContext, { symbol: '6488.TWO' }));
        expect(otc).toContain('https://www.tpex.org.tw/');
        expect(otc).toContain('上柜市场');
    });
});
