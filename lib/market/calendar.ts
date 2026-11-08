import type { ExchangeId } from './instrument';

export type CalendarStatus = 'verified' | 'unverified';
export type ExchangeCalendar = {
    coverage: { start: string; end: string };
    source: string;
    version: string;
    reviewedAt?: string;
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

/** Separately bounded snapshots preserve the reviewed 2026 calendars verbatim.
 * Review must establish cash-equity coverage: government calendars, derivatives notices
 * and a successful HTTP response containing a different year are not sufficient. */
export const EXCHANGE_CALENDARS_2027: Readonly<Partial<Record<ExchangeId, ExchangeCalendar>>> = {
    HKEX: {
        coverage: { start: '2027-01-01', end: '2027-12-31' },
        source: 'https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2026/ce_SEHK_CT_077_2026.pdf',
        version: '2026-06-01 / CT/077/26, cash securities, pages 1–2', reviewedAt: '2026-11-08',
        holidays: [
            '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-03-29',
            '2027-04-05', '2027-05-13', '2027-06-09', '2027-07-01', '2027-09-16',
            '2027-10-01', '2027-10-08', '2027-12-27',
        ],
        halfDays: { '2027-02-05': 720, '2027-12-24': 720, '2027-12-31': 720 },
    },
    US: {
        coverage: { start: '2027-01-01', end: '2027-12-31' },
        source: 'https://www.nyse.com/trade/hours-calendars',
        version: '2025-12-23 / NYSE Group 2026–2028 regular-equities schedule', reviewedAt: '2026-11-08',
        holidays: [
            '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
            '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
        ],
        halfDays: { '2027-11-26': 780 },
    },
};

const REVIEWED_AT = '2026-11-08';
const UNVERIFIED_NOTES: Partial<Record<ExchangeId, string>> = {
    SSE: '2027 年现货交易所公告未核实；不得用政府假日或推算日期续期。',
    SZSE: '2027 年现货交易所公告未核实；不得沿用上交所未核实的新年度安排。',
    BSE: '2027 年现货交易所公告未核实；需单独核对北交所公告。',
    HKEX: '需核对目标年度的现货证券公告及半日市。',
    TWSE: '2027 查询返回 115/2026 旧年度正文；116/2027 尚未核实。',
    TPEX: '2027 年柜买市场开休市表尚未核实；不得用政府或上市市场日历代替。',
    US: '需核对目标年度 NYSE 常规股票休市及提前收盘公告。',
};

function snapshots(exchange: ExchangeId): ExchangeCalendar[] {
    const extension = EXCHANGE_CALENDARS_2027[exchange];
    return extension ? [EXCHANGE_CALENDARS[exchange], extension] : [EXCHANGE_CALENDARS[exchange]];
}

/** Offline maintenance evidence; an unverified year always requires official review. */
export function getCalendarMaintenanceSummary(targetYear: number) {
    const start = `${targetYear}-01-01`;
    const end = `${targetYear}-12-31`;
    return (Object.keys(EXCHANGE_CALENDARS) as ExchangeId[]).map(exchange => {
        const all = snapshots(exchange);
        const verified = all.find(calendar => calendar.coverage.start <= start && calendar.coverage.end >= end);
        const latest = all[all.length - 1];
        return {
            exchange, targetYear, calendarStatus: (verified ? 'verified' : 'unverified') as CalendarStatus,
            verifiedThrough: latest.coverage.end, source: (verified ?? latest).source,
            reviewedAt: (verified ?? latest).reviewedAt ?? REVIEWED_AT,
            renewalRequired: !verified,
            note: verified ? '已核验全年常规现货安排；不含临时停市。' : `${targetYear} 年未核验；${UNVERIFIED_NOTES[exchange] ?? '请核对交易所年度公告。'}`,
        };
    });
}

export function getExchangeCalendarDay(exchange: ExchangeId, exchangeDate: string) {
    const all = snapshots(exchange);
    const calendar = all.find(calendar => exchangeDate >= calendar.coverage.start && exchangeDate <= calendar.coverage.end);
    const latest = all[all.length - 1];
    return {
        calendarStatus: (calendar ? 'verified' : 'unverified') as CalendarStatus,
        calendarSource: (calendar ?? latest).source,
        calendarCoverageEnd: (calendar ?? latest).coverage.end,
        calendarReviewedAt: (calendar ?? latest).reviewedAt ?? REVIEWED_AT,
        calendarRenewalRequired: !calendar,
        isHoliday: Boolean(calendar?.holidays.includes(exchangeDate)),
        halfDayClose: calendar?.halfDays?.[exchangeDate],
    };
}
