import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertHealthSummary } from '@/lib/alerts/health';

const state = vi.hoisted(() => ({ data: undefined as AlertHealthSummary | undefined, error: null as Error | null, stale: false, hook: vi.fn() }));
vi.mock('@/lib/actions/alert-health.actions', () => ({ getAlertHealthStatus: vi.fn() }));
vi.mock('@/hooks/useMarketResource', () => ({ useMarketResource: (options: unknown) => { state.hook(options); return state; } }));
import AlertHealthStatus from '@/components/watchlist/AlertHealthStatus';
const summary = (status: AlertHealthSummary['status']): AlertHealthSummary => ({
    status, lastStartedAt: '2026-11-08T01:00:00.000Z', lastCompletedAt: null, lastFailedAt: null,
    checkedAt: '2026-11-08T01:01:00.000Z', expectedIntervalSeconds: 300, overdueAfterSeconds: 900,
});
beforeEach(() => { vi.clearAllMocks(); state.data = undefined; state.error = null; state.stale = false; });

describe('visible health evidence', () => {
    it.each([
        ['cached-mode', '缓存行情模式'], ['unknown', '任务状态未知'], ['no-heartbeat', '尚无任务完成记录'],
        ['recent', '最近一次任务已完成'], ['overdue', '任务完成记录已逾期'], ['failed', '最近一次任务失败'],
    ] as const)('honestly renders %s', (status, text) => {
        state.data = summary(status);
        const html = renderToStaticMarkup(<AlertHealthStatus />);
        expect(html).toContain(text);
        expect(html).toContain('role="status"');
        expect(html).not.toContain('持续在线中');
        if (status !== 'cached-mode') expect(html).toContain('不代表持续在线或邮件已送达');
    });
    it('uses the shared minute refresh and explicit instant/timezone markup', () => {
        state.data = summary('no-heartbeat');
        const html = renderToStaticMarkup(<AlertHealthStatus />);
        expect(state.hook).toHaveBeenCalledWith(expect.objectContaining({ key: 'alert-job-health', intervalMs: 60_000 }));
        expect(html).toMatch(/datetime="2026-11-08T01:00:00.000Z"/i);
        expect(html).toContain('09:00');
        expect(html).toContain('UTC+8');
        expect(html).toContain('暂无记录');
    });
    it('does not announce routine initial loading and never treats it as completion', () => {
        const html = renderToStaticMarkup(<AlertHealthStatus />);
        expect(html).toContain('正在读取任务运行记录');
        expect(html).not.toContain('role="status"');
        expect(html).not.toContain('最近一次任务已完成');
    });
    it('marks retained data uncertain when a refresh fails', () => {
        state.data = summary('recent'); state.error = new Error('private error'); state.stale = true;
        const html = renderToStaticMarkup(<AlertHealthStatus />);
        expect(html).toContain('任务状态未知');
        expect(html).toContain('上次读取的记录');
        expect(html).not.toContain('private error');
        expect(html).not.toContain('最近一次任务已完成');
    });
    it('shows verified next-year scope and a concrete renewal reminder', () => {
        state.data = summary('recent');
        const html = renderToStaticMarkup(<AlertHealthStatus />);
        expect(html).toContain('2027');
        expect(html).toContain('港股、美股已核验');
        expect(html).toContain('沪市、深市、北交所、台湾上市、台湾上柜待官方日历核验');
        expect(html).toContain('2026-12-31');
        expect(html).toContain('需续期');
    });
});
