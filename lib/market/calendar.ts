import type { ExchangeId } from './instrument';

export type CalendarStatus = 'verified' | 'unverified';
export type ExchangeCalendar = {
    coverage: { start: string; end: string };
    source: string;
    version: string;
    holidays: readonly string[];
    halfDays?: Readonly<Record<string, number>>; // local minutes: continuous trading ends
};

// Bounded, offline snapshots of official regular cash-market calendars. These do not
// describe unscheduled closures, individual halts, Stock Connect or derivatives.
// Reviewed 2026-11-08; do not extrapolate holidays into another year.
const coverage = { start: '2026-01-01', end: '2026-12-31' };
const cnHolidays = [
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
];
const twHolidays = [
    '2026-01-01',
    // February 12–13 are settlement-only: no equity trading.
    '2026-02-12', '2026-02-13', '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-27', '2026-02-28',
    '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06', '2026-05-01', '2026-06-19',
    '2026-09-25', '2026-09-28', '2026-10-09', '2026-10-10', '2026-10-25', '2026-10-26', '2026-12-25',
];

export const EXCHANGE_CALENDARS: Readonly<Record<ExchangeId, ExchangeCalendar>> = {
    SSE: {
        coverage, source: 'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml',
        version: '2025-12-22 / 上证公告〔2025〕45号', holidays: cnHolidays,
    },
    SZSE: {
        coverage, source: 'https://investor.szse.cn/disclosure/notice/general/t20251222_618087.html',
        version: '2025-12-22 / 深证会〔2025〕481号', holidays: cnHolidays,
    },
    BSE: {
        coverage, source: 'https://www.bse.cn/important_news/200027428.html',
        version: '2025-12-22 / BSE Notice [2025] No. 58', holidays: cnHolidays,
    },
    HKEX: {
        coverage,
        source: 'https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf',
        version: '2025-06-02 / CT/075/25',
        holidays: [
            '2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19',
            '2026-04-03', '2026-04-06', '2026-04-07', '2026-05-01', '2026-05-25',
            '2026-06-19', '2026-07-01', '2026-10-01', '2026-10-19', '2026-12-25',
        ],
        halfDays: { '2026-02-16': 720, '2026-12-24': 720, '2026-12-31': 720 },
    },
    TWSE: {
        coverage, source: 'https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html&queryYear=115',
        version: 'ROC 115 / 2026 annual schedule, reviewed 2026-11-08', holidays: twHolidays,
    },
    TPEX: {
        coverage, source: 'https://www.tpex.org.tw/storage/eb_data/11411/114007545811-1.pdf',
        version: 'ROC 115 / 114007545811-1 annual schedule', holidays: twHolidays,
    },
    US: {
        coverage, source: 'https://www.nyse.com/trade/hours-calendars',
        version: '2026 annual regular-equities schedule, reviewed 2026-11-08',
        holidays: [
            '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
            '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
        ],
        halfDays: { '2026-11-27': 780, '2026-12-24': 780 },
    },
};

export function getExchangeCalendarDay(exchange: ExchangeId, exchangeDate: string) {
    const calendar = EXCHANGE_CALENDARS[exchange];
    const verified = exchangeDate >= calendar.coverage.start && exchangeDate <= calendar.coverage.end;
    return {
        calendarStatus: (verified ? 'verified' : 'unverified') as CalendarStatus,
        calendarSource: calendar.source,
        isHoliday: verified && calendar.holidays.includes(exchangeDate),
        halfDayClose: verified ? calendar.halfDays?.[exchangeDate] : undefined,
    };
}
