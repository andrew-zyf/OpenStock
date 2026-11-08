import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChinaSectorMembers, { createSectorMembersLoader, SectorMembersContent } from '@/components/ChinaSectorMembers';
import SectorFlowPanel from '@/components/SectorFlowPanel';
import type { SectorMembersData } from '@/lib/market/sector-members';

const { getMembers, watchlistButton, marketResource } = vi.hoisted(() => ({ getMembers: vi.fn(), watchlistButton: vi.fn(), marketResource: vi.fn() }));
vi.mock('@/lib/actions/sector-members.actions', () => ({ getChinaSectorMembers: getMembers }));
vi.mock('@/lib/actions/china-market.actions', () => ({ getChinaSectorRankings: vi.fn() }));
vi.mock('@/components/WatchlistButton', () => ({ default: (props: { symbol: string; isInWatchlist: boolean }) => {
    watchlistButton(props);
    return <button type="button" aria-pressed={props.isInWatchlist}>观察 {props.symbol}</button>;
} }));
vi.mock('@/hooks/useMarketResource', () => ({ useMarketResource: marketResource }));

const data: SectorMembersData = {
    sectorCode: 'BK1036', status: 'partial', source: '东方财富行业成员', sourceUrl: 'https://push2.eastmoney.com/api/qt/clist/get',
    fetchedAt: '2026-11-08T01:00:00Z', date: '2026-11-06', asOf: '2026-11-06T07:00:00Z', received: 4, total: 500, pages: 1, failedPages: 0,
    coverage: '仅代表已取样本，不代表全行业：纳入 4 只 / 来源总数 500', notes: ['取回时间不是行情时间'],
    breadth: { up: 1, down: 1, flat: 1, missing: 1 }, averageChangePercent: 2 / 3,
    members: [
        { symbol: '600000.SS', name: '上涨成员', price: 10, changePercent: 4, asOf: '2026-11-06T07:00:00Z' },
        { symbol: '000001.SZ', name: '落后成员', price: 9, changePercent: -2 },
        { symbol: '920181.BJ', name: '平盘成员', price: 8, changePercent: 0 },
        { symbol: '600001.SS', name: '缺失成员' },
    ],
};

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('sector members disclosure and honest rendering', () => {
    it('starts closed and never fetches members just by mounting the panel', () => {
        const loader = vi.fn();
        const html = renderToStaticMarkup(<ChinaSectorMembers sectorCode="BK1036" loadMembers={loader} onWatchlistChange={vi.fn()} />);
        expect(html).toContain('<details');
        expect(html).toContain('<summary');
        expect(html).toContain('展开行业成员');
        expect(html).not.toContain(' open=');
        expect(loader).not.toHaveBeenCalled();
        expect(getMembers).not.toHaveBeenCalled();
        expect(watchlistButton).not.toHaveBeenCalled();
    });
    it.each([{ sectorCode: 'BK1036', market: 'hk' }, { sectorCode: 'HK00700', market: 'cn' }])('refuses unsupported market or board scope %s', (props) => {
        const loader = vi.fn();
        const html = renderToStaticMarkup(<ChinaSectorMembers {...props} loadMembers={loader} onWatchlistChange={vi.fn()} />);
        expect(html).toContain('不支持');
        expect(html).not.toContain('<details');
        expect(html).not.toContain('/stocks/');
        expect(loader).not.toHaveBeenCalled();
    });
    it('renders explicit sample breadth, equal-weight basis, all members, dates and canonical watchlist markers', () => {
        const callback = vi.fn();
        const html = renderToStaticMarkup(<SectorMembersContent data={data} watchlistSymbols={['SSE:600000', '920181', '000001.HK']} onWatchlistChange={callback} />);
        for (const text of ['不代表全行业', '样本上涨 1', '下跌 1', '平盘 1', '缺失或不同日 1', '等权涨跌幅均值', '+0.67%', '样本落后',
            '全部已取成员', '平盘成员', '缺失成员', '来源未提供行情时间', '2026-11-06', '2026-11-08', '取回时间不是行情时间', '0.00%']) expect(html).toContain(text);
        for (const symbol of ['600000.SS', '000001.SZ', '920181.BJ']) expect(html).toContain(`/stocks/${symbol}`);
        expect(watchlistButton.mock.calls.find(([props]) => props.symbol === '600000.SS')?.[0]).toMatchObject({ isInWatchlist: true, onWatchlistChange: callback });
        expect(watchlistButton.mock.calls.find(([props]) => props.symbol === '920181.BJ')?.[0]).toMatchObject({ isInWatchlist: true });
        expect(watchlistButton.mock.calls.find(([props]) => props.symbol === '000001.SZ')?.[0]).toMatchObject({ isInWatchlist: false });
        expect(html).toContain('已自选');
        expect(html).toContain('来源价 —');
        expect(getMembers).not.toHaveBeenCalled();
    });
    it('keeps unsupported, empty and error states distinct and missing means absent', () => {
        const props = { watchlistSymbols: [], onWatchlistChange: vi.fn() };
        expect(renderToStaticMarkup(<SectorMembersContent {...props} data={{ ...data, status: 'unsupported' }} />)).toContain('不支持');
        expect(renderToStaticMarkup(<SectorMembersContent {...props} data={{ ...data, status: 'error' }} />)).toContain('来源暂不可用');
        expect(renderToStaticMarkup(<SectorMembersContent {...props} data={{ ...data, status: 'empty', members: [] }} />)).toContain('空成员清单');
        const html = renderToStaticMarkup(<SectorMembersContent {...props} data={{ ...data, averageChangePercent: undefined, date: undefined, asOf: undefined }} />);
        expect(html).toContain('等权涨跌幅均值：—');
        expect(html).toContain('来源日期：未提供');
    });
    it('keeps existing sector polling and labels the China scope when another market is selected', () => {
        const initialData = { fetchedAt: '2026-11-06T08:00:00Z', topGainers: [{ code: 'BK1036', name: '半导体', leaderName: '错误外市领涨股', leaderSymbol: '00700.HK' }], topInflows: [] };
        marketResource.mockReturnValue({ data: initialData, stale: false });
        const html = renderToStaticMarkup(<SectorFlowPanel initialData={initialData} selectedMarket="hk" watchlistSymbols={['600000.SH']} />);
        expect(html).toContain('A股板块（非当前市场）');
        expect(html).toContain('展开行业成员');
        expect(html).not.toContain('/stocks/00700.HK');
        expect(marketResource.mock.calls[0]?.[0]).toMatchObject({ key: 'sectors:cn', intervalMs: 30_000 });
        expect(getMembers).not.toHaveBeenCalled();
    });
});

describe('member request sharing and bounds', () => {
    it('deduplicates the same expanded board across ranking cards and caches for 300 seconds', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn(async () => data);
        const load = createSectorMembersLoader(fetcher);
        const first = load('BK1036');
        expect(load('BK1036')).toBe(first);
        await first;
        expect(fetcher).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(299_999);
        expect(load('BK1036')).toBe(first);
        await vi.advanceTimersByTimeAsync(1);
        await load('BK1036');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it('limits simultaneous expanded-sector requests to two and starts queued work when one ends', async () => {
        const resolvers: ((value: SectorMembersData) => void)[] = [];
        const fetcher = vi.fn(() => new Promise<SectorMembersData>((resolve) => resolvers.push(resolve)));
        const load = createSectorMembersLoader(fetcher);
        const requests = ['BK1036', 'BK1296', 'BK1452', 'BK1587'].map(load);
        await Promise.resolve();
        expect(fetcher).toHaveBeenCalledTimes(2);
        resolvers[0](data); resolvers[1](data);
        await Promise.all(requests.slice(0, 2));
        await Promise.resolve(); await Promise.resolve();
        expect(fetcher).toHaveBeenCalledTimes(4);
        resolvers[2](data); resolvers[3](data);
        await Promise.all(requests);
    });
    it('evicts source errors and rejected actions so a user can retry', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce({ ...data, status: 'error' }).mockRejectedValueOnce(new Error('transport')).mockResolvedValueOnce(data);
        const load = createSectorMembersLoader(fetcher);
        expect((await load('BK1036')).status).toBe('error');
        await expect(load('BK1036')).rejects.toThrow('transport');
        expect((await load('BK1036')).status).toBe('partial');
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
});
