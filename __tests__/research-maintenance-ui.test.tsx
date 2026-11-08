import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ResearchMaintenance from '@/components/watchlist/ResearchMaintenance';
import type { ResearchMaintenanceStatus } from '@/lib/actions/research-maintenance.actions';

vi.mock('@/lib/actions/research-maintenance.actions', () => ({ getResearchMaintenanceStatus: vi.fn() }));
const status: ResearchMaintenanceStatus = {
    state: 'maintenance', operationLabel: '保存观察', startedAt: '2026-11-08T01:00:00.000Z', checkedAt: '2026-11-08T02:00:00.000Z',
    capability: { transactions: false }, capacity: { state: 'skipped', documents: [], truncated: false },
};

describe('research maintenance visible recovery contract', () => {
    it('keeps unknown write outcomes, affected operations and draft preservation visible', () => {
        const html = renderToStaticMarkup(<ResearchMaintenance initialStatus={status} />);
        expect(html).toContain('上一次写入结果未知'); expect(html).toContain('部分原始别名可能已经写入');
        for (const text of ['归档与恢复', '观察保存', '追加复核', '研究变化读取', '人工计划列表与到期读取', '新建及修改计划', '日期调整记录读取', '研究备份导出', '草稿复制到本地文件', '不要重复提交']) expect(html).toContain(text);
        expect(html).toContain('当前数据库拓扑不支持安全事务导入');
        expect(html).toContain('协调受阻时可能无法导出'); expect(html).toContain('未提供未经校验的原始恢复导出');
    });

    it('discloses ordered manual recovery without any unlock or raw export control', () => {
        const html = renderToStaticMarkup(<ResearchMaintenance initialStatus={status} />);
        expect(html).toMatch(/<details[^>]*><summary[^>]*>管理员人工恢复步骤<\/summary>/);
        expect(html.indexOf('先停止并确认持锁进程')).toBeLessThan(html.indexOf('从受控数据库管理入口检查'));
        expect(html.indexOf('从受控数据库管理入口检查')).toBeLessThan(html.indexOf('完成或修复该操作'));
        expect(html.indexOf('完成或修复该操作')).toBeLessThan(html.indexOf('精确令牌作为条件'));
        expect(html).not.toMatch(/<button[^>]*>[^<]*(解锁|导出|修复)/);
        expect(html).not.toMatch(/<summary[^>]*>[^]*?<h[1-6]/);
        expect(html).toContain('bg-surface'); expect(html).toContain('border-line');
    });

    it('shows unknown separately from unsupported and from zero capacity', () => {
        const html = renderToStaticMarkup(<ResearchMaintenance />);
        expect(html).toContain('协调状态未知'); expect(html).toContain('事务能力未知'); expect(html).toContain('容量未知');
        expect(html).toContain('不能按零条或零占用处理'); expect(html).not.toContain('当前数据库拓扑不支持');
        expect(html).not.toContain('未找到原始研究记录');
    });

    it('labels bounded samples and raw BSON capacity warnings without claiming merged consistency', () => {
        const initialStatus: ResearchMaintenanceStatus = { ...status, state: 'idle', operationLabel: null, startedAt: null,
            capability: { transactions: true }, capacity: { state: 'ready', truncated: true, documents: [
                { kind: 'research', id: '111111111111111111111111', symbol: 'AAPL', bytes: 11 * 1024 * 1024, entries: 300 },
                { kind: 'manual-plans', id: '222222222222222222222222', symbol: null, bytes: 1024, entries: 100 },
            ] } };
        const html = renderToStaticMarkup(<ResearchMaintenance initialStatus={initialStatus} />);
        expect(html).toContain('11.00 MiB'); expect(html).toContain('300 条原始条目'); expect(html).toContain('接近或达到研究写入保护线');
        expect(html).toContain('旧版人工计划书'); expect(html).not.toContain('当前人工计划书');
        expect(html).toContain('不包含独立计划记录、日期调整记录及其分页历史');
        expect(html).toContain('已被独立记录覆盖的原件');
        expect(html).toContain('仅显示前 50 份'); expect(html).toContain('别名不会合并计算');
        expect(html).toContain('不是同一时刻的完整快照'); expect(html).toContain('不证明恢复已验收');
        expect(html).not.toContain('上一次写入结果未知');
    });
});
