import { Temporal } from 'temporal-polyfill';
import { identifyMarketAndCode } from './instrument';

/** Calendar dates have no midnight timestamp and must not shift with the viewer's zone. */
export function validCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    try { return Temporal.PlainDate.from(value, { overflow: 'reject' }).toString() === value; }
    catch { return false; }
}

export function exchangeTimeZone(symbol: string): string {
    const market = identifyMarketAndCode(symbol).market;
    return market === 'us' ? 'America/New_York' : market === 'hk' ? 'Asia/Hong_Kong' : market === 'tw' ? 'Asia/Taipei' : 'Asia/Shanghai';
}

export function exchangeDateForSymbol(symbol: string, now = new Date()): string {
    return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(exchangeTimeZone(symbol)).toPlainDate().toString();
}

export function addCalendarDays(date: string, days: number): string {
    return Temporal.PlainDate.from(date, { overflow: 'reject' }).add({ days }).toString();
}
