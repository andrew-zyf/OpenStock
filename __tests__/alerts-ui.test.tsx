import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/lib/market-data', () => ({ get alertsEnabled() { return flags.enabled; } }));
vi.mock('@/lib/actions/alert.actions', () => ({ createAlert: vi.fn(), deleteAlert: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Render modal contents without opening a browser or invoking a server action.
vi.mock('@/components/ui/dialog', () => {
    const wrap = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
    return { Dialog: wrap, DialogContent: wrap, DialogDescription: wrap, DialogTitle: wrap, DialogTrigger: wrap };
});
import CreateAlertModal from '@/components/watchlist/CreateAlertModal';
import AlertsPanel from '@/components/watchlist/AlertsPanel';
beforeEach(() => { flags.enabled = true; });

describe('accessible, honest alert UI', () => {
    it('renders named controls, visible labels, native ranges and enabled submit before interaction', () => {
        const html = renderToStaticMarkup(<CreateAlertModal symbol="2330.TW" currency="TWD" />);
        expect(html).toContain('method="post"');
        expect(html).toContain('<fieldset>');
        for (const name of ['targetPrice', 'expiresInDays', 'condition']) expect(html).toContain(`name="${name}"`);
        expect(html).toContain('min="5e-324"');
        expect(html).toContain('max="90"');
        expect(html).toContain('aria-describedby=');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('type="submit"');
        expect(html).not.toContain('disabled=');
        expect(html).not.toContain('aria-invalid="true"');
        expect(html).toContain('首个有效采样只作基准');
        expect(html).toContain('Inngest');
        expect(html).toContain('短暂穿越可能漏检');
        expect(html).not.toContain('下次轮询时将触发');
    });
    it('explains cached-mode dependencies and unsupported instruments without a create form', () => {
        flags.enabled = false;
        let html = renderToStaticMarkup(<CreateAlertModal symbol="AAPL" />);
        expect(html).toContain('当前为缓存行情模式');
        expect(html).not.toContain('<form');
        flags.enabled = true;
        html = renderToStaticMarkup(<CreateAlertModal symbol="830799.BJ" />);
        expect(html).toContain('此标的暂不支持价格预警');
        expect(html).not.toContain('<form');
    });
    it('separates the trigger event from failed, skipped, pending and submitted email', () => {
        const base = { symbol: '09988.HK', targetPrice: 100, condition: 'ABOVE' as const, triggered: true, mode: 'crossing' as const };
        const html = renderToStaticMarkup(<AlertsPanel alerts={[
            { ...base, _id: 'failed', delivery: { status: 'failed', reason: 'email-send-failed' } },
            { ...base, _id: 'skipped', delivery: { status: 'skipped', reason: 'email-not-configured' } },
            { ...base, _id: 'pending', delivery: { status: 'pending', attemptedAt: '2026-11-09T02:00:00.000Z' } },
            { ...base, _id: 'sent', delivery: { status: 'sent' } },
        ]} />);
        for (const label of ['邮件失败', '邮件未发送', '邮件待确认', '邮件已提交', '结果未确认', '不自动重发', 'HK$100.00']) expect(html).toContain(label);
        expect(html).not.toContain('邮件已送达');
    });
    it('labels old semantics and avoids asserting that the server worker is online', () => {
        const html = renderToStaticMarkup(<AlertsPanel alerts={[
            { _id: 'legacy', symbol: 'AAPL', targetPrice: 100, condition: 'BELOW' },
            { _id: 'seed', symbol: '2330.TW', targetPrice: 100, condition: 'ABOVE', mode: 'crossing' },
        ]} />);
        expect(html).toContain('旧版：达到或低于');
        expect(html).toContain('待首个有效采样');
        expect(html).toContain('不代表服务器任务在线');
        expect(html).not.toContain('监控中');
    });
});
