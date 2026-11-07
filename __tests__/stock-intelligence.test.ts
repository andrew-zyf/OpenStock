import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getStockIntelligence, type StockIntelligenceData } from '@/lib/actions/stock-intelligence.actions';
import { fetchRealtimeQuotes } from '@/lib/realtime-market';
import { selectIntelligenceTab } from '@/components/stocks/StockIntelligenceCard';

vi.mock('@/lib/realtime-market', () => ({ fetchRealtimeQuotes: vi.fn() }));

type Fixture = {
    news?: unknown;
    cnyes?: unknown;
    reports?: unknown;
    announcements?: unknown;
    failures?: string[];
};

function mockSources(fixture: Fixture = {}) {
    return vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (fixture.failures?.some((part) => url.includes(part))) throw new Error('Provider unavailable');
        if (url.includes('search-api-web')) {
            return new Response(`jQuery(\n${JSON.stringify({ result: { cmsArticleWebOld: fixture.news ?? [] } })}\n);`);
        }
        if (url.includes('ess.api.cnyes')) return Response.json({ data: { items: fixture.cnyes ?? [] } });
        if (url.includes('reportapi')) return Response.json({ data: fixture.reports ?? [] });
        if (url.includes('np-anotice')) return Response.json({ data: { list: fixture.announcements ?? [] } });
        throw new Error(`Unexpected provider: ${url}`);
    });
}

beforeEach(() => {
    vi.mocked(fetchRealtimeQuotes).mockReset();
    vi.mocked(fetchRealtimeQuotes).mockResolvedValue({});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('stock intelligence source behavior', () => {
    it('returns no Taiwan fallback news when cnYES fails and EM only has irrelevant character matches', async () => {
        vi.mocked(fetchRealtimeQuotes).mockRejectedValue(new Error('Quotes unavailable'));
        const fetch = mockSources({
            failures: ['ess.api.cnyes'],
            news: ['海浪预警发布', '皇台酒业今日涨停', '天空电视台公布节目'].map((title, code) => ({ title, code, url: `https://example.com/${code}` })),
        });
        vi.stubGlobal('fetch', fetch);
        const result = await getStockIntelligence('2330.TW');
        expect(result.name).toBe('台积电');
        expect(result.news).toEqual([]);
        expect(result.reports).toEqual([]);
        expect(result.announcements).toEqual([]);
        expect(result.status).toEqual({ news: 'error', reports: 'unsupported', announcements: 'error' });
        const cnyesUrl = fetch.mock.calls.map(([url]) => String(url)).find((url) => url.includes('cnyes'))!;
        expect(new URL(cnyesUrl).searchParams.get('q')).toBe('台積電');
    });

    it('accepts full simplified/traditional/English aliases and refuses to fill eight rows with weak hits', async () => {
        vi.stubGlobal('fetch', mockSources({ news: [
            { title: '<em>台积电</em>扩大投资', code: 'a', url: 'https://example.com/a' },
            { title: '臺積電新品量产', code: 'b', url: 'https://example.com/b' },
            { title: 'TSMC raises guidance', code: 'c', url: 'https://example.com/c' },
            { title: '天空电视台', content: '搜索词：台積電', code: 'd', url: 'https://example.com/d' },
            { title: 'NOTSMCOTHER general news', code: 'e', url: 'https://example.com/e' },
            { title: '台股成交额达2330亿元', code: 'f', url: 'https://example.com/f' },
            { title: '新工廠量產（2330）', code: 'g', url: 'https://example.com/g' },
        ] }));
        const result = await getStockIntelligence('TWSE:2330');
        expect(result.news.map((item) => item.title)).toEqual(['台积电扩大投资', '臺積電新品量产', 'TSMC raises guidance', '新工廠量產（2330）']);
        expect(result.status.news).toBe('ready');
    });

    it('preserves the source company name 致茂 for 2360.TW queries and relevance filtering', async () => {
        vi.mocked(fetchRealtimeQuotes).mockResolvedValue({
            '2360.TW': {
                symbol: '2360.TW', name: '致茂', source: 'TWSE', fetchedAt: '2026-11-08T00:00:00Z',
                price: 100, prevClose: 99, open: 99, high: 101, low: 98, change: 1, changePercent: 1.01,
                volumeUnit: 'shares', currency: 'TWD', exchange: '台湾证券交易所', market: 'tw', updatedAt: '',
                c: 100, d: 1, dp: 1.01, h: 101, l: 98, o: 99, pc: 99, t: 0,
            },
        });
        const sources = mockSources({ cnyes: [
            { newsId: 23601, title: '致茂營收創高', category: [{ name: '台股新聞' }] },
            { newsId: 23602, title: '其他公司營收創高', category: [{ name: '台股新聞' }] },
        ] });
        const fetch = vi.fn((input: string | URL | Request) => {
            const url = new URL(String(input));
            if (url.hostname === 'ess.api.cnyes.com' && url.searchParams.get('q') !== '致茂') {
                return Promise.resolve(Response.json({ data: { items: [] } }));
            }
            return sources(input);
        });
        vi.stubGlobal('fetch', fetch);
        const result = await getStockIntelligence('2360.TW');
        const cnyesUrl = fetch.mock.calls.map(([url]) => new URL(String(url))).find((url) => url.hostname === 'ess.api.cnyes.com')!;
        expect(cnyesUrl.searchParams.get('q')).toBe('致茂');
        expect(result.name).toBe('致茂');
        expect(result.news.map((item) => item.title)).toEqual(['致茂營收創高']);
        expect(result.status.news).toBe('ready');
    });

    it('uses cnYES source category for announcements instead of title keywords', async () => {
        vi.stubGlobal('fetch', mockSources({ cnyes: [
            { newsId: 1, title: '台積電最新營運資料', category: [{ name: '台股公告' }], publishAt: 1800000000 },
            { newsId: 2, title: '台積電董事會公告引發市場討論', category: [{ name: '台股新聞' }] },
            { newsId: 3, title: '其他公司最新營運資料', category: [{ name: '台股公告' }] },
        ] }));
        const result = await getStockIntelligence('2330.TW');
        expect(result.announcements).toHaveLength(1);
        expect(result.announcements[0]).toMatchObject({ title: '台積電最新營運資料', category: '转载重大讯息', source: '鉅亨網 · 重大讯息转载' });
        expect(result.news.map((item) => item.id)).toEqual(['cnyes:2']);
    });

    it('deduplicates stable IDs and canonical URLs across sources, with deterministic missing-code IDs', async () => {
        vi.stubGlobal('fetch', mockSources({
            cnyes: [{ newsId: 1, title: '台積電營收上升' }],
            news: [
                { code: '1', title: '台积电营收上升', url: 'https://news.cnyes.com/news/id/1?utm_source=em' },
                { code: '2', title: '台积电资本支出', url: 'https://example.com/2' },
                { code: '2', title: '台积电重复报道', url: 'https://example.com/duplicate' },
                { title: '台积电季度业绩', url: 'https://example.com/3' },
                { title: '台积电无有效链接', url: 'javascript:alert(1)' },
            ],
        }));
        const first = await getStockIntelligence('2330.TW');
        const second = await getStockIntelligence('2330.TW');
        expect(first.news).toHaveLength(3);
        expect(first.news.map((item) => item.id)).toEqual(second.news.map((item) => item.id));
        expect(first.news[2].id).toBe('em:https://example.com/3');
    });

    it('keeps source failures independent and does not invent research ratings or invalid forecasts', async () => {
        vi.stubGlobal('fetch', mockSources({
            failures: ['search-api-web', 'np-anotice'],
            reports: [
                { infoCode: 'r1', title: '盈利预测', orgSName: '某证券', stockCode: '600519', publishDate: '2031-05-19', predictThisYearEps: 0, predictThisYearPe: 'bad' },
                { infoCode: 'other', title: '其他股票', stockCode: '600036' },
                { title: '缺少报告标识' },
            ],
        }));
        const result = await getStockIntelligence('600519.SS');
        expect(result.news).toEqual([]);
        expect(result.announcements).toEqual([]);
        expect(result.reports).toHaveLength(1);
        expect(result.reports[0]).toMatchObject({ rating: undefined, thisYearEps: '0.00元', thisYearPe: undefined });
        expect(result.status).toEqual({ news: 'error', reports: 'ready', announcements: 'error' });
    });

    it('requests a rolling one-year report window ending today rather than fixed 2025/2026 dates', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2031-05-20T12:00:00Z'));
        const fetch = mockSources();
        vi.stubGlobal('fetch', fetch);
        await getStockIntelligence('600519.SS');
        const url = new URL(String(fetch.mock.calls.map(([url]) => url).find((url) => String(url).includes('reportapi'))));
        expect(url.searchParams.get('beginTime')).toBe('2030-05-20');
        expect(url.searchParams.get('endTime')).toBe('2031-05-20');
    });

    it('keeps announcement data available when reports fail', async () => {
        vi.stubGlobal('fetch', mockSources({ failures: ['reportapi'], announcements: [
            { art_code: 'a1', title: '贵州茅台年度报告', codes: [{ stock_code: '600519' }], columns: [{ column_name: '年度报告' }] },
            { art_code: 'a2', title: '其他公司公告', codes: [{ stock_code: '600036' }] },
        ] }));
        const result = await getStockIntelligence('600519.SS');
        expect(result.reports).toEqual([]);
        expect(result.announcements).toHaveLength(1);
        expect(result.announcements[0].source).toBe('东方财富 · 公告转载');
        expect(result.status.reports).toBe('error');
        expect(result.status.announcements).toBe('ready');
    });

    it('distinguishes successful empty responses from malformed schemas and unavailable sources', async () => {
        vi.stubGlobal('fetch', mockSources());
        expect((await getStockIntelligence('600519.SS')).status).toEqual({ news: 'empty', reports: 'empty', announcements: 'empty' });
        vi.stubGlobal('fetch', mockSources({ news: {}, reports: 'invalid', announcements: null, failures: ['np-anotice'] }));
        const result = await getStockIntelligence('600519.SS');
        expect(result.status).toEqual({ news: 'error', reports: 'error', announcements: 'error' });
        expect([result.news, result.reports, result.announcements]).toEqual([[], [], []]);
    });

    it.each(['AAPL', 'HKEX:700', '2330.TW', '000001.SS', '510300.SS', '920001.BJ'])('does not synthesize unsupported reports for %s', async (symbol) => {
        const fetch = mockSources();
        vi.stubGlobal('fetch', fetch);
        const result = await getStockIntelligence(symbol);
        expect(result.reports).toEqual([]);
        expect(result.status.reports).toBe('unsupported');
        expect(fetch.mock.calls.every(([url]) => !String(url).includes('reportapi'))).toBe(true);
    });

    it('bounds a stalled quote request and still retrieves known-symbol news', async () => {
        vi.useFakeTimers();
        vi.mocked(fetchRealtimeQuotes).mockImplementation(() => new Promise(() => {}));
        vi.stubGlobal('fetch', mockSources({ news: [{ title: '台积电新工厂投产', url: 'https://example.com/news' }] }));
        const pending = getStockIntelligence('2330.TW');
        await vi.advanceTimersByTimeAsync(2501);
        expect((await pending).news).toHaveLength(1);
    });

    it('times out a stalled source without blocking a healthy independent source', async () => {
        vi.useFakeTimers();
        const healthy = mockSources({ news: [{ title: '台积电季度业绩', url: 'https://example.com/news' }] });
        const signals: AbortSignal[] = [];
        vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
            if (url.includes('cnyes')) {
                signals.push(options.signal as AbortSignal);
                return new Promise(() => {});
            }
            return healthy(url);
        }));
        const pending = getStockIntelligence('2330.TW');
        await vi.advanceTimersByTimeAsync(8001);
        const result = await pending;
        expect(result.news).toHaveLength(1);
        expect(result.status.news).toBe('partial');
        expect(result.status.announcements).toBe('error');
        expect(signals[0].aborted).toBe(true);
    });

    it('contains compilable regex literals without the ES2018 dotAll flag', () => {
        const source = readFileSync(new URL('../lib/actions/stock-intelligence.actions.ts', import.meta.url), 'utf8');
        const parsed = ts.createSourceFile('stock-intelligence.actions.ts', source, ts.ScriptTarget.ES2017, true);
        const regexes: string[] = [];
        function visit(node: ts.Node) {
            if (ts.isRegularExpressionLiteral(node)) regexes.push(node.text);
            ts.forEachChild(node, visit);
        }
        visit(parsed);
        expect(regexes.length).toBeGreaterThan(0);
        for (const literal of regexes) {
            const end = literal.lastIndexOf('/');
            const flags = literal.slice(end + 1);
            expect(flags).not.toContain('s');
            expect(() => new RegExp(literal.slice(1, end), flags)).not.toThrow();
        }
    });
});

describe('stock intelligence tab selection', () => {
    const data = (news: number, reports: number, announcements: number) => ({
        news: Array(news).fill({}), reports: Array(reports).fill({}), announcements: Array(announcements).fill({}),
    } as StockIntelligenceData);

    it('switches away from a report tab that disappears during refresh', () => {
        expect(selectIntelligenceTab(data(1, 0, 1), 'reports')).toBe('news');
    });

    it('selects the populated announcement tab when no news or reports exist', () => {
        expect(selectIntelligenceTab(data(0, 0, 1), 'news')).toBe('announcements');
    });

    it('returns the valid news empty-state tab when every section is empty or a symbol resets', () => {
        expect(selectIntelligenceTab(data(0, 0, 0), 'announcements')).toBe('news');
        expect(selectIntelligenceTab(undefined, 'reports')).toBe('news');
    });
});
