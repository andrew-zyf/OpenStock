import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchImportPreview } from '@/lib/research-backup';
import ResearchBackup from '@/components/watchlist/ResearchBackup';
import { v2Fixture } from './fixtures/research-backup-v2';

let suppliedPreview: ResearchImportPreview | null = null;
vi.mock('react', async (original) => {
    const react = await original<typeof React>();
    return { ...react, useState: <T,>(initial: T) => react.useState(initial === null ? suppliedPreview as T : initial) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/research-backup.actions', () => ({ exportResearchBackupForUI: vi.fn(), importResearchBackupForUI: vi.fn(), previewResearchBackupImportForUI: vi.fn() }));
beforeEach(() => { suppliedPreview = null; });

describe('backup v2 preview and capability UI', () => {
    it('explains retained v2 scope, v1 compatibility and independent collection reads before upload', () => {
        const html = renderToStaticMarkup(<ResearchBackup />);
        for (const copy of ['JSON v2', '兼容导入 JSON v1', '人工计划与改期历史', '人工事实卡片', '已保存对照证据', '不保证跨集合处于同一时点', '临时对照草稿', '单机模式只可导出和预览']) expect(html).toContain(copy);
        expect(html).toContain('type="file"'); expect(html).toContain('required=""'); expect(html).toContain('aria-describedby=');
        expect(html).not.toContain('确认导入缺少的记录');
    });
    it('shows collection manifests and standalone unsupported status before a disabled import confirmation', () => {
        suppliedPreview = { digest: 'digest', version: 2, capture: v2Fixture().capture, referenceAlerts: 2, research: [], manualEvents: [],
            capability: { status: 'unsupported', message: '当前单机 MongoDB 不支持自动导入' },
            workbench: [{ collection: 'changeStates', id: 'unresolved-state', status: 'skip-unsupported' }, { collection: 'factCards', id: 'fact', status: 'skip-related' }] };
        const html = renderToStaticMarkup(<ResearchBackup />);
        expect(html).toContain('当前单机 MongoDB 不支持自动导入'); expect(html).toContain('查看集合数量、版本及取样范围');
        expect(html).toContain('人工计划（含历史）'); expect(html).toContain('模式 v1'); expect(html).toContain('源记录 1 条');
        expect(html).toContain('缺少可安全还原的处理目标'); expect(html).toContain('关联证据组存在冲突');
        expect(html).toMatch(/<input(?=[^>]*name="confirm")(?=[^>]*disabled="")[^>]*>/);
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>确认导入缺少的记录/);
        expect(html).toContain('2 条提醒参考不会导入');
    });
});
