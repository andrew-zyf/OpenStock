import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ResearchFacts, { ResearchFactCard, ResearchFactForm, openFactReview } from '@/components/watchlist/ResearchFacts';
import type { ResearchFactRecord } from '@/lib/research-facts';
vi.mock('@/lib/actions/research-facts.actions', () => ({ createResearchFactForUI: vi.fn(), getFactObservationChoicesForUI: vi.fn(), getResearchFactByIdForUI: vi.fn(), getResearchFactsForUI: vi.fn() }));
const fact: ResearchFactRecord = { id: '11111111-1111-4111-8111-111111111111', symbol: 'AAPL', market: 'us', exchangeId: 'US', factType: 'earnings', reportingPeriod: 'FY2026 Q4', title: '原始财报', factText: '<script>alert(1)</script>利润原文', sourceUrl: 'https://example.com/report', sourcePublishedAt: null, createdAt: '2026-11-08T01:00:00.000Z', registrationMethod: 'manual', assessment: 'undetermined', assessmentNote: '仍需核查利润率', observationSnapshot: { recordId: '111111111111111111111111', sourceSymbol: 'AAPL', revisionId: 'original-view', journalVersion: 3, observationUpdatedAt: null, archivedAt: '2026-11-01T01:00:00.000Z', observation: { note: '最初盈利改善观点', invalidation: '盈利恶化', reviewStatus: 'watching' } }, correctionOf: null, correctionReason: null, rootId: '11111111-1111-4111-8111-111111111111', version: 1 };

describe('manual fact UI boundaries', () => {
    it('renders an SSR-safe standalone section with manual registration and no automatic verification', () => {
        const html = renderToStaticMarkup(<ResearchFacts />);
        expect(html).toContain('人工登记来源，关联原判断');
        expect(html).toContain('新增证据不会自动验证观点');
        expect(html).toContain('每页 20 条');
        expect(html).toContain('无需加入自选');
        expect(html).not.toContain('name="reviewStatus"');
    });
    it('uses native labeled controls, unknown time, explicit timezone help and separated user judgments', () => {
        const html = renderToStaticMarkup(<ResearchFactForm onSaved={vi.fn()} />);
        for (const name of ['symbol', 'factType', 'reportingPeriod', 'title', 'factText', 'sourceUrl', 'sourcePublishedAt', 'observationReference', 'assessment', 'assessmentNote']) expect(html).toContain(`name="${name}"`);
        expect(html).toContain('type="url"'); expect(html).toContain('type="radio"'); expect(html).toContain('method="post"');
        expect(html).toContain('含时区的完整时间'); expect(html).toContain('未知留空');
        expect(html).toContain('aria-describedby='); expect(html).toContain('role="status"');
        expect(html).toContain('autoCorrect="off"'); expect(html).toContain('text-base');
        expect(html).not.toContain('aria-invalid="true"'); expect(html).not.toContain('disabled=""');
        const labels = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((match) => match[1]);
        for (const label of labels) expect(html).toContain(`id="${label}"`);
    });
    it('retains original hypothesis, fact text, source time and clearly subjective assessment without raw HTML', () => {
        const html = renderToStaticMarkup(<ResearchFactCard fact={fact} onCorrect={vi.fn()} onOriginal={vi.fn()} />);
        for (const text of ['最初盈利改善观点', '盈利恶化', '关联时已归档', 'journal v3', '用户主观判断', '尚不能判断', '未知（未补造）', '人工登记保存时间', '未自动取回或核验官方来源', '追加复核', '追加更正']) expect(html).toContain(text);
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
        expect(html).toContain('原修改时间：未知');
    });
    it('correction form fixes symbol, keeps original source and requires correction reason with unique control IDs', () => {
        const html = renderToStaticMarkup(<><ResearchFactForm correction={fact} onSaved={vi.fn()} /><ResearchFactForm onSaved={vi.fn()} /></>);
        expect(html).toContain('原事实保留'); expect(html).toContain('readOnly=""');
        expect(html).toContain('name="correctionReason"'); expect(html).toContain('保留被更正事实关联的原判断快照');
        const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]); expect(new Set(ids).size).toBe(ids.length);
    });
    it('dispatches exactly one parent review evidence reference and does not create journal records', () => {
        const dispatch = vi.fn();
        vi.stubGlobal('window', { dispatchEvent: dispatch });
        try {
            openFactReview(fact);
            expect(dispatch).toHaveBeenCalledTimes(1);
            const event = dispatch.mock.calls[0][0] as CustomEvent;
            expect(event.type).toBe('openstock:open-review');
            expect(event.detail).toEqual({ symbol: 'AAPL', evidenceReference: { kind: 'fact', id: fact.id } });
        } finally { vi.unstubAllGlobals(); }
    });
});
