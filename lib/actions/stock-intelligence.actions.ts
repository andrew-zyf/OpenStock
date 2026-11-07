'use server';

import { identifyMarketAndCode, fetchRealtimeQuotes } from "@/lib/realtime-market";

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
    date: string;
    url: string;
};

export type StockIntelligenceData = {
    symbol: string;
    name: string;
    news: StockNewsArticle[];
    reports: StockResearchReport[];
    announcements: StockAnnouncement[];
};

async function fetchEastMoneyStockNews(keyword: string): Promise<StockNewsArticle[]> {
    try {
        const paramObj = {
            uid: '',
            keyword,
            type: ['cmsArticleWebOld'],
            client: 'web',
            clientType: 'web',
            clientVersion: 'curr',
            param: {
                cmsArticleWebOld: {
                    searchScope: 'default',
                    sort: 'default',
                    pageIndex: 1,
                    pageSize: 8,
                    preTag: '',
                    postTag: '',
                },
            },
        };
        const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=jQuery&param=${encodeURIComponent(JSON.stringify(paramObj))}`;
        const res = await fetch(url, {
            headers: { Referer: 'https://so.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 300 },
        });
        if (!res.ok) return [];
        const text = await res.text();
        const jsonMatch = text.match(/^jQuery\((.*)\)$/s);
        if (!jsonMatch || !jsonMatch[1]) return [];
        const data = JSON.parse(jsonMatch[1]);
        const list = data?.result?.cmsArticleWebOld || [];

        return list.map((item: Record<string, string>) => ({
            id: String(item.code || Math.random()),
            title: String(item.title || '').replace(/<\/?em>/g, '').trim(),
            summary: String(item.content || '').replace(/<\/?em>/g, '').replace(/　/g, ' ').trim(),
            source: String(item.mediaName || '财经资讯'),
            date: String(item.date || '').slice(0, 16),
            url: String(item.url || ''),
        }));
    } catch {
        return [];
    }
}

async function fetchAShareReports(numCode: string): Promise<StockResearchReport[]> {
    try {
        const url = `https://reportapi.eastmoney.com/report/list?pageSize=6&pageNo=1&code=${numCode}&qType=0&beginTime=2025-01-01&endTime=2026-12-31`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 1800 },
        });
        if (!res.ok) return [];
        const j = await res.json();
        const list = j?.data || [];

        return list.map((item: Record<string, string>) => ({
            id: String(item.infoCode || Math.random()),
            title: String(item.title || ''),
            orgName: String(item.orgSName || item.orgName || '券商研究所'),
            date: String(item.publishDate || '').slice(0, 10),
            rating: item.emRatingName || '买入/推荐',
            thisYearEps: item.predictThisYearEps ? `${Number(item.predictThisYearEps).toFixed(2)}元` : undefined,
            thisYearPe: item.predictThisYearPe ? `${Number(item.predictThisYearPe).toFixed(1)}x` : undefined,
            nextYearEps: item.predictNextYearEps ? `${Number(item.predictNextYearEps).toFixed(2)}元` : undefined,
            nextYearPe: item.predictNextYearPe ? `${Number(item.predictNextYearPe).toFixed(1)}x` : undefined,
            url: item.infoCode ? `https://data.eastmoney.com/report/zw_stock.jshtml?infocode=${item.infoCode}` : '',
        }));
    } catch {
        return [];
    }
}

async function fetchAShareAnnouncements(numCode: string): Promise<StockAnnouncement[]> {
    try {
        const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=6&page_index=1&ann_type=A&stock_list=${numCode}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 1800 },
        });
        if (!res.ok) return [];
        const j = await res.json();
        const list = j?.data?.list || [];

        return list.map((item: {
            art_code?: string;
            title?: string;
            notice_date?: string;
            columns?: { column_name?: string }[];
        }) => ({
            id: String(item.art_code || Math.random()),
            title: String(item.title || ''),
            category: item.columns?.[0]?.column_name || '公司公告',
            date: String(item.notice_date || '').slice(0, 10),
            url: item.art_code ? `https://data.eastmoney.com/notices/detail/${numCode}/${item.art_code}.html` : '',
        }));
    } catch {
        return [];
    }
}

async function fetchCnyesTwStockIntel(keyword: string): Promise<{
    news: StockNewsArticle[];
    announcements: StockAnnouncement[];
}> {
    try {
        const url = `https://ess.api.cnyes.com/ess/api/v1/news/keyword?q=${encodeURIComponent(keyword)}&limit=10`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 300 },
        });
        if (!res.ok) return { news: [], announcements: [] };
        const j = await res.json();
        const items: {
            newsId?: number;
            title?: string;
            summary?: string | null;
            publishAt?: number;
            category?: { name?: string }[];
        }[] = j?.data?.items || [];

        const news: StockNewsArticle[] = [];
        const announcements: StockAnnouncement[] = [];

        for (const item of items) {
            const rawTitle = String(item.title || '').replace(/<\/?mark>/g, '').trim();
            if (!rawTitle) continue;
            const summary = String(item.summary || '')
                .replace(/<\/?mark>/g, '')
                .replace(/&#10;/g, ' ')
                .trim();
            const dt = item.publishAt
                ? new Date(item.publishAt * 1000).toISOString().replace('T', ' ').slice(0, 16)
                : '';
            const link = item.newsId ? `https://news.cnyes.com/news/id/${item.newsId}` : '';

            if (rawTitle.includes('公告') || rawTitle.includes('董事會')) {
                announcements.push({
                    id: String(item.newsId || Math.random()),
                    title: rawTitle,
                    category: '台股重大訊息公告',
                    date: dt.slice(0, 10),
                    url: link,
                });
            } else {
                news.push({
                    id: String(item.newsId || Math.random()),
                    title: rawTitle,
                    summary,
                    source: `鉅亨網 · ${item.category?.[0]?.name || '台股快訊'}`,
                    date: dt,
                    url: link,
                });
            }
        }

        return { news: news.slice(0, 8), announcements: announcements.slice(0, 6) };
    } catch {
        return { news: [], announcements: [] };
    }
}

export async function getStockIntelligence(rawSymbol: string): Promise<StockIntelligenceData> {
    const meta = identifyMarketAndCode(rawSymbol);
    const quotes = await fetchRealtimeQuotes([rawSymbol]);
    const quote = quotes[rawSymbol];
    const cleanName = (quote?.name || rawSymbol).replace(/\s*\(.*?\)\s*/g, '').trim();
    const numCode = meta.normalizedSymbol.replace(/\.(SS|SZ|HK|TW|TWO)$/i, '');

    if (meta.market === 'cn') {
        const [news, reports, announcements] = await Promise.all([
            fetchEastMoneyStockNews(cleanName || numCode),
            fetchAShareReports(numCode),
            fetchAShareAnnouncements(numCode),
        ]);
        return {
            symbol: meta.normalizedSymbol,
            name: cleanName,
            news,
            reports,
            announcements,
        };
    }

    if (meta.market === 'tw') {
        const [cnyesIntel, emNews] = await Promise.all([
            fetchCnyesTwStockIntel(cleanName || numCode),
            fetchEastMoneyStockNews(cleanName || numCode),
        ]);
        return {
            symbol: meta.normalizedSymbol,
            name: cleanName,
            news: [...cnyesIntel.news, ...emNews].slice(0, 8),
            reports: [],
            announcements: cnyesIntel.announcements,
        };
    }

    const news = await fetchEastMoneyStockNews(cleanName || numCode);
    return {
        symbol: meta.normalizedSymbol,
        name: cleanName,
        news,
        reports: [],
        announcements: [],
    };
}
