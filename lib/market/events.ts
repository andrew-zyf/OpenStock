import { identifyMarketAndCode } from './instrument';
import { addCalendarDays, exchangeDateForSymbol, validCalendarDate } from './dates';

export type MarketEvent = {
    id: string; symbol: string; title: string; date: string;
    kind: 'earnings' | 'ex-dividend' | 'other';
    certainty: 'official-schedule' | 'estimated' | 'user';
    source: string; sourceUrl?: string; note?: string; createdAt?: string;
};
export type EventInput = { symbol: string; title: string; date: string; kind: MarketEvent['kind']; sourceUrl?: string; note?: string; clientRequestId: string };
export type EventSourceStatus = { source: string; status: 'ready' | 'error' | 'unsupported'; detail: string };
export type EventCalendarData = { events: MarketEvent[]; sources: EventSourceStatus[]; fetchedAt: string; manualLimit: number };
const rowObjects = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((row) => row && typeof row === 'object' && !Array.isArray(row)) : [];

export function safeEvidenceUrl(value: unknown): string | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string' || value.length > 1500) throw new Error('来源链接最多 1500 字');
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error('来源链接须为完整 http(s) 地址'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('来源链接须为不含登录信息的 http(s) 地址');
    return url.href;
}

export function validateEventInput(input: EventInput): EventInput {
    if (!input || typeof input.symbol !== 'string' || input.symbol.length > 40) throw new Error('请选择自选标的');
    const meta = identifyMarketAndCode(input.symbol);
    if (meta.kind === 'unknown') throw new Error('标的身份尚未确认');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120) throw new Error('事件标题须为 1–120 字');
    if (!validCalendarDate(input.date)) throw new Error('请填写有效日期');
    if (!['earnings', 'ex-dividend', 'other'].includes(input.kind)) throw new Error('事件类别无效');
    if (input.note != null && (typeof input.note !== 'string' || input.note.length > 2000)) throw new Error('备注最多 2000 字');
    if (typeof input.clientRequestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.clientRequestId)) throw new Error('请求标识无效，请重新打开表单');
    return { symbol: meta.normalizedSymbol, title: input.title.trim(), date: input.date, kind: input.kind,
        sourceUrl: safeEvidenceUrl(input.sourceUrl), note: input.note?.trim() || undefined, clientRequestId: input.clientRequestId };
}

export function eventInUpcomingWeek(event: Pick<MarketEvent, 'symbol' | 'date'>, now: Date): boolean {
    const start = exchangeDateForSymbol(event.symbol, now);
    return validCalendarDate(event.date) && event.date >= start && event.date <= addCalendarDays(start, 6);
}

export function parseTwseEvents(value: unknown, symbols: string[], now: Date): MarketEvent[] {
    const wanted = new Set(symbols.map((symbol) => identifyMarketAndCode(symbol).normalizedSymbol));
    return rowObjects(value).flatMap((row): MarketEvent[] => {
        const symbol = `${String(row.Code ?? '')}.TW`;
        const raw = String(row.Date ?? '');
        const date = /^\d{7}$/.test(raw) ? `${Number(raw.slice(0, 3)) + 1911}-${raw.slice(3, 5)}-${raw.slice(5, 7)}` : '';
        if (!wanted.has(symbol) || !validCalendarDate(date) || !eventInUpcomingWeek({ symbol, date }, now)) return [];
        const action = typeof row.Exdividend === 'string' && row.Exdividend ? `除权息（${row.Exdividend}）` : '除权息';
        return [{ id: `twse:${symbol}:${date}`, symbol, date, title: `${String(row.Name || symbol)} ${action}`,
            kind: 'ex-dividend', certainty: 'official-schedule', source: 'TWSE 除权息预告',
            sourceUrl: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL', note: '官方预告可能变更，以交易所及发行人最新公告为准。' }];
    });
}

export function parseCnDisclosureEvents(value: unknown, symbols: string[], now: Date): MarketEvent[] {
    const wanted = new Set(symbols.map((symbol) => identifyMarketAndCode(symbol).normalizedSymbol));
    return rowObjects(value).flatMap((row): MarketEvent[] => {
        const rawSymbol = String(row.SECUCODE ?? '');
        const meta = identifyMarketAndCode(rawSymbol);
        if (meta.market !== 'cn' || !wanted.has(meta.normalizedSymbol) || String(row.IS_PUBLISH) === '1') return [];
        const date = typeof row.APPOINT_PUBLISH_DATE === 'string' ? row.APPOINT_PUBLISH_DATE.slice(0, 10) : '';
        if (!eventInUpcomingWeek({ symbol: meta.normalizedSymbol, date }, now)) return [];
        return [{ id: `em:${meta.normalizedSymbol}:${String(row.REPORT_DATE)}:${date}`, symbol: meta.normalizedSymbol, date,
            title: `${String(row.SECURITY_NAME_ABBR || meta.normalizedSymbol)} ${String(row.REPORT_TYPE_NAME || '定期报告')}预约披露`,
            kind: 'earnings', certainty: 'estimated', source: '东方财富预约披露表',
            sourceUrl: 'https://data.eastmoney.com/bbsj/yypl.html', note: '来源预约日期，尚未视为实际披露，可能调整。' }];
    });
}
