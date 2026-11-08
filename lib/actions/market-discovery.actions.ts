'use server';

import { discoveryRows, parseHongKongDiscovery, parseTaiwanDiscovery, summarizeDiscovery, type DiscoveryData } from '@/lib/market/discovery';

const TW_PRICES = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TW_COMPANIES = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const HK_SOURCE = 'https://push2.eastmoney.com/api/qt/clist/get';

async function sourceJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async () => {
                const response = await fetch(url, { signal: controller.signal, next: { revalidate: 300 } });
                if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
                return response.json();
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Source timeout')); }, 6_000); }),
        ]);
    } finally { clearTimeout(timer); }
}

export async function getMarketDiscovery(market: 'hk' | 'tw'): Promise<DiscoveryData> {
    if (market !== 'hk' && market !== 'tw') throw new Error('Unsupported discovery market');
    const base: DiscoveryData = {
        market, status: 'error', source: market === 'tw' ? 'TWSE OpenAPI' : 'EastMoney 港股列表',
        sourceUrl: market === 'tw' ? TW_PRICES : HK_SOURCE,
        fetchedAt: new Date().toISOString(), received: 0,
        coverage: market === 'tw' ? 'TWSE 上市公司日终样本；不含上柜及 ETF' : '按代码升序读取前 5 页，每页最多 100 条；仅保留 0 开头证券代码，不代表全市场',
        notes: [], breadth: { up: 0, down: 0, flat: 0, missing: 0 }, industries: [],
    };
    try {
        if (market === 'tw') {
            const [prices, companies] = await Promise.all([sourceJson(TW_PRICES), sourceJson(TW_COMPANIES)]);
            if (!Array.isArray(prices) || !Array.isArray(companies) || !companies.length) throw new Error('Invalid TWSE dataset');
            const members = parseTaiwanDiscovery(prices, companies);
            const summary = summarizeDiscovery(members);
            return { ...base, ...summary, received: discoveryRows(prices).length, total: discoveryRows(companies).length,
                status: !members.length ? 'empty' : summary.breadth.missing ? 'partial' : 'ready',
                notes: ['仅统计能匹配官方公司清单的四位代码；行业按官方产业代码分组。', '价格为日终记录，涨跌幅按收盘价与来源价差计算；无源日期或不同日记录不计入广度。'] };
        }
        const results: PromiseSettledResult<unknown>[] = [];
        // Bound both page count and concurrency; the source silently caps pz at 100.
        for (const pages of [[1, 2, 3], [4, 5]]) {
            results.push(...await Promise.allSettled(pages.map((page) => sourceJson(`${HK_SOURCE}?${new URLSearchParams({
                pn: String(page), pz: '100', po: '0', np: '1', fltt: '2', invt: '2', fid: 'f12',
                fs: 'm:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2', fields: 'f12,f14,f2,f3,f124,f100',
            })}`))));
        }
        const rows: Record<string, unknown>[] = [];
        let failed = 0;
        let total: number | undefined;
        for (const result of results) {
            if (result.status !== 'fulfilled') { failed++; continue; }
            const payload = result.value as { data?: { total?: unknown; diff?: unknown } } | null;
            if (!payload?.data || !Array.isArray(payload.data.diff)) { failed++; continue; }
            rows.push(...discoveryRows(payload.data.diff));
            if (typeof payload.data.total === 'number' && Number.isFinite(payload.data.total)) total = payload.data.total;
        }
        if (failed === results.length) throw new Error('All HK pages unavailable');
        const members = parseHongKongDiscovery(rows);
        return { ...base, ...summarizeDiscovery(members), received: rows.length, total,
            status: members.length ? 'partial' : 'empty', notes: [
                '这是固定代码排序的证券样本，可能包含基金；涨跌家数和行业等权均值均仅代表本样本。',
                '不汇总跨币种成交额；无源日期、不同日或缺价记录不计入涨跌家数。',
                ...(failed ? [`${failed}/5 页来源请求失败，展示已取得样本。`] : []),
            ] };
    } catch {
        return { ...base, notes: ['来源暂不可用；当前无法建立可核验的本市场样本。'] };
    }
}
