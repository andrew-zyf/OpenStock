import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHongKongDiscovery, parseTaiwanDiscovery, rocDate, summarizeDiscovery } from '@/lib/market/discovery';
import { getMarketDiscovery } from '@/lib/actions/market-discovery.actions';

afterEach(() => vi.unstubAllGlobals());
const twPrices = [
    { Date: '1151106', Code: '2330', Name: '台積電', ClosingPrice: '1,000', Change: '10' },
    { Date: '1151106', Code: '2317', Name: '鴻海', ClosingPrice: '200', Change: '0' },
    { Date: '1151106', Code: '0050', Name: 'ETF', ClosingPrice: '100', Change: '1' },
];
const companies = [{ 公司代號: '2330', 產業別: '24' }, { 公司代號: '2317', 產業別: '31' }];
const hkRow = { f12: '00700', f14: '腾讯', f2: 400, f3: 0, f100: '软件服务', f124: Date.parse('2026-11-06T08:00:00Z') / 1000 };

describe('market discovery source contracts', () => {
    it('converts verified ROC dates without inventing a time or normalizing invalid dates', () => {
        expect(rocDate('1151106')).toBe('2026-11-06');
        expect(rocDate('1150230')).toBeUndefined();
        expect(rocDate('20261106')).toBeUndefined();
    });
    it('matches the company universe, preserves zero and computes change from source price difference', () => {
        const rows = parseTaiwanDiscovery(twPrices, companies);
        expect(rows).toHaveLength(2);
        expect(rows[0].changePercent).toBeCloseTo(10 / 990 * 100);
        expect(rows[1].changePercent).toBe(0);
        expect(rows[0].industry).toBe('TWSE 产业代码 24');
    });
    it('keeps missing prices absent and excludes unsupported HK counters', () => {
        const rows = parseHongKongDiscovery([hkRow, { ...hkRow, f12: '09988', f2: '-', f3: '-' }, { ...hkRow, f12: '89988' }, { ...hkRow, f12: undefined }]);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ symbol: '007' + '00.HK', changePercent: 0, date: '2026-11-06' });
        expect(rows[1].price).toBeUndefined();
        expect(rows[1].changePercent).toBeUndefined();
    });
    it('deduplicates samples and excludes unknown/older dates from breadth and industry averages', () => {
        const members = parseHongKongDiscovery([hkRow]);
        const result = summarizeDiscovery([...members, ...members, { ...members[0], symbol: '00001.HK', changePercent: 99, date: '2026-11-05' }, { ...members[0], symbol: '00002.HK', changePercent: -4, date: undefined }]);
        expect(result.breadth).toEqual({ up: 0, down: 0, flat: 1, missing: 2 });
        expect(result.industries[0].averageChangePercent).toBe(0);
        expect(result.industries[0].members).toHaveLength(3);
    });
    it('bounds HK requests to five pages and three concurrent requests with explicit sample coverage', async () => {
        let active = 0; let peak = 0;
        const fetcher = vi.fn(async (url: string) => {
            active++; peak = Math.max(peak, active);
            await Promise.resolve(); active--;
            const page = Number(new URL(url).searchParams.get('pn'));
            return { ok: true, json: async () => ({ data: { total: 4743, diff: [{ ...hkRow, f12: String(page) }] } }) };
        });
        vi.stubGlobal('fetch', fetcher);
        const result = await getMarketDiscovery('hk');
        expect(fetcher).toHaveBeenCalledTimes(5);
        expect(peak).toBeLessThanOrEqual(3);
        expect(result).toMatchObject({ status: 'partial', received: 5, total: 4743 });
        expect(result.coverage).toContain('不代表全市场');
        for (const [url] of fetcher.mock.calls) {
            expect(new URL(url).searchParams.get('pz')).toBe('100');
            expect(new URL(url).searchParams.get('fid')).toBe('f12');
        }
    });
    it('keeps partial HK data when one source page fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (new URL(url).searchParams.get('pn') === '2') throw new Error('network');
            return { ok: true, json: async () => ({ data: { total: 4743, diff: [hkRow] } }) };
        }));
        const result = await getMarketDiscovery('hk');
        expect(result.status).toBe('partial');
        expect(result.notes.join(' ')).toContain('1/5 页');
        expect(result.breadth.flat).toBe(1);
    });
    it('distinguishes source failure and valid empty responses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
        expect((await getMarketDiscovery('hk')).status).toBe('error');
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { total: 0, diff: [] } }) })));
        expect((await getMarketDiscovery('hk')).status).toBe('empty');
    });
    it('uses both TWSE datasets and fails rather than silently changing the universe', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('STOCK_DAY_ALL') ? twPrices : companies })));
        expect(await getMarketDiscovery('tw')).toMatchObject({ status: 'ready', date: '2026-11-06', received: 3, total: 2, breadth: { up: 1, flat: 1 } });
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
        expect((await getMarketDiscovery('tw')).status).toBe('error');
    });
});
