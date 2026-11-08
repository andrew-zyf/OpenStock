import type { MarketId } from '../markets';
import { identifyMarketAndCode, type ExchangeId } from './instrument';
import { getExchangeCalendarDay, type CalendarStatus } from './calendar';

export type SessionPhase = 'preopen' | 'auction' | 'continuous' | 'break' | 'closing-auction' | 'closed' | 'holiday' | 'unknown';
export type MarketSession = {
    phase: SessionPhase;
    label: string;
    exchangeDate: string;
    timeZone: string;
    /** Scheduled regular cash session, including auction order collection.
     * Not a live execution/halt signal; US extended sessions are excluded. */
    isTrading: boolean;
    calendarStatus: CalendarStatus;
    calendarSource?: string;
    /** ISO instant of the next scheduled phase change on this exchange date, if any.
     * HK auction endpoints are the published maximum random-matching windows. */
    nextTransition?: string;
};

const TIME_ZONES: Record<MarketId, string> = {
    cn: 'Asia/Shanghai', hk: 'Asia/Hong_Kong', tw: 'Asia/Taipei', us: 'America/New_York',
};
const EXCHANGES: Record<MarketId, ExchangeId> = { cn: 'SSE', hk: 'HKEX', tw: 'TWSE', us: 'US' };
const LABELS: Record<SessionPhase, string> = {
    preopen: '盘前准备（计划）', auction: '开盘集合竞价（计划）', continuous: '连续交易（计划）',
    break: '午间休市（计划）', 'closing-auction': '收盘集合竞价（计划）', closed: '已休市（计划）',
    holiday: '节假日休市（计划）', unknown: '交易时段未知',
};

type Boundary = readonly [minute: number, phase: SessionPhase];
// End-exclusive boundaries for ordinary equities. No odd-lot, after-hours,
// instrument-specific auctions or unscheduled halts are inferred here.
const SCHEDULES: Record<MarketId, readonly Boundary[]> = {
    cn: [[0, 'closed'], [540, 'preopen'], [555, 'auction'], [565, 'preopen'], [570, 'continuous'], [690, 'break'], [780, 'continuous'], [897, 'closing-auction'], [900, 'closed']],
    hk: [[0, 'closed'], [540, 'auction'], [562, 'preopen'], [570, 'continuous'], [720, 'break'], [780, 'continuous'], [960, 'closing-auction'], [970, 'closed']],
    tw: [[0, 'closed'], [480, 'preopen'], [510, 'auction'], [540, 'continuous'], [805, 'closing-auction'], [810, 'closed']],
    us: [[0, 'closed'], [240, 'preopen'], [570, 'continuous'], [960, 'closed']],
};

// Retain IANA zones: Intl applies New York DST rather than a fixed UTC offset.
const formatters = new Map<string, Intl.DateTimeFormat>();
function localClock(now: Date, timeZone: string) {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone, calendar: 'gregory', numberingSystem: 'latn',
            year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        });
        formatters.set(timeZone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return {
        exchangeDate: `${parts.year}-${parts.month}-${parts.day}`, minutes,
        weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
        // Same-date session changes cannot cross a DST change in these exchanges:
        // New York changes its offset on Sunday, when the regular market is closed.
        localMidnight: now.getTime() - (minutes * 60_000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds()),
    };
}

function sessionFor(market: MarketId, exchange: ExchangeId, now: Date, recognized = true): MarketSession {
    const timeZone = TIME_ZONES[market];
    if (!Number.isFinite(now.getTime())) {
        return { phase: 'unknown', label: LABELS.unknown, exchangeDate: '', timeZone, isTrading: false, calendarStatus: 'unverified' };
    }
    const clock = localClock(now, timeZone);
    if (!recognized) {
        return { phase: 'unknown', label: LABELS.unknown, exchangeDate: clock.exchangeDate, timeZone, isTrading: false, calendarStatus: 'unverified' };
    }
    const { calendarStatus, calendarSource, isHoliday, halfDayClose } = getExchangeCalendarDay(exchange, clock.exchangeDate);
    let phase: SessionPhase;
    let nextMinute: number | undefined;
    if (isHoliday) phase = 'holiday';
    else if (clock.weekend) phase = 'closed';
    else {
        let schedule = SCHEDULES[market];
        if (halfDayClose !== undefined) {
            schedule = market === 'hk'
                ? [...schedule.filter(([minute]) => minute < halfDayClose), [halfDayClose, 'closing-auction'], [halfDayClose + 10, 'closed']]
                : [...schedule.filter(([minute]) => minute < halfDayClose), [halfDayClose, 'closed']];
        }
        const index = schedule.findIndex(([minute], index) => minute <= clock.minutes && (schedule[index + 1]?.[0] ?? Infinity) > clock.minutes);
        phase = schedule[index][1];
        nextMinute = schedule[index + 1]?.[0];
    }
    return {
        phase, label: LABELS[phase], exchangeDate: clock.exchangeDate, timeZone,
        isTrading: phase === 'continuous' || phase === 'auction' || phase === 'closing-auction',
        calendarStatus, calendarSource,
        ...(nextMinute === undefined ? {} : { nextTransition: new Date(clock.localMidnight + nextMinute * 60_000).toISOString() }),
    };
}

/** Unknown calendar dates use weekday hours, with calendarStatus='unverified'.
 * A verified calendar describes published schedules, not live market conditions. */
export function getInstrumentSession(symbol: string, now = new Date()): MarketSession {
    const instrument = identifyMarketAndCode(symbol);
    return sessionFor(instrument.market, instrument.exchangeId, now, instrument.kind !== 'unknown');
}

/** Market-level session uses SSE, HKEX, TWSE and common US regular-equity hours. */
export function getMarketSession(market: MarketId | { id: MarketId }, now = new Date()): MarketSession {
    const id = typeof market === 'string' ? market : market.id;
    return sessionFor(id, EXCHANGES[id], now);
}
