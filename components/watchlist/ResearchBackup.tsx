'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { exportResearchBackupForUI, importResearchBackupForUI, previewResearchBackupImportForUI } from '@/lib/actions/research-backup.actions';
import type { ResearchImportPreview } from '@/lib/research-backup';

const MAX_BYTES = 32 * 1024 * 1024;
const buttonClass = 'btn min-h-12 disabled:opacity-50';
export default function ResearchBackup() {
    const id = useId();
    const router = useRouter();
    const pending = useRef(false);
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<ResearchImportPreview | null>(null);
    const [json, setJson] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const fail = () => setError('研究备份请求未完成，请确认文件可读、登录有效后重试。');

    async function download() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true); setError(''); setMessage('');
        try {
            const response = await exportResearchBackupForUI();
            if (!response.success) { setError(response.error); return; }
            const url = URL.createObjectURL(new Blob([response.data], { type: 'application/json;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url; link.download = `openstock-research-v2-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage('完整研究 JSON 已下载，请妥善保存其中的私人笔记。');
        } catch { fail(); }
        finally { pending.current = false; setBusy(false); }
    }
    async function inspect(data: FormData) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true); setError(''); setMessage('');
        try {
            const file = data.get('backup');
            if (!(file instanceof File) || !file.size) { setError('请选择 JSON 备份文件'); return; }
            if (file.size > MAX_BYTES) { setError('备份文件须小于 32 MiB'); return; }
            const text = await file.text();
            const response = await previewResearchBackupImportForUI(text);
            if (!response.success) { setError(response.error); return; }
            setJson(text); setPreview(response.data);
        } catch { fail(); }
        finally { pending.current = false; setBusy(false); }
    }
    async function restore(data: FormData) {
        if (pending.current || !preview || data.get('confirm') !== 'yes') return;
        pending.current = true;
        setBusy(true); setError(''); setMessage('');
        try {
            const response = await importResearchBackupForUI(json, preview.digest);
            if (!response.success) { setError(response.error); return; }
            const result = response.data;
            const research = result.research.filter((item) => item.status === 'import').length;
            const events = result.manualEvents.filter((item) => item.status === 'import').length;
            const saved = result.workbench?.filter((item) => item.status === 'import').length ?? 0;
            const skipped = result.research.length + result.manualEvents.length + (result.workbench?.length ?? 0) - research - events - saved;
            setMessage(`导入完成：${research} 个归档标的、${events} 条手动事件、${saved} 条工作台记录；跳过 ${skipped} 项。已按导入时的账户状态重新检查冲突，相关证据整组保留或跳过。提醒仅保留在下载文件中。`);
            setPreview(null); setJson(''); router.refresh();
        } catch { fail(); }
        finally { pending.current = false; setBusy(false); }
    }
    const conflicts = preview?.research.filter((item) => item.status !== 'import') || [];
    const eventSkips = preview?.manualEvents.filter((item) => item.status !== 'import') || [];
    const workbenchSkips = preview?.workbench?.filter((item) => item.status !== 'import') || [];
    const labels: Record<string, string> = { research: '原始研究', manualEvents: '手动事件', alertReferences: '提醒参考', manualPlans: '人工计划（含历史）', planSchedules: '计划改期历史', peerGroups: '固定同业／主题组', eventHistories: '事件版本', changeStates: '变化处理状态', factCards: '人工事实卡片', comparisons: '已保存对照证据' };
    const reasons: Record<string, string> = { 'skip-existing': '稳定身份或请求已存在', 'skip-capacity': '活动容量不足', 'skip-related': '关联证据组存在冲突', 'skip-unsupported': '缺少可安全还原的处理目标' };
    const unsupported = preview?.capability?.status === 'unsupported';
    return <section id="research-backup" aria-labelledby={`${id}-title`} className="rounded-xl border border-line bg-surface p-4 text-foreground sm:p-5">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-foreground">研究备份与导入</h2>
        <p id={`${id}-help`} className="mt-2 text-sm leading-6 text-faint">JSON v2 包含全部活跃及归档研究、原始别名、完整已留存观察与更正历史、初始快照、含撤销记录的手动事件，以及人工计划与改期历史、固定同业／主题组、事件版本与处理状态、人工事实卡片和已保存对照证据。提醒触发和通知状态仅供参考，导入不会重建提醒、发送通知或运行任务。</p>
        <p className="mt-1 text-sm text-faint">兼容导入 JSON v1。缺少的研究默认归档；已有身份及相关证据整组跳过，不覆盖。各集合清单分别记录数量、模式版本和取样时间范围，不保证跨集合处于同一时点。临时对照草稿与源存储已裁剪的旧版本不在范围内。</p>
        <p className="mt-1 text-sm text-faint">文件上限 32 MiB；超过容量或含无法安全恢复的旧数据时，导出会报错并保留原记录，不截断历史。导入需要支持事务的 MongoDB 副本集，单机模式只可导出和预览。</p>
        <button type="button" className={`${buttonClass} mt-4`} disabled={busy} onClick={download}>下载完整 JSON</button>
        <form onSubmit={(event) => { event.preventDefault(); void inspect(new FormData(event.currentTarget)); }} className="mt-5">
            <fieldset disabled={busy} className="space-y-3">
                <legend className="mb-2 text-sm font-medium text-foreground">选择文件并在服务器校验</legend>
                <label htmlFor={`${id}-file`} className="block text-sm text-foreground">JSON 备份文件（必填，最多 32 MiB）</label>
                <input id={`${id}-file`} name="backup" type="file" accept=".json,application/json" required aria-describedby={`${id}-help`} className="block min-h-12 w-full max-w-full rounded-lg border border-line p-2 text-base text-foreground file:mr-3 file:rounded file:border-0 file:bg-background file:px-3 file:py-2 file:text-foreground" onChange={() => { setPreview(null); setJson(''); setError(''); setMessage(''); }} />
                <button type="submit" className={buttonClass}>{busy ? '处理中…' : '校验并预览'}</button>
            </fieldset>
        </form>
        {preview && <form onSubmit={(event) => { event.preventDefault(); void restore(new FormData(event.currentTarget)); }} className="mt-5 space-y-3 border-t border-line pt-4">
            <p className="text-sm font-medium">JSON v{preview.version ?? 1} · {preview.capability?.message ?? '导入仅使用事务；单机部署不支持。'}</p>
            {preview.capture && <details className="text-sm leading-6 text-faint"><summary className="min-h-12 cursor-pointer py-3">查看集合数量、版本及取样范围</summary><p>各集合独立读取，不构成跨集合同一时点快照。总体范围：{preview.capture.startedAt} 至 {preview.capture.completedAt}。</p><ul className="space-y-3">{Object.entries(preview.capture.collections).map(([name, capture]) => <li key={name}><p>{labels[name] ?? name}：{capture.count} 条，源记录 {capture.sourceCount} 条，模式 v{capture.schemaVersion}</p><p className="break-words">{capture.startedAt} 至 {capture.completedAt}；{capture.scope}</p>{capture.retainedVersions !== undefined && <p>已留存 {capture.retainedVersions} 个事件版本；源库已不含 {capture.unavailableVersions ?? 0} 个较早版本。</p>}{capture.unresolvedTargets !== undefined && <p>其中 {capture.unresolvedTargets} 条处理状态无法关联到已留存目标，自动导入将明确跳过。</p>}{capture.limitations.map((note) => <p key={note}>{note}</p>)}</li>)}</ul>{preview.capture.unsupported.map((note) => <p key={note}>{note}</p>)}</details>}
            <p className="text-sm text-foreground">可导入 {preview.research.filter((item) => item.status === 'import').length} 个标的、{preview.manualEvents.filter((item) => item.status === 'import').length} 条手动事件；{preview.referenceAlerts} 条提醒参考不会导入。</p>
            {conflicts.length > 0 && <div className="text-sm text-faint"><p>以下 {conflicts.length} 个标的已有记录或关联证据冲突，整组跳过：</p><ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{conflicts.slice(0, 50).map((item) => <li key={item.symbol}>{item.symbol}（{item.records} 份原始记录）</li>)}</ul>{conflicts.length > 50 && <p>另有 {conflicts.length - 50} 个冲突标的。</p>}</div>}
            {eventSkips.length > 0 && <div className="text-sm text-faint"><p>跳过 {eventSkips.length} 条手动事件：</p><ul className="list-inside list-disc">{eventSkips.slice(0, 20).map((item) => <li key={item.id}>{item.title}：{item.status === 'skip-capacity' ? '有效事件上限 100 条' : '已有记录或撤销记录'}</li>)}</ul>{eventSkips.length > 20 && <p>另有 {eventSkips.length - 20} 条。</p>}</div>}
            {preview.workbench && <p className="text-sm">可导入 {preview.workbench.filter((item) => item.status === 'import').length} 条工作台记录；跳过 {workbenchSkips.length} 条。</p>}
            {workbenchSkips.length > 0 && <ul className="list-inside list-disc break-words text-sm text-faint">{workbenchSkips.slice(0, 30).map((item) => <li key={`${item.collection}:${item.id}`}>{labels[item.collection]} {item.id}：{reasons[item.status]}</li>)}{workbenchSkips.length > 30 && <li>另有 {workbenchSkips.length - 30} 条跳过记录。</li>}</ul>}
            <label className="flex min-h-12 items-start gap-3 text-sm leading-6 text-foreground"><input name="confirm" type="checkbox" value="yes" required disabled={busy || unsupported} className="mt-1 size-4 shrink-0 accent-yellow-400" />我确认将缺少的研究导入当前账户并归档，已有记录及冲突证据组跳过；手动事件保留原撤销状态，提醒不导入。</label>
            <button type="submit" disabled={busy || unsupported} className={buttonClass}>{busy ? '正在导入…' : '确认导入缺少的记录'}</button>
        </form>}
        <p aria-live="polite" role="status" className="mt-3 text-sm leading-6 text-foreground">{message}</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    </section>;
}
