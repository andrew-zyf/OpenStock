import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ManualPlans, { ManualPlanCard, ManualPlanForm, mergeManualPlans } from '@/components/watchlist/ManualPlans';
import type { ManualPlan } from '@/lib/manual-plan';
vi.mock('@/lib/actions/manual-plan.actions', () => ({ createManualPlan: vi.fn(), getManualPlan: vi.fn(), getManualPlans: vi.fn(), getManualPlanScheduleHistory: vi.fn(), updateManualPlan: vi.fn() }));
const plan: ManualPlan = { id: '11111111-1111-4111-8111-111111111111', symbol: 'AAPL', waitingCondition: '等待原始公告', invalidation: '原假设失效', nextAction: '人工核查', checkDate: '2026-11-09', manualState: 'waiting', version: 1, scheduleRevision: 1, createdAt: '2026-11-08T01:00:00Z', updatedAt: '2026-11-08T01:00:00Z' };

describe('manual plan accessible UI and independent states', () => {
    it('renders an SSR-safe standalone entry point with the explicit disclaimer and retained capacity', () => {
        const html = renderToStaticMarkup(<ManualPlans />);
        expect(html).toContain('人工计划，不代表持仓或成交');
        expect(html).toContain('计划状态与观察复核状态独立');
        expect(html).toContain('最多同时保留 100 条等待中的计划');
        expect(html).toContain('历史分页保留，不占活动容量');
        expect(html).toContain('aria-label="人工计划分页"');
        expect(html).toContain('上一页'); expect(html).toContain('下一页');
        expect(html).toContain('已完成与已取消历史');
        expect(html).toContain('新建人工计划');
        expect(html).not.toContain('name="quantity"'); expect(html).not.toContain('name="reviewStatus"');
    });
    it('labels all named required controls and retains native constraints without premature validation', () => {
        const html = renderToStaticMarkup(<ManualPlanForm items={[{ symbol: 'AAPL', company: 'Apple' }]} onSaved={vi.fn()} />);
        expect(html).toContain('method="post"');
        for (const name of ['symbol', 'waitingCondition', 'invalidation', 'nextAction', 'checkDate']) {
            expect(html).toContain(`name="${name}"`); expect(html).toContain(`<label for=`);
        }
        expect(html.match(/required=""/g)).toHaveLength(5);
        expect(html).toContain('maxLength="2000"'); expect(html).toContain('type="date"');
        expect(html).toContain('America/New_York'); expect(html).toContain('自然日');
        expect(html).toContain('aria-describedby='); expect(html).toContain('aria-live="polite"');
        expect(html).toContain('type="submit"'); expect(html).toContain('text-base');
        expect(html).toContain('autoCorrect="off"'); expect(html).toContain('spellCheck="false"');
        expect(html).not.toContain('disabled=""'); expect(html).not.toContain('aria-invalid="true"');
    });
    it('uses unique form identifiers and an immutable symbol when editing an existing record', () => {
        const html = renderToStaticMarkup(<><ManualPlanForm plan={plan} onSaved={vi.fn()} /><ManualPlanForm onSaved={vi.fn()} /></>);
        const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
        expect(new Set(ids).size).toBe(ids.length);
        expect(html).toContain('readOnly=""'); expect(html).toContain('value="2026-11-09"');
        expect(html).toContain('等待原始公告'); expect(html).toContain('保存修改');
    });
    it('shows manual terminal states as retained records with their full research content', () => {
        for (const manualState of ['completed', 'cancelled'] as const) {
            const html = renderToStaticMarkup(<ManualPlanCard plan={{ ...plan, manualState }} busy={false} onEdit={vi.fn()} onState={vi.fn()} />);
            expect(html).toContain(manualState === 'completed' ? '已完成' : '已取消');
            expect(html).toContain('等待原始公告'); expect(html).toContain('原假设失效'); expect(html).toContain('人工核查');
            expect(html).toContain('编辑'); expect(html).not.toContain('标记完成'); expect(html).not.toContain('取消计划');
            expect(html).not.toContain('已验证'); expect(html).not.toContain('已失效');
        }
    });
    it('escapes user text and provides contextual action names and a calendar date without conversion', () => {
        const html = renderToStaticMarkup(<ManualPlanCard plan={{ ...plan, waitingCondition: '<img src=x onerror=alert(1)>' }} busy={false} onEdit={vi.fn()} onState={vi.fn()} />);
        expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
        expect(html).toContain('dateTime="2026-11-09"');
        expect(html).toContain('aria-label="编辑 AAPL 计划（2026-11-09）"');
        expect(html).toContain('aria-label="标记完成 AAPL 计划（2026-11-09）"');
        expect(html).toContain('aria-label="取消计划 AAPL（2026-11-09）"');
    });
    it('retains the referenced observation text and completion basis on terminal cards', () => {
        const html = renderToStaticMarkup(<ManualPlanCard plan={{ ...plan, manualState: 'completed', stateReason: '核查原始公告', observationVersionId: 'old-version', observationSnapshot: { recordedAt: '2026-11-07T01:00:00Z', note: '创建时的判断', invalidation: '创建时的反证' } }} busy={false} onEdit={vi.fn()} onState={vi.fn()} />);
        expect(html).toContain('核查原始公告'); expect(html).toContain('old-version');
        expect(html).toContain('创建时的判断'); expect(html).toContain('创建时的反证'); expect(html).toContain('计划条件不会自动覆盖');
    });
    it('offers optional version association and a reason field without premature required errors', () => {
        const create = renderToStaticMarkup(<ManualPlanForm onSaved={vi.fn()} />);
        expect(create).toContain('name="observationVersionId"'); expect(create).toContain('留空可独立创建');
        const edit = renderToStaticMarkup(<ManualPlanForm plan={plan} onSaved={vi.fn()} />);
        expect(edit).toContain('name="scheduleReason"'); expect(edit).toContain('修改日期时必填');
        expect(edit.match(/required=""/g)).toHaveLength(5);
        expect(edit).not.toContain('aria-invalid="true"');
    });
    it('prefills an original-version creation without sharing identifiers or replacing another form', () => {
        const html = renderToStaticMarkup(<><ManualPlanForm onSaved={vi.fn()} /><ManualPlanForm source={{ symbol: '2330.TW', observationVersionId: 'saved-old-version' }} onSaved={vi.fn()} /></>);
        expect(html).toContain('value="2330.TW"'); expect(html).toContain('value="saved-old-version"');
        const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
        expect(new Set(ids).size).toBe(ids.length);
    });
    it('renders retained terminal-action drafts with required labeled reason controls', () => {
        const html = renderToStaticMarkup(<ManualPlanCard plan={plan} busy={false} draft={{ state: 'cancelled', reason: '未保存的取消原因' }} onDraft={vi.fn()} onEdit={vi.fn()} onState={vi.fn()} />);
        expect(html).toContain('未保存的取消原因'); expect(html).toContain('name="stateReason"');
        expect(html).toContain('保存取消原因'); expect(html).toContain('取消原因（必填）');
        expect(html).toContain('required=""'); expect(html).not.toContain('aria-invalid="true"');
    });
    it('does not let a late read replace a completed local edit or drop retained records', () => {
        const newer = { ...plan, version: 2, manualState: 'completed' as const, nextAction: '新行动' };
        const another = { ...plan, id: 'another', symbol: '2330.TW' };
        expect(mergeManualPlans([newer, another], [plan])).toEqual([newer, another]);
        expect(mergeManualPlans([plan], [newer, newer])).toEqual([newer]);
    });
});
