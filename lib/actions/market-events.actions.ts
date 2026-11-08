'use server';

import { connectToDatabase } from '@/database/mongoose';
import { MarketEventRecord, type IMarketEvent } from '@/database/models/market-event.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { addCalendarDays, exchangeDateForSymbol } from '@/lib/market/dates';
import { eventInUpcomingWeek, parseCnDisclosureEvents, parseTwseEvents, validateEventInput, type EventInput, type MarketEvent, type EventCalendarData } from '@/lib/market/events';
import { observeAutomaticEvents } from '@/lib/market/research-changes';

const TW_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL';
const MANUAL_LIMIT = 100;
function userEvent(row: Pick<IMarketEvent, '_id' | 'symbol' | 'title' | 'date' | 'kind' | 'sourceUrl' | 'note' | 'createdAt'>): MarketEvent {
    return { id: String(row._id), symbol: row.symbol, title: row.title, date: row.date, kind: row.kind,
        sourceUrl: row.sourceUrl, note: row.note, createdAt: row.createdAt.toISOString(), certainty: 'user', source: '用户记录（日期未由系统核验）' };
}
async function sourceJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([(async () => {
            const response = await fetch(url, { signal: controller.signal, next: { revalidate: 3600 } });
            if (!response.ok) throw new Error('来源响应失败');
            return response.json();
        })(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('来源超时')); }, 6_000); })]);
    } finally { clearTimeout(timer); }
}

export async function getWatchlistEvents(): Promise<EventCalendarData> {
    const userId = await requireUserId();
    const items = await getUserWatchlist();
    await connectToDatabase();
    const rows = await MarketEventRecord.find({ userId, cancelledAt: { $exists: false } }).sort({ date: 1, _id: 1 }).limit(MANUAL_LIMIT).lean();
    const symbols = [...new Set(items.map((item) => identifyMarketAndCode(item.symbol).normalizedSymbol))];
    const tw = symbols.filter((symbol) => identifyMarketAndCode(symbol).exchangeId === 'TWSE');
    const cn = symbols.filter((symbol) => { const meta = identifyMarketAndCode(symbol); return meta.market === 'cn' && meta.kind === 'equity' && meta.exchangeId !== 'BSE'; });
    const now = new Date();
    const data: EventCalendarData = { events: rows.map(userEvent), sources: [], fetchedAt: now.toISOString(), manualLimit: MANUAL_LIMIT };
    const observed: MarketEvent[] = [];
    await Promise.all([
        (async () => {
            if (!tw.length) return;
            try {
                const value = await sourceJson(TW_URL);
                if (!Array.isArray(value)) throw new Error('来源格式改变');
                data.events.push(...parseTwseEvents(value, tw, now));
                data.sources.push({ source: 'TWSE 除权息预告', status: 'ready', detail: `筛选 ${tw.length} 只上市自选的未来 7 个自然日；官方预告可能变更。当前来源无经验证的稳定事件标识，不能据此关联改期或撤回。` });
            } catch { data.sources.push({ source: 'TWSE 除权息预告', status: 'error', detail: '来源暂不可用，不能据此判断未来一周没有事件。' }); }
        })(),
        (async () => {
            if (!cn.length) return;
            const start = exchangeDateForSymbol(cn[0], now);
            const codes = cn.map((symbol) => `"${symbol.split('.')[0]}"`).join(',');
            const query = new URLSearchParams({ reportName: 'RPT_PUBLIC_BS_APPOIN', columns: 'SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,REPORT_DATE,REPORT_TYPE_NAME,APPOINT_PUBLISH_DATE,IS_PUBLISH',
                // Fetch beyond the display window so a real move outside this week remains observable.
                filter: `(SECURITY_CODE in (${codes}))(APPOINT_PUBLISH_DATE>='${addCalendarDays(start, -366)}')(APPOINT_PUBLISH_DATE<='${addCalendarDays(start, 366)}')`,
                pageNumber: '1', pageSize: '1000', sortColumns: 'APPOINT_PUBLISH_DATE', sortTypes: '1' });
            try {
                const value = await sourceJson(`https://datacenter-web.eastmoney.com/api/data/v1/get?${query}`) as { success?: boolean; code?: number; result?: { data?: unknown; count?: number } } | null;
                // The source's documented empty payload was also verified against a live empty window.
                const empty = value?.code === 9201 && value.result === null;
                if (!empty && (!value?.success || !Array.isArray(value.result?.data))) throw new Error('来源格式改变');
                const versions = parseCnDisclosureEvents(empty ? [] : value!.result!.data, cn, now, false);
                observed.push(...versions);
                data.events.push(...versions.filter((event) => eventInUpcomingWeek(event, now)));
                data.sources.push({ source: 'A股预约披露', status: 'ready', detail: `筛选 ${cn.length} 只沪深自选；来源预约日期，不等于实际披露。为观察移出本周的改期，同时读取前后 366 日预约。${(value?.result?.count ?? 0) > 1000 ? '结果超过 1000 条，仅观察首批，可能遗漏变化。' : ''}` });
            } catch { data.sources.push({ source: 'A股预约披露', status: 'error', detail: '来源暂不可用，不能据此判断未来一周没有披露。' }); }
        })(),
    ]);
    if (observed.length) {
        try { await observeAutomaticEvents(userId, observed, now); }
        catch { data.sources.push({ source: '事件变化留存', status: 'error', detail: '本次来源记录已展示，但版本保存失败，不能判断是否没有新增变化；请稍后刷新。' }); }
    }
    if (symbols.some((symbol) => !tw.includes(symbol) && !cn.includes(symbol))) data.sources.push({ source: '其他市场或证券类型', status: 'unsupported', detail: '尚未接入经验证的自动事件来源，可手工记录；不以新闻标题生成确定日期。' });
    data.events = [...new Map(data.events.filter((event) => event.certainty === 'user' || symbols.includes(event.symbol)).map((event) => [event.id, event])).values()].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
    data.sources.sort((a, b) => a.source.localeCompare(b.source));
    return data;
}

export async function createMarketEvent(input: EventInput): Promise<MarketEvent> {
    const userId = await requireUserId();
    const value = validateEventInput(input);
    const items = await getUserWatchlist();
    if (!items.some((item) => identifyMarketAndCode(item.symbol).normalizedSymbol === value.symbol)) throw new Error('请先将标的加入当前账户自选');
    await connectToDatabase();
    const existing = await MarketEventRecord.findOne({ userId, clientRequestId: value.clientRequestId }).lean();
    if (existing) {
        if (existing.cancelledAt || ['symbol', 'title', 'date', 'kind', 'sourceUrl', 'note'].some((key) => existing[key as keyof typeof existing] !== value[key as keyof EventInput])) throw new Error('该请求标识已使用，请重新提交');
        return userEvent(existing);
    }
    if (await MarketEventRecord.countDocuments({ userId, cancelledAt: { $exists: false } }) >= MANUAL_LIMIT) throw new Error('最多保留 100 条有效用户事件，请先撤销已完成事项');
    try { return userEvent(await MarketEventRecord.create({ userId, ...value })); }
    catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const saved = await MarketEventRecord.findOne({ userId, clientRequestId: value.clientRequestId }).lean();
        if (!saved || saved.cancelledAt || ['symbol', 'title', 'date', 'kind', 'sourceUrl', 'note'].some((key) => saved[key as keyof typeof saved] !== value[key as keyof EventInput])) throw new Error('提交冲突，请重新打开表单');
        return userEvent(saved);
    }
}

export async function cancelMarketEvent(id: string): Promise<void> {
    const userId = await requireUserId();
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new Error('记录编号无效');
    await connectToDatabase();
    const result = await MarketEventRecord.updateOne({ _id: id, userId, cancelledAt: { $exists: false } }, { $set: { cancelledAt: new Date() } });
    if (!result.matchedCount) throw new Error('未找到可撤销的用户记录');
}
