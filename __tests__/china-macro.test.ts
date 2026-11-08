import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChinaMarketMacro, getChinaSectorRankings } from '@/lib/actions/china-market.actions';
import ChinaMarketMacroBar from '@/components/ChinaMarketMacroBar';

const sina = (sh = '100000', sz = '200000') => new Response(`var hq_str_s_sh000001="Shanghai,1,0,0,1,${sh}";var hq_str_s_sz399001="Shenzhen,1,0,0,1,${sz}";`);
const rows = () => [{ f12: '000001', f104: 10, f105: 20, f106: 0 }, { f12: '399001', f104: 30, f105: 40, f106: 0 }];
const fx = () => Response.json({ chart: { result: [{ meta: { regularMarketPrice: 7.12, regularMarketChangePercent: 0, regularMarketTime: 1793948400 } }] } });
function setup(overrides: { turnover?: () => Response; breadth?: () => Response; fx?: () => Response } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes('hq.sinajs')) return (overrides.turnover ?? sina)();
        if (url.includes('yahoo')) return (overrides.fx ?? fx)();
        return (overrides.breadth ?? (() => Response.json({ data: { diff: rows() } })))();
    }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('China macro source semantics', () => {
    it('preserves real zero turnover, breadth and FX values', async () => {
        setup({ turnover: () => sina('0', '0'), breadth: () => Response.json({ data: { diff: rows().map((row) => ({ ...row, f104: 0, f105: 0 })) } }),
            fx: () => Response.json({ chart: { result: [{ meta: { regularMarketPrice: 0, regularMarketChangePercent: 0 } }] } }) });
        const data = await getChinaMarketMacro();
        expect(data).toMatchObject({ totalTurnoverYi: 0, totalTurnoverText: '0 亿元', shTurnoverText: '0 亿', szTurnoverText: '0 亿', upCount: 0, downCount: 0, flatCount: 0, usdcnhRate: 0, usdcnhChangePercent: 0 });
        expect(data.sources.fx.asOf).toBeUndefined();
        const html = renderToStaticMarkup(await ChinaMarketMacroBar());
        expect(html).toContain('0.0000');
        expect(html).toContain('样本上涨占比 —');
        expect(html).not.toContain('50%');
    });

    it.each(['', '-', ' ', 'NaN', '-1'])('never creates a two-market total from missing/invalid turnover %j', async (missing) => {
        setup({ turnover: () => sina('100000', missing) });
        const data = await getChinaMarketMacro();
        expect(data.totalTurnoverYi).toBeUndefined();
        expect(data.totalTurnoverText).toBe('—');
        expect(data.shTurnoverText).toBe('10 亿');
        expect(data.szTurnoverText).toBe('—');
        expect(data.sources.turnover.coverage).toContain('深市缺失');
        expect(data.upCount).toBe(40);
    });

    it('requires both exchange records and ignores unrelated or duplicate breadth rows', async () => {
        setup({ turnover: () => new Response('var hq_str_s_sh000001="Shanghai,1,0,0,1,0";'),
            breadth: () => Response.json({ data: { diff: [rows()[0], rows()[0], { f12: 'foreign', f104: 999, f105: 0, f106: 0 }] } }) });
        const data = await getChinaMarketMacro();
        expect(data.totalTurnoverYi).toBeUndefined();
        expect(data.shTurnoverText).toBe('0 亿');
        expect(data.upCount).toBeUndefined();
        expect(data.downCount).toBeUndefined();
        expect(data.flatCount).toBeUndefined();
        expect(data.sources.breadth.coverage).toContain('1/2');
    });

    it.each([null, '', '-', -1, 0.5])('leaves invalid breadth field %j unknown while retaining valid metrics', async (missing) => {
        setup({ breadth: () => Response.json({ data: { diff: [rows()[0], { ...rows()[1], f105: missing }] } }) });
        const data = await getChinaMarketMacro();
        expect(data.upCount).toBe(40);
        expect(data.downCount).toBeUndefined();
        expect(data.flatCount).toBe(0);
        const html = renderToStaticMarkup(await ChinaMarketMacroBar());
        expect(html).toContain('样本上涨占比 —');
        expect(html).toContain('跌 — 家');
    });

    it.each(['turnover', 'breadth', 'fx'] as const)('isolates %s network failure from the other resources', async (resource) => {
        setup({ [resource]: () => { throw new Error('offline'); } });
        const data = await getChinaMarketMacro();
        expect(data.sources[resource].error).toBeTruthy();
        if (resource !== 'turnover') expect(data.totalTurnoverYi).toBe(30);
        if (resource !== 'breadth') expect(data.upCount).toBe(40);
        if (resource !== 'fx') expect(data.usdcnhRate).toBe(7.12);
    });

    it('isolates malformed JSON and non-OK responses', async () => {
        setup({ breadth: () => new Response('{broken'), fx: () => new Response('', { status: 503 }) });
        const data = await getChinaMarketMacro();
        expect(data.totalTurnoverYi).toBe(30);
        expect(data.sources.breadth.error).toBeTruthy();
        expect(data.sources.fx.error).toBeTruthy();
        expect(data.upCount).toBeUndefined();
        expect(data.usdcnhRate).toBeUndefined();
    });

    it('uses provider FX time only and keeps source/fetch/coverage separate for each resource', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
        setup();
        const data = await getChinaMarketMacro();
        expect(data.sources.fx.asOf).toBe(new Date(1793948400 * 1000).toISOString());
        expect(data.sources.turnover.asOf).toBeUndefined();
        expect(data.sources.breadth.asOf).toBeUndefined();
        for (const metadata of Object.values(data.sources)) {
            expect(metadata.source).toBeTruthy();
            expect(metadata.coverage).toBeTruthy();
            expect(metadata.fetchedAt).toBe('2026-11-08T10:00:00.000Z');
            expect(metadata.asOf).not.toBe(metadata.fetchedAt);
        }
        expect(data).not.toHaveProperty('updateTime');
        const html = renderToStaticMarkup(await ChinaMarketMacroBar());
        for (const text of ['A股（沪深）', '不含北交所', '来源时间未提供', '获取于', '样本合计 100 家']) expect(html).toContain(text);
        for (const text of ['赚钱效应', '普涨逼空', '放量', 'A股 · 港股 · 台股 实时联动']) expect(html).not.toContain(text);
    });

    it('keeps a fully unavailable macro visible with honest missing states', async () => {
        const fail = () => { throw new Error('offline'); };
        setup({ turnover: fail, breadth: fail, fx: fail });
        const html = renderToStaticMarkup(await ChinaMarketMacroBar());
        expect(html).toContain('缺少完整两市合计');
        expect(html).toContain('来源暂不可用');
        expect(html).toContain('样本上涨占比 —');
    });

    it('records metadata separately for sector ranking resources', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { diff: [{ f12: 'BK001', f14: '行业', f3: 0, f62: 0 }] } })));
        const data = await getChinaSectorRankings();
        expect(data.topGainersMetadata).toMatchObject({ source: '东方财富行业板块排行', fetchedAt: expect.any(String) });
        expect(data.topInflowsMetadata?.coverage).toContain('不等于机构身份');
        expect(data.topGainersMetadata?.asOf).toBeUndefined();
        expect(data.topInflowsMetadata?.asOf).toBeUndefined();
    });
});
