import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMultiMarketNews, getWatchlistNews } from '@/lib/actions/china-market.actions';
import { articleMarkets, canonicalNewsTargets, newsAssociation } from '@/lib/news/relevance';
import NewsList, { selectNewsView } from '@/components/watchlist/NewsList';

type Fixtures = { cn?: unknown[]; hk?: unknown[]; tw?: unknown[]; us?: unknown[]; em?: unknown[]; cnyes?: unknown[]; fail?: string[]; malformed?: string[] };
function mockSources(fixture: Fixtures = {}) {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (fixture.fail?.some((part) => url.href.includes(part))) throw new Error('offline');
        if (fixture.malformed?.some((part) => url.href.includes(part))) return Response.json({ error: 'maintenance' });
        if (url.hostname === 'search-api-web.eastmoney.com') return new Response(`jQuery(${JSON.stringify({ result: { cmsArticleWebOld: fixture.em || [] } })});`);
        if (url.hostname === 'ess.api.cnyes.com') return Response.json({ data: { items: fixture.cnyes || [] } });
        if (url.hostname === 'api.cnyes.com') return Response.json({ items: { data: fixture.tw || [] } });
        const market = ({ '2517': 'cn', '2518': 'hk', '2516': 'us' } as const)[url.searchParams.get('lid') as '2517'];
        if (market) return Response.json({ result: { data: fixture[market] || [] } });
        throw new Error(`Unexpected source ${url.hostname}`);
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
const sina = (title: string, id: number, ctime?: unknown) => ({ title, oid: id, ctime, url: `https://example.com/${id}`, media_name: '原始来源' });
const article = (fields: Partial<MarketNewsArticle> = {}): MarketNewsArticle => ({ id: 1, headline: '台積電營收上升', summary: '', source: '来源', url: 'https://example.com/news', datetime: 0,
    category: '台股', related: '2330.TW', relatedSymbols: ['2330.TW'], associations: [{ symbol: '2330.TW', reason: 'company-name', matchedText: '台积电' }], ...fields });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('watchlist-only news sources', () => {
    it('keeps the public undefined-symbol API broad and returns an explicit empty watchlist without fetching', async () => {
        const fetcher = mockSources({ cn: [sina('大盘普涨', 1)], hk: [sina('香港市场动态', 2)], tw: [{ newsId: 3, title: '台股市场动态' }], us: [sina('Global markets', 4)] });
        const broad = await getMultiMarketNews(undefined);
        expect(broad).toHaveLength(4);
        fetcher.mockClear();
        expect(await getWatchlistNews([])).toEqual({ articles: [], status: 'empty', sources: [], coverage: { requested: 0, targeted: 0, feedOnlySymbols: [] } });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('canonicalizes aliases and matches full company aliases without numeric or substring false positives', async () => {
        const fetcher = mockSources({
            hk: [sina('騰訊推出新服務', 1, 1800000001), sina('香港成交额达700亿元', 2), sina('无关报价1700元', 3)],
            tw: [{ newsId: 4, title: '臺積電新廠量產', publishAt: 1800000004 }, { newsId: 5, title: '台股成交2330億元' }],
            us: [sina('TSMC raises guidance', 6, 1800000006), sina('NOTSMCOTHER unrelated story', 7)],
            em: [{ title: '其他公司扩产', content: '搜索词：台积电', url: 'https://example.com/echo' }],
        });
        const result = await getWatchlistNews([{ symbol: 'TWSE:2330' }, { symbol: '2330.TW' }, { symbol: 'HKEX:700' }, { symbol: '0700.HK' }]);
        expect(result.coverage).toEqual({ requested: 2, targeted: 2, feedOnlySymbols: [] });
        expect(result.articles.map((item) => item.headline)).toEqual(['TSMC raises guidance', '臺積電新廠量產', '騰訊推出新服務']);
        expect(result.articles[0].relatedSymbols).toEqual(['2330.TW']);
        expect(result.articles[0].associations?.[0].reason).toBe('company-name');
        expect(result.articles[2].relatedSymbols).toEqual([canonicalNewsTargets([{ symbol: 'HKEX:700' }])[0].symbol]);
        const emRequests = fetcher.mock.calls.filter(([input]) => String(input).includes('search-api-web'));
        expect(emRequests).toHaveLength(2);
    });

    it('uses saved company names and related source names, preserving 致茂 query spelling', async () => {
        const fetcher = mockSources({ tw: [{ newsId: 10, title: '最新營運消息', market: [{ code: '2360', name: '致茂' }] }],
            cnyes: [{ newsId: 11, title: '致茂營收創高' }], em: [{ title: '新公司扩大投资', date: '2026-11-08 10:30:00', url: 'https://example.com/new' }] });
        const result = await getWatchlistNews([{ symbol: '2360.TW', company: '致茂' }, { symbol: '920001.BJ', company: '新公司' }]);
        expect(result.articles).toHaveLength(3);
        expect(result.articles.find((item) => item.headline === '最新營運消息')?.associations).toEqual([{ symbol: '2360.TW', reason: 'source-company', matchedText: '致茂' }]);
        const cnyes = fetcher.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.hostname === 'ess.api.cnyes.com')!;
        expect(cnyes.searchParams.get('q')).toBe('致茂');
        expect(result.articles[0].publishedAt).toBe('2026-11-08T02:30:00.000Z');
    });

    it('retains TWO and BJ identity and only accepts the correct explicit exchange', async () => {
        mockSources({ tw: [
            { newsId: 20, title: '環球晶新產線', market: [{ code: '6488', exchange: 'TPEX', name: '環球晶' }] },
            { newsId: 21, title: 'TPEX:6488 announces results' }, { newsId: 22, title: 'TWSE:6488 unrelated listing' },
        ], cn: [sina('BSE:920001 公司新订单', 23), sina('项目支出920001万元', 24)] });
        const result = await getWatchlistNews([{ symbol: 'TPEX:6488', company: '环球晶' }, { symbol: 'BSE:920001' }]);
        expect(result.articles.map((item) => item.headline)).toEqual(expect.arrayContaining(['環球晶新產線', 'TPEX:6488 announces results', 'BSE:920001 公司新订单']));
        expect(result.articles).toHaveLength(3);
        expect(result.articles.find((item) => item.headline === '環球晶新產線')?.relatedSymbols).toEqual(['6488.TWO']);
        expect(result.articles.find((item) => item.headline.startsWith('BSE:'))?.relatedSymbols).toEqual(['920001.BJ']);
        expect(newsAssociation(article({ headline: '2330.HK 最新消息', summary: '', relatedSymbols: [] }), { symbol: '2330.TW' })).toBeUndefined();
        expect(newsAssociation(article({ headline: '6488.TW latest results', relatedSymbols: [] }), { symbol: '6488.TWO', company: '6488.TW' })).toBeUndefined();
        expect(newsAssociation(article({ headline: '環球晶擴廠', relatedSymbols: [] }), { symbol: '6488.TWO', company: '环球晶' })?.reason).toBe('company-name');
    });

    it('deduplicates stable URLs/headlines and preserves URL/source/unknown publication dates', async () => {
        const fixture = { cn: [sina('台积电资本支出', 31, 1800000031), sina('台积电旧闻', 32, 1700000000), sina('台积电时间未知', 33, 'bad')],
            em: [{ title: '台积电资本支出转载', code: 34, url: 'https://example.com/31?utm_source=em', date: '' },
                { title: '台积电时间未知', url: 'https://example.com/other' }, { title: '台积电非法链接', url: 'javascript:alert(1)' }] };
        mockSources(fixture);
        const first = await getWatchlistNews([{ symbol: '2330.TW' }]);
        const second = await getWatchlistNews([{ symbol: '2330.TW' }]);
        expect(first.articles.map((item) => item.headline)).toEqual(['台积电资本支出', '台积电旧闻', '台积电时间未知']);
        expect(first.articles[0]).toMatchObject({ url: 'https://example.com/31', source: '原始来源', datetime: 1800000031 });
        expect(first.articles[2]).toMatchObject({ datetime: 0, publishedAt: undefined });
        expect(first.articles.map((item) => item.id)).toEqual(second.articles.map((item) => item.id));
    });

    it('distinguishes valid unmatched/empty responses from malformed responses and source failures', async () => {
        mockSources({ us: [sina('Unrelated story', 40)] });
        expect((await getWatchlistNews([{ symbol: 'AAPL', company: 'Apple' }])).status).toBe('empty');
        mockSources({ malformed: ['lid=2517'], fail: ['search-api-web'] });
        const partial = await getWatchlistNews([{ symbol: 'AAPL' }]);
        expect(partial.articles).toEqual([]);
        expect(partial.status).toBe('partial');
        expect(partial.sources.filter((source) => source.status === 'error')).toHaveLength(2);
        mockSources({ fail: ['https://'] });
        expect((await getWatchlistNews([{ symbol: 'AAPL' }])).status).toBe('error');
    });

    it('caps targeted searches, bounds concurrency, and does not fetch quotes/fundamentals/reports', async () => {
        const provider = mockSources();
        let active = 0;
        let peak = 0;
        const fetcher = vi.fn(async (...args: Parameters<typeof provider>) => {
            active++;
            peak = Math.max(peak, active);
            await Promise.resolve();
            try { return await provider(...args); } finally { active--; }
        });
        vi.stubGlobal('fetch', fetcher);
        const result = await getWatchlistNews(Array.from({ length: 15 }, (_, index) => ({ symbol: `TEST${index}` })));
        expect(result.coverage).toMatchObject({ requested: 15, targeted: 12, feedOnlySymbols: ['TEST12', 'TEST13', 'TEST14'] });
        expect(fetcher).toHaveBeenCalledTimes(16);
        expect(peak).toBeLessThanOrEqual(4);
        expect(fetcher.mock.calls.every(([url]) => !/reportapi|finance\/quote|fundamental|profile|np-anotice/.test(String(url)))).toBe(true);
    });

    it('times out a stalled source and retains healthy related news', async () => {
        vi.useFakeTimers();
        const provider = mockSources({ us: [sina('AAPL earnings', 50)] });
        let signal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
            if (url.includes('lid=2517')) { signal = options.signal as AbortSignal; return new Promise(() => {}); }
            return provider(url);
        }));
        const pending = getWatchlistNews([{ symbol: 'AAPL' }]);
        await vi.advanceTimersByTimeAsync(6001);
        const result = await pending;
        expect(result.status).toBe('partial');
        expect(result.articles[0].headline).toBe('AAPL earnings');
        expect(signal?.aborted).toBe(true);
    });
});

describe('actual watchlist news view', () => {
    it('keeps unrelated broad feed out of the default rendered list and renders association/unknown time', () => {
        const unrelated = article({ id: 2, headline: '无关市场消息', relatedSymbols: [], associations: [] });
        const html = renderToStaticMarkup(<NewsList news={[article(), unrelated]} marketNews={[unrelated]} status="ready" coverage={{ requested: 1, targeted: 1, feedOnlySymbols: [] }} />);
        expect(html).toContain('台積電營收上升');
        expect(html).not.toContain('无关市场消息');
        expect(html).toContain('名称匹配');
        expect(html).toContain('发布时间未知');
        expect(html).toContain('自选相关');
        expect(html).toContain('全市场');
    });

    it('selects a separate market view and classifies TW/TWO/BJ by canonical identity', () => {
        const tw = article();
        const two = article({ id: 2, relatedSymbols: ['6488.TWO'], related: '6488.TWO' });
        const bj = article({ id: 3, category: 'A股', relatedSymbols: ['920001.BJ'], related: '920001.BJ' });
        const unrelated = article({ id: 4, relatedSymbols: [], associations: [] });
        expect(selectNewsView([tw, two, bj, unrelated], [unrelated], 'watchlist', 'hk')).toEqual([]);
        expect(selectNewsView([tw, two, bj], [], 'watchlist', 'tw')).toEqual([tw, two]);
        expect(selectNewsView([tw, two, bj], [], 'watchlist', 'cn')).toEqual([bj]);
        expect(selectNewsView([tw], [unrelated], 'market', 'all')).toEqual([unrelated]);
        expect(articleMarkets(article({ relatedSymbols: [], related: '2330.TW', category: '' }))).toEqual(['tw']);
        expect(articleMarkets(article({ relatedSymbols: ['6488.TWO'], category: '' }))).toEqual(['tw']);
    });

    it('renders explicit empty-watchlist and source-failure states independently', () => {
        const empty = renderToStaticMarkup(<NewsList news={[]} coverage={{ requested: 0, targeted: 0, feedOnlySymbols: [] }} />);
        const failed = renderToStaticMarkup(<NewsList news={[]} status="error" />);
        expect(empty).toContain('添加自选后查看相关资讯');
        expect(empty).not.toContain('资讯来源暂时不可用');
        expect(failed).toContain('资讯来源暂时不可用');
        expect(failed).not.toContain('暂无匹配的自选资讯');
    });
});
