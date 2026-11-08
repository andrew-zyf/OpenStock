'use server';

import { fetchRealtimeQuotes } from "@/lib/realtime-market";
import { identifyMarketAndCode } from "@/lib/market/instrument";
import { CHINESE_STOCKS } from "@/lib/chinese-stocks";
import { normalizeName, aliasesFor, relevant, traditionalCompanyQuery } from '@/lib/news/relevance';

export type StockNewsArticle = {
    id: string;
    title: string;
    summary: string;
    source: string;
    date: string;
    url: string;
};

export type StockResearchReport = {
    id: string;
    title: string;
    orgName: string;
    date: string;
    rating?: string;
    thisYearEps?: string;
    thisYearPe?: string;
    nextYearEps?: string;
    nextYearPe?: string;
    url: string;
};

export type StockAnnouncement = {
    id: string;
    title: string;
    category: string;
    source: string;
    date: string;
    url: string;
};

export type IntelligenceStatus = 'ready' | 'empty' | 'partial' | 'error' | 'unsupported';
export type StockIntelligenceData = {
    symbol: string;
    name: string;
    news: StockNewsArticle[];
    reports: StockResearchReport[];
    announcements: StockAnnouncement[];
    status: Record<'news' | 'reports' | 'announcements', IntelligenceStatus>;
};

type Row = Record<string, unknown>;
type SourceResult<T> = { items: T[]; failed: boolean };
const REQUEST_TIMEOUT = 8000;
const MAX_ROWS = 40;

function record(value: unknown): Row {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function clean(value: unknown): string {
    return text(value).replace(/<[^>]*>/g, '').replace(/&#10;|&nbsp;|　/g, ' ').trim();
}

function rows(value: unknown): Row[] {
    if (!Array.isArray(value)) throw new Error('Invalid source list');
    return value.slice(0, MAX_ROWS).map(record);
}

async function bounded<T>(run: () => Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.resolve().then(run),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    onTimeout?.();
                    reject(new Error('Source timed out'));
                }, milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function request(url: string, revalidate: number, jsonp = false): Promise<Row> {
    const controller = new AbortController();
    return bounded(async () => {
        const res = await fetch(url, {
            headers: { Referer: 'https://so.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error('Source request failed');
        if (!jsonp) return record(await res.json());
        const body = await res.text();
        // ES2017 does not support the dotAll flag.
        const match = body.match(/^\s*jQuery\(([\s\S]*)\)\s*;?\s*$/);
        if (!match) throw new Error('Invalid JSONP');
        return record(JSON.parse(match[1]));
    }, REQUEST_TIMEOUT, () => controller.abort());
}

function validUrl(value: unknown): string {
    try {
        const url = new URL(text(value));
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function unique<T extends { id: string; url: string }>(items: T[], limit: number): T[] {
    const ids = new Set<string>();
    const urls = new Set<string>();
    return items.filter((item) => {
        const url = new URL(item.url);
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|spm$|from$)/i.test(key)) url.searchParams.delete(key);
        }
        const key = url.href;
        if (ids.has(item.id) || urls.has(key)) return false;
        ids.add(item.id);
        urls.add(key);
        return true;
    }).slice(0, limit);
}

async function fetchEastMoneyStockNews(keyword: string, aliases: string[]): Promise<SourceResult<StockNewsArticle>> {
    try {
        const param = {
            uid: '', keyword, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
            param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 20, preTag: '', postTag: '' } },
        };
        const data = await request(`https://search-api-web.eastmoney.com/search/jsonp?cb=jQuery&param=${encodeURIComponent(JSON.stringify(param))}`, 300, true);
        const items = rows(record(data.result).cmsArticleWebOld).flatMap((item): StockNewsArticle[] => {
            const title = clean(item.title);
            const summary = clean(item.content);
            const url = validUrl(item.url);
            if (!title || !url || !relevant(title, summary, aliases, 'eastmoney')) return [];
            return [{ id: `em:${text(item.code) || url}`, title, summary, source: clean(item.mediaName) || '东方财富资讯', date: text(item.date).slice(0, 16), url }];
        });
        return { items: unique(items, 8), failed: false };
    } catch {
        return { items: [], failed: true };
    }
}

function forecast(value: unknown, decimals: number, unit: string): string | undefined {
    if (value === null || value === undefined || text(value) === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(decimals)}${unit}` : undefined;
}

async function fetchAShareReports(numCode: string): Promise<SourceResult<StockResearchReport>> {
    try {
        const today = new Date();
        const end = today.toISOString().slice(0, 10);
        const begin = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const data = await request(`https://reportapi.eastmoney.com/report/list?pageSize=6&pageNo=1&code=${numCode}&qType=0&beginTime=${begin}&endTime=${end}`, 1800);
        const items = rows(data.data).flatMap((item): StockResearchReport[] => {
            const code = text(item.infoCode);
            const title = clean(item.title);
            if (!code || !title || (item.stockCode && text(item.stockCode) !== numCode)) return [];
            return [{
                id: `em-report:${code}`, title, orgName: clean(item.orgSName || item.orgName) || '未提供机构',
                date: text(item.publishDate).slice(0, 10), rating: clean(item.emRatingName) || undefined,
                thisYearEps: forecast(item.predictThisYearEps, 2, '元'), thisYearPe: forecast(item.predictThisYearPe, 1, 'x'),
                nextYearEps: forecast(item.predictNextYearEps, 2, '元'), nextYearPe: forecast(item.predictNextYearPe, 1, 'x'),
                url: `https://data.eastmoney.com/report/zw_stock.jshtml?infocode=${encodeURIComponent(code)}`,
            }];
        });
        return { items: unique(items, 6), failed: false };
    } catch {
        return { items: [], failed: true };
    }
}

async function fetchAShareAnnouncements(numCode: string): Promise<SourceResult<StockAnnouncement>> {
    try {
        const data = await request(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=6&page_index=1&ann_type=A&stock_list=${numCode}`, 1800);
        const items = rows(record(data.data).list).flatMap((item): StockAnnouncement[] => {
            const code = text(item.art_code);
            const title = clean(item.title);
            if (!code || !title) return [];
            const stocks = Array.isArray(item.codes) ? item.codes.map(record) : [];
            if (stocks.length && !stocks.some((stock) => text(stock.stock_code) === numCode)) return [];
            const columns = Array.isArray(item.columns) ? item.columns.map(record) : [];
            return [{ id: `em-ann:${code}`, title, category: clean(columns[0]?.column_name) || '公司公告', source: '东方财富 · 公告转载', date: text(item.notice_date).slice(0, 10), url: `https://data.eastmoney.com/notices/detail/${numCode}/${encodeURIComponent(code)}.html` }];
        });
        return { items: unique(items, 6), failed: false };
    } catch {
        return { items: [], failed: true };
    }
}

async function fetchCnyesTwStockIntel(keyword: string, aliases: string[]): Promise<{
    news: StockNewsArticle[]; announcements: StockAnnouncement[]; failed: boolean;
}> {
    try {
        const data = await request(`https://ess.api.cnyes.com/ess/api/v1/news/keyword?q=${encodeURIComponent(keyword)}&limit=20`, 300);
        const news: StockNewsArticle[] = [];
        const announcements: StockAnnouncement[] = [];
        for (const item of rows(record(data.data).items)) {
            const title = clean(item.title);
            const summary = clean(item.summary);
            const code = text(item.newsId);
            if (!title || !/^\d+$/.test(code) || !relevant(title, summary, aliases, 'cnyes')) continue;
            const published = Number(item.publishAt);
            const date = published > 0 && Number.isFinite(published) && !Number.isNaN(new Date(published * 1000).getTime())
                ? new Date(published * 1000).toISOString().replace('T', ' ').slice(0, 16) : '';
            const url = `https://news.cnyes.com/news/id/${code}`;
            const categories = Array.isArray(item.category) ? item.category.map((category) => clean(record(category).name)) : [];
            if (categories.some((category) => /公告|重大訊息|重大讯息/.test(category))) {
                announcements.push({ id: `cnyes:${code}`, title, category: '转载重大讯息', source: '鉅亨網 · 重大讯息转载', date: date.slice(0, 10), url });
            } else {
                news.push({ id: `cnyes:${code}`, title, summary, source: `鉅亨網 · ${categories[0] || '台股快訊'}`, date, url });
            }
        }
        return { news: unique(news, 8), announcements: unique(announcements, 6), failed: false };
    } catch {
        return { news: [], announcements: [], failed: true };
    }
}

function status(items: unknown[], failures: boolean[]): IntelligenceStatus {
    if (failures.some(Boolean)) return items.length ? 'partial' : 'error';
    return items.length ? 'ready' : 'empty';
}

export async function getStockIntelligence(rawSymbol: string): Promise<StockIntelligenceData> {
    const meta = identifyMarketAndCode(rawSymbol);
    if (meta.kind === 'unknown') {
        return { symbol: meta.normalizedSymbol, name: meta.normalizedSymbol, news: [], reports: [], announcements: [],
            status: { news: 'unsupported', reports: 'unsupported', announcements: 'unsupported' } };
    }
    const known = CHINESE_STOCKS.find((stock) => identifyMarketAndCode(stock.symbol).normalizedSymbol === meta.normalizedSymbol);
    // A failed or stalled quote lookup must not suppress otherwise independent news sources.
    const quotes = await bounded(() => fetchRealtimeQuotes([rawSymbol]), 2500).catch(() => ({}));
    const quote = (quotes as Awaited<ReturnType<typeof fetchRealtimeQuotes>>)[rawSymbol];
    const name = clean(quote?.name || known?.name || meta.normalizedSymbol).replace(/\s*[（(][\s\S]*?[）)]\s*/g, '').trim();
    const aliases = aliasesFor(meta.normalizedSymbol, name);
    const numCode = meta.normalizedSymbol.replace(/\.(SS|SZ|BJ|HK|TW|TWO)$/i, '');
    // Search simplified full names on EM; cnYES uses the quote/dictionary company name.
    const newsRequest = fetchEastMoneyStockNews(normalizeName(name), aliases);

    if (meta.market === 'cn' && meta.kind === 'equity' && meta.exchangeId !== 'BSE') {
        const [news, reports, announcements] = await Promise.all([newsRequest, fetchAShareReports(numCode), fetchAShareAnnouncements(numCode)]);
        return { symbol: meta.normalizedSymbol, name, news: news.items, reports: reports.items, announcements: announcements.items,
            status: { news: status(news.items, [news.failed]), reports: status(reports.items, [reports.failed]), announcements: status(announcements.items, [announcements.failed]) } };
    }
    if (meta.market === 'tw') {
        // Preserve source spelling: simplified-to-traditional conversion is ambiguous (致 / 緻).
        const traditionalName = quote?.name ? name : traditionalCompanyQuery(name);
        const [cnyes, em] = await Promise.all([fetchCnyesTwStockIntel(traditionalName, aliases), newsRequest]);
        const news = unique([...cnyes.news, ...em.items], 8);
        return { symbol: meta.normalizedSymbol, name, news, reports: [], announcements: cnyes.announcements,
            status: { news: status(news, [cnyes.failed, em.failed]), reports: 'unsupported', announcements: status(cnyes.announcements, [cnyes.failed]) } };
    }
    const news = await newsRequest;
    return { symbol: meta.normalizedSymbol, name, news: news.items, reports: [], announcements: [],
        status: { news: status(news.items, [news.failed]), reports: 'unsupported', announcements: 'unsupported' } };
}
