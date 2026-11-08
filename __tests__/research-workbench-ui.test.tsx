import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ResearchArchive from '@/components/watchlist/ResearchArchive';
import ResearchChanges, { changedFields } from '@/components/watchlist/ResearchChanges';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/watchlist.actions', () => ({ restoreWatchlist: vi.fn(), getWatchlistJournal: vi.fn(), appendWatchlistReview: vi.fn(), updateWatchlistObservation: vi.fn() }));
vi.mock('@/lib/actions/alert.actions', () => ({ pauseAlert: vi.fn() }));
vi.mock('@/lib/actions/research-changes.actions', () => ({ getResearchChanges: vi.fn(), setResearchChangeState: vi.fn() }));

describe('research workbench visible contracts', () => {
    it('shows the archived reason and independent alert status with distinct restore and pause actions', () => {
        const html = renderToStaticMarkup(<ResearchArchive entries={[{ symbol: '00700.HK', company: '腾讯', addedAt: '2026-11-01T00:00:00Z', archivedAt: '2026-11-08T00:00:00Z', note: '原判断', invalidation: '原失效条件', reviewStatus: 'watching' }]} alerts={[{ _id: 'one', symbol: '0700.HK', active: true }, { _id: 'two', symbol: '00700.HK', triggered: true, active: false }]} />);
        expect(html).toContain('原判断'); expect(html).toContain('原失效条件');
        expect(html).toContain('恢复关注 00700.HK'); expect(html).toContain('关联预警 2 条');
        expect(html).toContain('停用归档标的 0700.HK 预警');
        expect(html).not.toContain('停用归档标的 00700.HK 预警');
        expect(html).toContain('投递不会因停用撤回');
    });
    it('only presents changed fields, keeps explicit zero and translates review states', () => {
        expect(changedFields({ before: { note: '原判断', reviewStatus: 'watching', proximityPercent: undefined }, after: { note: '原判断', reviewStatus: 'validated', proximityPercent: 0 } })).toEqual([
            { label: '观点状态', before: '观察中', after: '已验证' }, { label: '接近范围（%）', before: '未记录', after: '0' },
        ]);
        expect(changedFields({ before: { note: null }, after: {} })).toEqual([]);
    });
    it('distinguishes an empty retained inbox from verified absence of market changes', () => {
        const html = renderToStaticMarkup(<ResearchChanges />);
        expect(html).toContain('这不表示所有市场数据均已核验');
        expect(html).toContain('不会改变观点有效性');
        expect(html).toContain('显示已处理与稍后核查事项');
        expect(html).toContain('尚未读取本次分类范围');
        expect(html).not.toContain('已读取的留存范围内没有待显示的变化');
        expect(html).toContain('计划状态或原检查日期');
        expect(html).toContain('人工事实未经自动核验');
    });
    it('exposes five native, explicitly labelled category choices and keeps the handled filter separate', () => {
        const html = renderToStaticMarkup(<ResearchChanges />);
        expect(html).toContain('<legend class="text-sm font-medium">变化类别</legend>');
        for (const label of ['全部类别', '外部事件 / 事实', '本人编辑', '计划到期', '复核到期']) expect(html).toContain(label);
        const radios = [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map(match => match[0]);
        expect(radios).toHaveLength(5);
        expect(new Set(radios.map(input => /\bname="([^"]+)"/.exec(input)?.[1])).size).toBe(1);
        for (const radio of radios) expect(html).toContain(`for="${/\bid="([^"]+)"/.exec(radio)?.[1]}"`);
        expect(html).not.toContain('role="tab"');
    });
});
