'use server';

import { optionalNumber } from '@/lib/market/contracts';
import { identifyMarketAndCode, type MarketType } from '@/lib/market/instrument';
import { canonicalNewsTargets, knownCompanyName, newsAssociation, normalizeName, traditionalCompanyQuery, type NewsTarget } from '@/lib/news/relevance';

export type ChinaMarketMacro = {
    totalTurnoverYi: number;
    totalTurnoverText: string;
    shTurnoverText: string;
    szTurnoverText: string;
    usdcnhRate?: number;
    usdcnhChangePercent?: number;
    upCount?: number;
    downCount?: number;
    flatCount?: number;
    updateTime: string;
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

export async function getChinaMarketMacro(): Promise<ChinaMarketMacro | null> {
    try {
        const [sinaRes, yahooRes, breadthRes] = await Promise.all([
            fetch('http://hq.sinajs.cn/list=s_sh000001,s_sz399001', {
                headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 60 },
            }),
            fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDCNH=X?interval=1d&range=1d', {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 300 },
            }).catch(() => null),
            fetch('http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f12,f14,f104,f105,f106', {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 30 },
            }).catch(() => null),
        ]);

        if (!sinaRes.ok) return null;
        const buffer = await sinaRes.arrayBuffer();
        const text = new TextDecoder('gbk').decode(buffer);

        // Parse Shanghai & Shenzhen turnover
        const shMatch = text.match(/hq_str_s_sh000001="([^"]+)"/);
        const szMatch = text.match(/hq_str_s_sz399001="([^"]+)"/);

        let shWan = 0;
        let szWan = 0;
        if (shMatch) {
            const parts = shMatch[1].split(',');
            shWan = Number(parts[5]) || 0;
        }
        if (szMatch) {
            const parts = szMatch[1].split(',');
            szWan = Number(parts[5]) || 0;
        }

        const totalWan = shWan + szWan;
        const totalYi = Math.round(totalWan / 10000);
        const shYi = Math.round(shWan / 10000);
        const szYi = Math.round(szWan / 10000);

        let totalTurnoverText = '';
        if (totalYi >= 10000) {
            totalTurnoverText = `${(totalYi / 10000).toFixed(2)} 万亿元 (${totalYi.toLocaleString()} 亿)`;
        } else {
            totalTurnoverText = `${totalYi.toLocaleString()} 亿元`;
        }

        // Parse USD/CNH
        let usdcnhRate: number | undefined;
        let usdcnhChangePercent: number | undefined;
        if (yahooRes && yahooRes.ok) {
            const yahooJson = await yahooRes.json();
            const meta = yahooJson?.chart?.result?.[0]?.meta;
            if (meta?.regularMarketPrice) {
                usdcnhRate = meta.regularMarketPrice;
                usdcnhChangePercent = meta.regularMarketChangePercent;
            }
        }

        // Parse Market Breadth (上涨 / 下跌 / 平盘家数)
        let upCount: number | undefined;
        let downCount: number | undefined;
        let flatCount: number | undefined;
        if (breadthRes && breadthRes.ok) {
            const bJson = await breadthRes.json();
            const diff = bJson?.data?.diff;
            if (Array.isArray(diff) && diff.length > 0) {
                let u = 0;
                let d = 0;
                let f = 0;
                for (const item of diff) {
                    u += Number(item.f104) || 0;
                    d += Number(item.f105) || 0;
                    f += Number(item.f106) || 0;
                }
                if (u + d + f > 0) {
                    upCount = u;
                    downCount = d;
                    flatCount = f;
                }
            }
        }

        const now = new Date();
        const updateTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        return {
            totalTurnoverYi: totalYi,
            totalTurnoverText,
            shTurnoverText: `${shYi.toLocaleString()} 亿`,
            szTurnoverText: `${szYi.toLocaleString()} 亿`,
            usdcnhRate,
            usdcnhChangePercent,
            upCount,
            downCount,
            flatCount,
            updateTime,
        };
    } catch (e) {
        console.error('China market macro error', e);
        return null;
    }
}

export type ChinaSectorRankings = {
    topGainers: SectorFlowItem[];
    topInflows: SectorFlowItem[];
    errors?: { topGainers?: string; topInflows?: string };
    fetchedAt: string;
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
        return parseSectorList(json.data.diff);
    };
    const [gainers, inflows] = await Promise.allSettled([load('f3'), load('f62')]);
    return {
        topGainers: gainers.status === 'fulfilled' ? gainers.value : [],
        topInflows: inflows.status === 'fulfilled' ? inflows.value : [],
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

