import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DailyResearchResult } from '@/lib/market/daily-research';
const mocks = vi.hoisted(() => ({ load: vi.fn(), groups: vi.fn() }));
vi.mock('@/lib/actions/relative-history.actions', () => ({ getDailyResearch: mocks.load }));
vi.mock('@/lib/actions/peer-groups.actions', () => ({ getPeerGroups: mocks.groups, createPeerGroup: vi.fn(), deletePeerGroup: vi.fn() }));
import DailyResearchPanel, { DailyResearchTable } from '@/components/watchlist/DailyResearchPanel';
const data: DailyResearchResult = {
    scope: 'group', benchmarkSymbol: '510300.SS', fetchedAt: '2026-11-08T01:00:00Z', commonDates: ['2026-10-01', '2026-10-09'], omittedMembers: [{ symbolId: 'US:AAPL', symbol: 'AAPL' }],
    group: { id: 'abcdef012345678901234567', name: '我的固定组', membershipSavedAt: '2026-11-07T01:00:00Z', members: [{ symbolId: 'SZSE:000001.SZ', symbol: '000001.SZ' }] },
    rows: [{ symbolId: 'SZSE:000001.SZ', symbol: '000001.SZ', comparison: {
        status: 'available', source: 'tencent-kline', actualKey: 'qfqday', adjustment: 'forward', currency: 'CNY', fetchedAt: { stock: '2026-11-08T00:00:00Z', benchmark: '2026-11-08T00:01:00Z' },
        five: { status: 'available', intervals: 5, commonPoints: 6, startDate: '2026-10-01', endDate: '2026-10-09', stockReturn: 10, benchmarkReturn: 5, excessPercentagePoints: 5, dates: ['2026-10-01', '2026-10-09'], stockCloses: [100, 110], benchmarkCloses: [200, 210] },
        twenty: { status: 'unavailable', commonPoints: 20, requiredPoints: 21, reason: '需 21 个共同完成日收盘点，当前仅 20 个' }, missingStockDates: ['2026-10-05'], missingBenchmarkDates: [], excludedCurrentDates: ['2026-11-08'],
    }, volume: { status: 'available', date: '2026-11-07', volume: 0, median: 1000, ratio: 0, sampleSize: 20, requiredSample: 20, volumeUnit: 'shares', sampleDates: ['2026-11-06'], sampleVolumes: [1000], missingDates: [] } }],
};
describe('daily research disclosure and on-demand UI', () => {
    it('does not fetch N*M history or even saved groups during server render', () => {
        const html = renderToStaticMarkup(createElement(DailyResearchPanel, { watchedSymbols: [{ symbol: '700.HK', company: '腾讯' }] }));
        expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.groups).not.toHaveBeenCalled();
        expect(html).toContain('读取完成日日线对照'); expect(html).toContain('关注中受支持自选'); expect(html).toContain('我的固定同业组');
        expect(html).toContain('6/21'); expect(html).toContain('全部当天日K保守排除');
        expect(html).toContain('type="checkbox"'); expect(html).toContain('<label for='); expect(html).toContain('name="name"');
    });
    it('shows semantic keyboard-scrollable table, exact date/sample/basis, fixed membership time and missing members', () => {
        const html = renderToStaticMarkup(createElement(DailyResearchTable, { data }));
        expect(html).toContain('<caption'); expect(html.match(/scope="col"/g)).toHaveLength(5); expect(html).toContain('scope="row"');
        expect(html).toContain('role="region"'); expect(html).toContain('tabindex="0"'); expect(html).toContain('overflow-auto');
        for (const disclosure of ['2026-11-07T01:00:00Z', '不代表当时成员或历史行业排名', 'US:AAPL', '+10.00%', '差 5.00 个百分点', '需 21 个共同完成日收盘点', 'qfqday', 'CNY', '2026-10-05', '标的 100 / 基准 200', '2026-11-06: 1000', '缺失不填 0']) expect(html).toContain(disclosure);
        expect(html).toContain('0 股'); expect(html).toContain('0.00 倍'); expect(html).not.toContain('<svg');
    });
    it('keeps missing latest volume distinct from a genuine reported zero', () => {
        const missing = { ...data, rows: data.rows.map(row => ({ ...row, volume: { ...row.volume, status: 'unavailable' as const, volume: undefined, ratio: undefined, missingDates: ['2026-11-07'], reason: '完整日成交量缺失' } })) };
        const html = renderToStaticMarkup(createElement(DailyResearchTable, { data: missing }));
        expect(html).toContain('最近完成日量缺失'); expect(html).toContain('完整日成交量缺失'); expect(html).not.toContain('0.00 倍');
    });
});
