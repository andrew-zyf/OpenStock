'use server';

import { optionalNumber, type SourceMetadata } from '@/lib/market/contracts';
import { identifyMarketAndCode, type MarketType } from '@/lib/market/instrument';
import { canonicalNewsTargets, knownCompanyName, newsAssociation, normalizeName, traditionalCompanyQuery, type NewsTarget } from '@/lib/news/relevance';

export type MarketResourceMetadata = SourceMetadata & { coverage: string; error?: string };

export type ChinaMarketMacro = {
    totalTurnoverYi?: number;
    totalTurnoverText: string;
    shTurnoverText: string;
    szTurnoverText: string;
    usdcnhRate?: number;
    usdcnhChangePercent?: number;
    upCount?: number;
    downCount?: number;
    flatCount?: number;
    sources: { turnover: MarketResourceMetadata; breadth: MarketResourceMetadata; fx: MarketResourceMetadata };
};

export type SectorFlowItem = {
    code: string;
    name: string;
    changePercent?: number;
    mainNetInflow?: number;    // 主力净流入 (元)，缺失与零分开
    mainNetRatio?: number;     // 主力净占比 (%)
    leaderName: string;
    leaderSymbol: string;      // 来源缺少领涨股时为空
    leaderChangePercent?: number;
};

export type ChineseNewsItem = {
    id: number;
    time: string;
    date: string;
    title: string;
    content: string;
    source?: string;
};

export async function getChinaMarketMacro(): Promise<ChinaMarketMacro> {
    const turnover = async () => {
        const res = await fetch('http://hq.sinajs.cn/list=s_sh000001,s_sz399001', {
            headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 60 }, signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error('成交额来源响应失败');
        const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
        const amount = (code: string) => {
            const raw = text.match(new RegExp(`hq_str_s_${code}="([^"]*)"`))?.[1].split(',')[5];
            const value = optionalNumber(raw);
            return value != null && value >= 0 ? value : undefined;
        };
        const sh = amount('sh000001');
        const sz = amount('sz399001');
        const totalTurnoverYi = sh != null && sz != null ? (sh + sz) / 10000 : undefined;
        const format = (value?: number) => value == null ? '—' : `${Math.round(value / 10000).toLocaleString('zh-CN')} 亿`;
        return {
            totalTurnoverYi,
            totalTurnoverText: totalTurnoverYi == null ? '—' : totalTurnoverYi >= 10000
                ? `${(totalTurnoverYi / 10000).toFixed(2)} 万亿元 (${Math.round(totalTurnoverYi).toLocaleString('zh-CN')} 亿)`
                : `${Math.round(totalTurnoverYi).toLocaleString('zh-CN')} 亿元`,
            shTurnoverText: format(sh), szTurnoverText: format(sz),
            metadata: { source: '新浪指数简表', fetchedAt: new Date().toISOString(),
                coverage: `A股（沪深）指数接口成交额字段；沪市${sh == null ? '缺失' : '已返回'}、深市${sz == null ? '缺失' : '已返回'}；不含北交所` },
        };
    };
    const fx = async () => {
        const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDCNH=X?interval=1d&range=1d', {
            headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 300 }, signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error('汇率来源响应失败');
        const meta = (await res.json())?.chart?.result?.[0]?.meta;
        if (!meta || typeof meta !== 'object') throw new Error('汇率来源数据格式不可用');
        const seconds = optionalNumber(meta.regularMarketTime);
        const time = seconds != null && seconds > 0 ? new Date(seconds * 1000) : undefined;
        return {
            usdcnhRate: optionalNumber(meta.regularMarketPrice),
            usdcnhChangePercent: optionalNumber(meta.regularMarketChangePercent),
            metadata: { source: 'Yahoo Finance', fetchedAt: new Date().toISOString(),
                asOf: time && Number.isFinite(time.getTime()) ? time.toISOString() : undefined,
                coverage: 'USD/CNH 离岸人民币报价；不代表北向资金或港股流动性' },
        };
    };
    const breadth = async () => {
        const res = await fetch('http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f12,f14,f104,f105,f106', {
            headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 30 }, signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error('涨跌分布来源响应失败');
        const diff = (await res.json())?.data?.diff;
        if (!Array.isArray(diff)) throw new Error('涨跌分布来源数据格式不可用');
        const rows = ['000001', '399001'].map((code) => diff.find((item) => item && item.f12 === code));
        const count = (value: unknown) => {
            const number = optionalNumber(value);
            return number != null && Number.isInteger(number) && number >= 0 ? number : undefined;
        };
        const sum = (field: string) => {
            const values = rows.map((item) => count(item?.[field]));
            return values.every((value) => value != null) ? values.reduce<number>((total, value) => total + value!, 0) : undefined;
        };
        return {
            upCount: sum('f104'), downCount: sum('f105'), flatCount: sum('f106'),
            metadata: { source: '东方财富指数涨跌家数', fetchedAt: new Date().toISOString(),
                coverage: `A股（沪深）指数接口统计样本；完整字段 ${rows.filter((item) => ['f104', 'f105', 'f106'].every((field) => count(item?.[field]) != null)).length}/2 个市场；不含北交所，不代表全A股` },
        };
    };
    const [turnoverResult, breadthResult, fxResult] = await Promise.allSettled([turnover(), breadth(), fx()]);
    const missing = (source: string, coverage: string): MarketResourceMetadata => ({ source, coverage, fetchedAt: new Date().toISOString(), error: '来源请求失败' });
    const amounts = turnoverResult.status === 'fulfilled' ? turnoverResult.value : undefined;
    const counts = breadthResult.status === 'fulfilled' ? breadthResult.value : undefined;
    const currency = fxResult.status === 'fulfilled' ? fxResult.value : undefined;
    return {
        totalTurnoverYi: amounts?.totalTurnoverYi,
        totalTurnoverText: amounts?.totalTurnoverText ?? '—',
        shTurnoverText: amounts?.shTurnoverText ?? '—', szTurnoverText: amounts?.szTurnoverText ?? '—',
        upCount: counts?.upCount, downCount: counts?.downCount, flatCount: counts?.flatCount,
        usdcnhRate: currency?.usdcnhRate, usdcnhChangePercent: currency?.usdcnhChangePercent,
        sources: {
            turnover: turnoverResult.status === 'fulfilled' ? turnoverResult.value.metadata : missing('新浪指数简表', 'A股（沪深）成交额不可用；不含北交所'),
            breadth: breadthResult.status === 'fulfilled' ? breadthResult.value.metadata : missing('东方财富指数涨跌家数', 'A股（沪深）指数统计样本不可用；不含北交所'),
            fx: fxResult.status === 'fulfilled' ? fxResult.value.metadata : missing('Yahoo Finance', 'USD/CNH 报价不可用'),
        },
    };
}

export type ChinaSectorRankings = {
    topGainers: SectorFlowItem[];
    topInflows: SectorFlowItem[];
    errors?: { topGainers?: string; topInflows?: string };
    fetchedAt: string;
    topGainersMetadata?: MarketResourceMetadata;
    topInflowsMetadata?: MarketResourceMetadata;
};

export async function getChinaSectorRankings(): Promise<ChinaSectorRankings> {
    const parseSectorList = (diff: Record<string, unknown>[]): SectorFlowItem[] => {
        if (!Array.isArray(diff)) return [];
        const seenNames = new Set<string>();
        const out: SectorFlowItem[] = [];
        for (const item of diff) {
            const rawName = String(item.f14 || '').replace(/[ⅡⅢ]$/, '').trim();
            if (!rawName || seenNames.has(rawName)) continue;
            seenNames.add(rawName);

            const leaderCode = String(item.f140 || '');
            const leaderMkt = Number(item.f141);
            const suffix = leaderMkt === 1 ? '.SS' : leaderMkt === 0 ? '.SZ' : undefined;
            const leaderSymbol = /^\d{6}$/.test(leaderCode) && suffix ? `${leaderCode}${suffix}` : '';

            out.push({
                code: String(item.f12 || ''),
                name: rawName,
                changePercent: optionalNumber(item.f3),
                mainNetInflow: optionalNumber(item.f62),
                mainNetRatio: optionalNumber(item.f184),
                leaderName: String(item.f128 || '—'),
                leaderSymbol,
                leaderChangePercent: optionalNumber(item.f136),
            });
            if (out.length >= 6) break;
        }
        return out;
    };

    const load = async (field: 'f3' | 'f62') => {
        const res = await fetch(
            `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=15&po=1&np=1&fltt=2&invt=2&fid=${field}&fs=m:90+t:2+f:!50&fields=f12,f14,f2,f3,f62,f184,f128,f140,f141,f136`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) throw new Error(`板块来源响应 ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json?.data?.diff)) throw new Error('板块来源数据格式不可用');
        const items = parseSectorList(json.data.diff);
        return { items, metadata: { source: '东方财富行业板块排行', fetchedAt: new Date().toISOString(),
            coverage: `A股行业板块来源排行前15条，去重后展示 ${items.length} 个；${field === 'f3' ? '按来源板块涨跌幅降序' : '按来源主力净流入分类降序；主力为来源订单规模分类，不等于机构身份'}` } };
    };
    const [gainers, inflows] = await Promise.allSettled([load('f3'), load('f62')]);
    return {
        topGainers: gainers.status === 'fulfilled' ? gainers.value.items : [],
        topInflows: inflows.status === 'fulfilled' ? inflows.value.items : [],
        topGainersMetadata: gainers.status === 'fulfilled' ? gainers.value.metadata : { source: '东方财富行业板块排行', fetchedAt: new Date().toISOString(), coverage: 'A股行业板块涨跌幅排行样本不可用', error: '来源请求失败' },
        topInflowsMetadata: inflows.status === 'fulfilled' ? inflows.value.metadata : { source: '东方财富行业板块排行', fetchedAt: new Date().toISOString(), coverage: 'A股行业板块资金分类排行样本不可用', error: '来源请求失败' },
        errors: {
            topGainers: gainers.status === 'rejected' ? '领涨板块更新失败' : undefined,
            topInflows: inflows.status === 'rejected' ? '资金板块更新失败' : undefined,
        },
        fetchedAt: new Date().toISOString(),
    };
}

export async function getChineseLiveNews(): Promise<ChineseNewsItem[]> {
    try {
        const res = await fetch('https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&type=0&page=1&page_size=30', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 60 },
        });
        if (!res.ok) return [];

        const json = await res.json();
        const list = json?.result?.data?.feed?.list ?? [];

        return list.map((item: { id: number; create_time: string; rich_text: string }) => {
            const raw = (item.rich_text || '').trim();
            // Extract title if starts with 【...】
            const titleMatch = raw.match(/^【(.*?)】/);
            let title = '';
            let content = raw;
            if (titleMatch) {
                title = titleMatch[1];
                content = raw.replace(/^【.*?】/, '').trim();
            }

            // Extract source e.g. （新华社）or (央视新闻)
            const sourceMatch = content.match(/[（(]([^）)]+)[）)]\s*$/);
            let source = '';
            if (sourceMatch) {
                source = sourceMatch[1];
            }

            const dtParts = (item.create_time || '').split(' ');
            const date = dtParts[0] || '';
            const time = dtParts[1] ? dtParts[1].slice(0, 5) : '';

            return {
                id: item.id,
                time,
                date,
                title: title || (content.length > 30 ? content.slice(0, 30) + '...' : content),
                content,
                source,
            };
        });
    } catch (e) {
        console.error('Chinese live news error', e);
        return [];
    }
}

type NewsRow = Record<string, unknown>;
type NewsCandidate = { article: MarketNewsArticle; market: MarketType; summaryReliable: boolean; relatedNames: string[] };
type NewsSource = Omit<NewsSourceStatus, 'status'> & { url: string; market: MarketType; cnyes?: boolean; jsonp?: boolean };
type NewsSourceResult = { candidates: NewsCandidate[]; source: NewsSourceStatus };
const NEWS_CONCURRENCY = 4;
const MAX_TARGETED_STOCKS = 12;
const NEWS_TIMEOUT = 6000;
const NEWS_CATEGORIES: Record<MarketType, string> = { cn: 'A股', hk: '港股', tw: '台股', us: '美股' };

function newsRecord(value: unknown): NewsRow {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as NewsRow : {};
}

function newsText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/<[^>]*>/g, '').replace(/&#10;|&nbsp;/g, ' ').trim() : '';
}

function newsUrl(value: unknown): string {
    try {
        const url = new URL(newsText(value));
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}

function newsTime(value: unknown): number {
    const raw = newsText(value);
    if (!raw) return 0;
    const numeric = Number(raw);
    const timestamp = Number.isFinite(numeric) ? (numeric > 1e12 ? numeric / 1000 : numeric)
        : Date.parse(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(raw) ? `${raw.replace(' ', 'T')}${raw.length === 10 ? 'T00:00:00' : ''}+08:00` : raw) / 1000;
    return timestamp > 0 && Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp * 1000).getTime()) ? timestamp : 0;
}

function stableNewsId(key: string): number {
    let hash = 2166136261;
    for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
}

function marketNewsSources(): NewsSource[] {
    return (['cn', 'hk', 'tw', 'us'] as const).map((market) => ({
        id: `feed:${market}`, label: market === 'tw' ? '鉅亨網台股' : `新浪${NEWS_CATEGORIES[market]}`,
        scope: 'market', market, cnyes: market === 'tw',
        url: market === 'tw' ? 'https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=15'
            : `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${{ cn: 2517, hk: 2518, us: 2516 }[market]}&k=&num=15&page=1`,
    }));
}

function targetedNewsSources(target: NewsTarget): NewsSource[] {
    const identity = identifyMarketAndCode(target.symbol);
    const company = target.company || knownCompanyName(target.symbol);
    const name = company?.replace(/\s*[（(][\s\S]*?[）)]\s*/g, '').trim() || identity.normalizedSymbol;
    const param = { uid: '', keyword: normalizeName(name), type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
        param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 20, preTag: '', postTag: '' } } };
    const sources: NewsSource[] = [{ id: `em:${target.symbol}`, label: '东方财富资讯搜索', scope: 'targeted', symbol: target.symbol,
        market: identity.market, jsonp: true, url: `https://search-api-web.eastmoney.com/search/jsonp?cb=jQuery&param=${encodeURIComponent(JSON.stringify(param))}` }];
    if (identity.market === 'tw') {
        // Use the saved/source spelling. Never turn 致茂 into 緻茂 while constructing a query.
        const traditional = traditionalCompanyQuery(name);
        sources.push({ id: `cnyes:${target.symbol}`, label: '鉅亨網资讯搜索', scope: 'targeted', symbol: target.symbol,
            market: 'tw', cnyes: true, url: `https://ess.api.cnyes.com/ess/api/v1/news/keyword?q=${encodeURIComponent(traditional)}&limit=20` });
    }
    return sources;
}

function parseNewsRows(data: NewsRow, source: NewsSource): NewsCandidate[] {
    const list = source.jsonp ? newsRecord(data.result).cmsArticleWebOld
        : source.cnyes ? source.scope === 'targeted' ? newsRecord(data.data).items : newsRecord(data.items).data
            : newsRecord(data.result).data;
    if (!Array.isArray(list)) throw new Error('资讯来源数据格式不可用');
    return list.slice(0, 40).flatMap((value): NewsCandidate[] => {
        const item = newsRecord(value);
        const headline = newsText(item.title);
        const code = newsText(source.cnyes ? item.newsId : source.jsonp ? item.code : item.oid);
        const url = newsUrl(item.url) || (source.cnyes && /^\d+$/.test(code) ? `https://news.cnyes.com/news/id/${code}` : '');
        if (!headline || !url) return [];
        const datetime = newsTime(source.cnyes ? item.publishAt : source.jsonp ? item.date : item.ctime);
        const marketRows = Array.isArray(item.market) ? item.market.map(newsRecord) : [];
        const relatedSymbols = marketRows.flatMap((stock) => {
            const raw = newsText(stock.symbol || stock.code);
            const exchange = newsText(stock.exchange).toUpperCase();
            const explicit = /^(TWSE|TPEX):|\.(TW|TWO)$/i.test(raw) ? raw
                : /^\d{4,6}$/.test(raw) && ['TWSE', 'TPEX'].includes(exchange) ? `${exchange}:${raw}` : '';
            return explicit ? [identifyMarketAndCode(explicit).normalizedSymbol] : [];
        });
        const article: MarketNewsArticle = {
            id: stableNewsId(`${source.cnyes ? 'cnyes' : source.jsonp ? 'em' : 'sina'}:${code || url}`), headline,
            summary: newsText(item.summary || item.intro || item.content) || headline,
            source: newsText(item.media_name || item.mediaName) || (source.cnyes ? '鉅亨網' : source.jsonp ? '东方财富资讯' : source.label),
            url, datetime, publishedAt: datetime ? new Date(datetime * 1000).toISOString() : undefined,
            category: NEWS_CATEGORIES[source.market], related: NEWS_CATEGORIES[source.market], relatedSymbols,
        };
        return [{ article, market: source.market, summaryReliable: !source.jsonp, relatedNames: marketRows.map((stock) => newsText(stock.name)).filter(Boolean) }];
    });
}

async function fetchNewsSource(source: NewsSource): Promise<NewsSourceResult> {
    const { id, label, scope, symbol } = source;
    const status = { id, label, scope, symbol };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const candidates = await Promise.race([
            (async () => {
                const response = await fetch(source.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0', Referer: source.jsonp ? 'https://so.eastmoney.com/' : 'https://finance.sina.com.cn/' },
                    next: { revalidate: source.scope === 'targeted' ? 300 : 120 }, signal: controller.signal,
                });
                if (!response.ok) throw new Error('资讯来源响应失败');
                let data: unknown;
                if (source.jsonp) {
                    const body = await response.text();
                    const match = body.match(/^\s*jQuery\(([\s\S]*)\)\s*;?\s*$/);
                    if (!match) throw new Error('资讯来源格式错误');
                    data = JSON.parse(match[1]);
                } else data = await response.json();
                return parseNewsRows(newsRecord(data), source);
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('资讯来源超时')); }, NEWS_TIMEOUT); }),
        ]);
        return { candidates, source: { ...status, status: candidates.length ? 'ready' : 'empty' } };
    } catch {
        return { candidates: [], source: { ...status, status: 'error' } };
    } finally { clearTimeout(timer); }
}

async function loadNewsSources(sources: NewsSource[]): Promise<NewsSourceResult[]> {
    const results: NewsSourceResult[] = new Array(sources.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(NEWS_CONCURRENCY, sources.length) }, async () => {
        while (cursor < sources.length) {
            const index = cursor++;
            results[index] = await fetchNewsSource(sources[index]);
        }
    }));
    return results;
}

function dedupeNews(articles: MarketNewsArticle[]): MarketNewsArticle[] {
    const seen = new Map<string, MarketNewsArticle>();
    const output: MarketNewsArticle[] = [];
    for (const article of [...articles].sort((a, b) => b.datetime - a.datetime || a.url.localeCompare(b.url))) {
        const url = new URL(article.url);
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) if (/^(utm_|spm$|from$)/i.test(key)) url.searchParams.delete(key);
        url.searchParams.sort();
        const keys = [`url:${url.href}`, `title:${normalizeName(article.headline).replace(/\s+/g, '')}`];
        const previous = keys.map((key) => seen.get(key)).find(Boolean);
        if (previous) {
            previous.relatedSymbols = [...new Set([...(previous.relatedSymbols || []), ...(article.relatedSymbols || [])])];
            const associations = [...(previous.associations || []), ...(article.associations || [])];
            previous.associations = associations.filter((item, index) => associations.findIndex((other) => other.symbol === item.symbol) === index);
            if (previous.associations.length) previous.related = previous.associations.map((item) => item.symbol).join(', ');
            for (const key of keys) seen.set(key, previous);
            continue;
        }
        output.push(article);
        for (const key of keys) seen.set(key, article);
    }
    return output;
}

function associateNews(candidates: NewsCandidate[], targets: NewsTarget[], onlyRelated: boolean): MarketNewsArticle[] {
    return dedupeNews(candidates.flatMap(({ article, market, summaryReliable, relatedNames }) => {
        const associations = targets.flatMap((target) => {
            const match = newsAssociation(article, target, { market, summary: summaryReliable, relatedNames });
            return match ? [match] : [];
        });
        if (onlyRelated && !associations.length) return [];
        return [{ ...article, associations, relatedSymbols: onlyRelated ? associations.map((match) => match.symbol)
            : [...new Set([...(article.relatedSymbols || []), ...associations.map((match) => match.symbol)])],
            related: associations.map((match) => match.symbol).join(', ') || article.related }];
    }));
}

/** Broad market feed. Supplying symbols adds verified associations without filtering the feed. */
export async function getMultiMarketNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
    const results = await loadNewsSources(marketNewsSources());
    return associateNews(results.flatMap((result) => result.candidates), canonicalNewsTargets((symbols || []).map((symbol) => ({ symbol }))), false);
}

export type WatchlistNewsResult = {
    articles: MarketNewsArticle[];
    status: 'ready' | 'empty' | 'partial' | 'error';
    sources: NewsSourceStatus[];
    coverage: WatchlistNewsCoverage;
};

/** Only verified watchlist matches; targeted searches are capped separately from feed screening. */
export async function getWatchlistNews(items: NewsTarget[]): Promise<WatchlistNewsResult> {
    const targets = canonicalNewsTargets(items);
    const selected = targets.filter((target) => identifyMarketAndCode(target.symbol).kind !== 'unknown').slice(0, MAX_TARGETED_STOCKS);
    const targetedSymbols = new Set(selected.map((target) => target.symbol));
    const coverage = { requested: targets.length, targeted: selected.length, feedOnlySymbols: targets.filter((target) => !targetedSymbols.has(target.symbol)).map((target) => target.symbol) };
    if (!targets.length) return { articles: [], status: 'empty', sources: [], coverage };
    const results = await loadNewsSources([...marketNewsSources(), ...selected.flatMap(targetedNewsSources)]);
    const articles = associateNews(results.flatMap((result) => result.candidates), targets, true);
    const sources = results.map((result) => result.source);
    const failed = sources.some((source) => source.status === 'error');
    return { articles, status: failed ? sources.every((source) => source.status === 'error') ? 'error' : 'partial' : articles.length ? 'ready' : 'empty', sources, coverage };
}

