import { describe, expect, it } from 'vitest';
import { getInstrumentSession, getMarketSession } from '@/lib/market/sessions';
import { EXCHANGE_CALENDARS, getExchangeCalendarDay } from '@/lib/market/calendar';
import { getMarket, isMarketOpen } from '@/lib/markets';

const session = (symbol: string, instant: string) => getInstrumentSession(symbol, new Date(instant));
const cn = (time: string) => session('SSE:600000', `2026-03-09T${time}+08:00`);
const hk = (time: string) => session('HKEX:700', `2026-03-09T${time}+08:00`);
const tw = (time: string) => session('2330.TW', `2026-03-09T${time}+08:00`);

describe('scheduled exchange sessions', () => {
    it.each([
        ['08:59:59', 'closed', false], ['09:00:00', 'preopen', false],
        ['09:14:59', 'preopen', false], ['09:15:00', 'auction', true],
        ['09:24:59', 'auction', true], ['09:25:00', 'preopen', false],
        ['09:29:59', 'preopen', false], ['09:30:00', 'continuous', true],
        ['11:29:59', 'continuous', true], ['11:30:00', 'break', false],
        ['12:59:59', 'break', false], ['13:00:00', 'continuous', true],
        ['14:56:59', 'continuous', true], ['14:57:00', 'closing-auction', true],
        ['14:59:59', 'closing-auction', true], ['15:00:00', 'closed', false],
    ])('CN %s is %s', (time, phase, isTrading) => {
        expect(cn(time)).toMatchObject({ phase, isTrading, calendarStatus: 'verified', timeZone: 'Asia/Shanghai', exchangeDate: '2026-03-09' });
    });
    it.each(['SSE:600000', '000001.SZ', '830799.BJ'])('uses mainland session hours for %s', symbol => {
        expect(session(symbol, '2026-03-09T12:00:00+08:00')).toMatchObject({ phase: 'break', isTrading: false });
        expect(session(symbol, '2026-03-09T14:57:00+08:00')).toMatchObject({ phase: 'closing-auction', isTrading: true });
    });
    it.each([
        ['09:00:00', 'auction', true], ['09:21:59', 'auction', true],
        ['09:22:00', 'preopen', false], ['09:30:00', 'continuous', true],
        ['11:59:59', 'continuous', true], ['12:00:00', 'break', false],
        ['12:59:59', 'break', false], ['13:00:00', 'continuous', true],
        ['15:59:59', 'continuous', true], ['16:00:00', 'closing-auction', true],
        ['16:09:59', 'closing-auction', true], ['16:10:00', 'closed', false],
    ])('HK %s is %s within its published scheduled window', (time, phase, isTrading) => {
        expect(hk(time)).toMatchObject({ phase, isTrading, timeZone: 'Asia/Hong_Kong' });
    });
    it.each([
        ['08:00:00', 'preopen', false], ['08:29:59', 'preopen', false],
        ['08:30:00', 'auction', true], ['08:59:59', 'auction', true],
        ['09:00:00', 'continuous', true], ['12:00:00', 'continuous', true],
        ['13:24:59', 'continuous', true], ['13:25:00', 'closing-auction', true],
        ['13:29:59', 'closing-auction', true], ['13:30:00', 'closed', false],
    ])('TW %s is %s, with no lunch break', (time, phase, isTrading) => {
        expect(tw(time)).toMatchObject({ phase, isTrading, timeZone: 'Asia/Taipei' });
    });
    it('keeps TPEx identity and uses its own official calendar source', () => {
        expect(session('6488.TWO', '2026-03-09T13:25:00+08:00')).toMatchObject({ phase: 'closing-auction', calendarStatus: 'verified', calendarSource: EXCHANGE_CALENDARS.TPEX.source });
    });
    it('gives exact same-date transition instants without seconds drift', () => {
        expect(cn('11:29:59').nextTransition).toBe('2026-03-09T03:30:00.000Z');
        expect(cn('11:30:00').nextTransition).toBe('2026-03-09T05:00:00.000Z');
        expect(session('SSE:600000', '2026-03-09T09:24:59.999+08:00').nextTransition).toBe('2026-03-09T01:25:00.000Z');
        expect(tw('13:30:00').nextTransition).toBeUndefined();
    });
    it('makes legacy market-open checks reflect lunch breaks and auctions', () => {
        for (const id of ['cn', 'hk'] as const) {
            expect(isMarketOpen(getMarket(id), new Date('2026-03-09T12:00:00+08:00'))).toBe(false);
            expect(isMarketOpen(getMarket(id), new Date('2026-03-09T13:00:00+08:00'))).toBe(true);
        }
        expect(getMarketSession('cn', new Date('2026-03-09T11:30:00+08:00'))).toEqual(cn('11:30:00'));
        expect(isMarketOpen(getMarket('cn'), new Date('2026-03-09T14:57:00+08:00'))).toBe(true);
    });
});

describe('bounded official calendars', () => {
    it.each(['SSE:600000', '000001.SZ', '830799.BJ', 'HKEX:700', '2330.TW', '6488.TWO', 'AAPL'])('verifies the official New Year closure for %s', symbol => {
        expect(session(symbol, '2026-01-01T15:00:00Z')).toMatchObject({ phase: 'holiday', isTrading: false, calendarStatus: 'verified', exchangeDate: '2026-01-01' });
    });
    it('uses exchange dates rather than the UTC year for calendar coverage', () => {
        expect(session('SSE:600000', '2025-12-31T16:00:00Z')).toMatchObject({ exchangeDate: '2026-01-01', phase: 'holiday', calendarStatus: 'verified' });
        expect(session('AAPL', '2027-01-01T02:00:00Z')).toMatchObject({ exchangeDate: '2026-12-31', phase: 'closed', calendarStatus: 'verified' });
    });
    it.each(['2026-02-12', '2026-02-13', '2026-09-28', '2026-10-26'])('treats TW official non-trading dates as closures: %s', date => {
        for (const symbol of ['2330.TW', '6488.TWO']) {
            expect(session(symbol, `${date}T10:00:00+08:00`)).toMatchObject({ phase: 'holiday', isTrading: false, calendarStatus: 'verified' });
        }
    });
    it('does not make CN weekend government make-up workdays trading days', () => {
        expect(session('SSE:600000', '2026-02-28T10:00:00+08:00')).toMatchObject({ phase: 'closed', isTrading: false, calendarStatus: 'verified' });
    });
    it.each(['2026-02-16', '2026-12-24', '2026-12-31'])('handles HK official half-days: %s', date => {
        expect(session('HKEX:700', `${date}T11:59:59+08:00`)).toMatchObject({ phase: 'continuous', isTrading: true });
        expect(session('HKEX:700', `${date}T12:00:00+08:00`)).toMatchObject({ phase: 'closing-auction', isTrading: true, nextTransition: `${date}T04:10:00.000Z` });
        expect(session('HKEX:700', `${date}T12:10:00+08:00`)).toMatchObject({ phase: 'closed', isTrading: false });
        expect(session('HKEX:700', `${date}T13:00:00+08:00`)).toMatchObject({ phase: 'closed', isTrading: false });
    });
    it.each(['2026-11-27', '2026-12-24'])('handles US official 13:00 ET early closes: %s', date => {
        expect(session('AAPL', `${date}T12:59:59-05:00`)).toMatchObject({ phase: 'continuous', isTrading: true, nextTransition: `${date}T18:00:00.000Z` });
        expect(session('AAPL', `${date}T13:00:00-05:00`)).toMatchObject({ phase: 'closed', isTrading: false, calendarStatus: 'verified' });
    });
    it.each(['2025-01-01', '2027-01-01'])('never extrapolates a verified New Year holiday outside coverage: %s', date => {
        for (const symbol of ['SSE:600000', 'HKEX:700', '2330.TW', 'AAPL']) {
            const result = session(symbol, `${date}T15:00:00Z`);
            expect(result.calendarStatus).toBe('unverified');
            expect(result.phase).not.toBe('holiday');
        }
    });
    it('keeps scheduled trading independent of calendar verification', () => {
        expect(session('SSE:600000', '2027-01-04T10:00:00+08:00')).toMatchObject({ phase: 'continuous', isTrading: true, calendarStatus: 'unverified' });
        expect(session('AAPL', '2027-01-02T10:00:00-05:00')).toMatchObject({ phase: 'closed', isTrading: false, calendarStatus: 'unverified' });
    });
    it('retains actual source URLs, annual bounds and versions for all exchanges', () => {
        for (const calendar of Object.values(EXCHANGE_CALENDARS)) {
            expect(calendar.source).toMatch(/^https:\/\//);
            expect(calendar.version).toBeTruthy();
            expect(calendar.coverage).toEqual({ start: '2026-01-01', end: '2026-12-31' });
            expect(calendar.holidays.every(date => date.startsWith('2026-'))).toBe(true);
        }
        expect(getExchangeCalendarDay('HKEX', '2027-12-24')).toMatchObject({ calendarStatus: 'unverified', isHoliday: false, halfDayClose: undefined });
    });
});

describe('US IANA timezone and safe unknown status', () => {
    it.each([
        ['2026-03-06', '14:29:59Z', 'preopen', false], ['2026-03-06', '14:30:00Z', 'continuous', true],
        ['2026-03-09', '13:29:59Z', 'preopen', false], ['2026-03-09', '13:30:00Z', 'continuous', true],
        ['2026-10-30', '13:29:59Z', 'preopen', false], ['2026-10-30', '13:30:00Z', 'continuous', true],
        ['2026-11-02', '14:29:59Z', 'preopen', false], ['2026-11-02', '14:30:00Z', 'continuous', true],
        ['2026-03-09', '19:59:59Z', 'continuous', true], ['2026-03-09', '20:00:00Z', 'closed', false],
        ['2026-11-02', '20:59:59Z', 'continuous', true], ['2026-11-02', '21:00:00Z', 'closed', false],
    ])('%s %s maps to New York %s', (date, time, phase, isTrading) => {
        expect(session('AAPL', `${date}T${time}`)).toMatchObject({ phase, isTrading, timeZone: 'America/New_York', calendarStatus: 'verified' });
    });
    it('returns correctly offset transition instants on each side of DST', () => {
        expect(session('AAPL', '2026-03-06T14:00:00Z').nextTransition).toBe('2026-03-06T14:30:00.000Z');
        expect(session('AAPL', '2026-03-09T13:00:00Z').nextTransition).toBe('2026-03-09T13:30:00.000Z');
        expect(session('AAPL', '2026-11-02T14:00:00Z').nextTransition).toBe('2026-11-02T14:30:00.000Z');
    });
    it.each(['2026-03-08T07:00:00Z', '2026-11-01T06:00:00Z'])('stays closed through Sunday DST change: %s', instant => {
        expect(session('AAPL', instant)).toMatchObject({ phase: 'closed', isTrading: false, calendarStatus: 'verified' });
    });
    it.each(['???', '', 'FOO:BAR', 'BINANCE:BTCUSDT'])('never assigns a verified schedule to unknown identity: %s', symbol => {
        expect(session(symbol, '2026-01-01T15:00:00Z')).toMatchObject({ phase: 'unknown', isTrading: false, calendarStatus: 'unverified' });
    });
    it('fails closed for an invalid instant', () => {
        expect(getInstrumentSession('AAPL', new Date(NaN))).toMatchObject({ phase: 'unknown', isTrading: false, calendarStatus: 'unverified' });
    });
});
