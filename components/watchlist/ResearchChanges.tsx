'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { getResearchChanges, setResearchChangeState } from '@/lib/actions/research-changes.actions';
import type { ResearchChange, ResearchChangeCategory, ResearchChangeInbox } from '@/lib/market/research-changes';
import { observationTime } from './ObservationEditor';
import { safeEvidenceURL } from './WatchlistJournal';

const labels = { pending: '待处理', processed: '已处理', snoozed: '稍后核查', ignored: '已忽略本次' };
const fieldLabels: Record<string, string> = { dueDate: '计划复核日期', checkDate: '计划检查日期', waitingCondition: '等待条件', nextAction: '下一步', factText: '事实原文', reportingPeriod: '报告期间', factType: '事实类型', sourcePublishedAt: '来源公开时间', version: '事实版本', correctionOf: '修订原卡片', date: '日期', group: '分组', note: '观察理由', invalidation: '失效条件', targetPrice: '关键价', reviewStatus: '观点状态', reviewedAt: '状态标记时间', nextReviewDate: '下次复核', proximityPercent: '接近范围（%）' };
const categories: { value: ResearchChangeCategory | ''; label: string }[] = [
    { value: '', label: '全部类别' }, { value: 'external-fact', label: '外部事件 / 事实' }, { value: 'own-edit', label: '本人编辑' },
    { value: 'plan-due', label: '计划到期' }, { value: 'review-due', label: '复核到期' },
];
const reviewLabels: Record<string, string> = { watching: '观察中', validated: '已验证', invalidated: '已失效' };
const valueText = (value: unknown): string => value == null ? '未记录' : typeof value === 'string' ? (reviewLabels[value] ?? value) : String(value);
export function changedFields(entry: Pick<ResearchChange, 'before' | 'after'>) {
    return [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])]
        .filter(key => JSON.stringify(entry.before?.[key] ?? null) !== JSON.stringify(entry.after?.[key] ?? null))
        .map(key => ({ label: fieldLabels[key] ?? key, before: valueText(entry.before?.[key]), after: valueText(entry.after?.[key]) }));
}
export default function ResearchChanges() {
    const [entries, setEntries] = useState<ResearchChange[]>([]);
    const [handled, setHandled] = useState(false);
    const [category, setCategory] = useState<ResearchChangeCategory | ''>('');
    const [readStatus, setReadStatus] = useState<ResearchChangeInbox['readStatus'] | 'unread'>('unread');
    const [readIssues, setReadIssues] = useState<ResearchChangeInbox['readIssues']>([]);
    const filterId = useId();
    const [limitations, setLimitations] = useState<string[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState('');
    const request = useRef({ generation: 0 });
    const saving = useRef(false);
    const load = useCallback(async (includeHandled: boolean) => {
        const generation = ++request.current.generation;
        setPending(true);
        try {
            const result = await getResearchChanges({ limit: 100, includeHandled, ...(category ? { category } : {}) });
            if (generation !== request.current.generation) return;
            setEntries(result.entries); setLimitations(result.limitations); setTruncated(result.truncated);
            setReadStatus(result.readStatus); setReadIssues(result.readIssues);
            setMessage(result.readStatus === 'read-failed' ? '待办范围读取失败，请核对下方说明。' : result.readStatus === 'partial' ? '仅读取了部分待办范围，请核对下方说明。' : '');
        } catch { if (generation === request.current.generation) { setReadStatus('read-failed'); setMessage('变化待办读取失败，已显示的内容是上次读取结果，本次范围尚未确认。'); } }
        finally { if (generation === request.current.generation) setPending(false); }
    }, [category]);
    useEffect(() => {
        const sequence = request.current;
        setEntries([]); setReadStatus('unread'); setReadIssues([]); setTruncated(false);
        void load(handled);
        return () => { sequence.generation++; };
    }, [handled, load]);
    useEffect(() => {
        const refresh = () => { if (!saving.current) void load(handled); };
        window.addEventListener('openstock:manual-plan-updated', refresh);
        window.addEventListener('openstock:research-facts-changed', refresh);
        return () => {
            window.removeEventListener('openstock:manual-plan-updated', refresh);
            window.removeEventListener('openstock:research-facts-changed', refresh);
        };
    }, [handled, load]);
    async function handle(entry: ResearchChange, status: 'processed' | 'ignored' | 'snoozed' | 'pending') {
        if (saving.current) return;
        saving.current = true; setPending(true);
        try {
            await setResearchChangeState({ id: entry.id, status, expectedStateVersion: entry.stateVersion,
                ...(status === 'snoozed' ? { snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : {}) });
            await load(handled);
            setMessage('已保存本次变化的处理状态。新的变化仍会重新进入待办。');
        } catch { setMessage('处理结果未确认，记录可能已在其他页面更新，请刷新核对。'); }
        finally { saving.current = false; setPending(false); }
    }
    return <section id="research-changes" className="panel min-w-0 space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">自上次处理后的变化</h2>
            <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void load(handled)}>刷新变化待办</button>
        </div>
        <p className="text-sm text-faint">确认、忽略与稍后核查只处理本次变化，不会改变观点有效性、计划状态或原检查日期。人工事实未经自动核验。事件日程每 5 分钟检查来源；取得新结果后，刷新这里查看已发现的改期。</p>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1" disabled={pending}>
            <legend className="text-sm font-medium">变化类别</legend>
            {categories.map(option => <label key={option.value} htmlFor={`${filterId}-${option.value || 'all'}`} className="flex min-h-12 items-center gap-2 text-sm">
                <input id={`${filterId}-${option.value || 'all'}`} name={`${filterId}-category`} type="radio" value={option.value} checked={category === option.value} onChange={() => setCategory(option.value)} />{option.label}
            </label>)}
        </fieldset>
        <label htmlFor={`${filterId}-handled`} className="flex min-h-12 items-center gap-2 text-sm"><input id={`${filterId}-handled`} type="checkbox" checked={handled} disabled={pending} onChange={event => setHandled(event.target.checked)} />显示已处理与稍后核查事项</label>
        <p role="status" className="text-sm">{message}</p>
        {readIssues.length > 0 && <ul className="space-y-1 text-sm text-warn">{readIssues.map(issue => <li key={issue.scope}>{issue.message}</li>)}</ul>}
        <div aria-busy={pending} className="space-y-3">
            {readStatus === 'unread' && <p className="text-sm text-faint">尚未读取本次分类范围；这不表示所有市场数据均已核验。</p>}
            {readStatus === 'read-failed' && <p className="text-sm text-warn">本次范围读取失败，不能确认是否有新增待办。</p>}
            {readStatus === 'partial' && <p className="text-sm text-warn">本次仅读取了部分范围；未成功读取的类别尚不能确认。</p>}
            {readStatus === 'read' && !entries.length && <p className="text-sm text-faint">已读取的留存范围内没有待显示的变化；这不表示所有市场数据均已核验。</p>}
            {entries.map(entry => {
                const href = entry.sourceUrl ? safeEvidenceURL(entry.sourceUrl) : undefined;
                return <article key={entry.id} className="min-w-0 space-y-2 rounded-md border border-line p-3">
                    <h3 className="break-words font-medium">{entry.symbol} · {entry.title}</h3>
                    <p className="text-xs text-faint">{labels[entry.status]} · {entry.kind === 'manual-plan-due' ? '计划创建' : entry.kind === 'manual-fact' ? '人工登记' : '发现'} {observationTime(entry.discoveredAt)} · 来源 {entry.source}</p>
                    {changedFields(entry).map(field => <details key={field.label} className="min-w-0 text-sm">
                        <summary className="cursor-pointer">{field.label}{entry.before ? '已调整 · 展开前后内容' : ' · 展开已保存内容'}</summary>
                        <dl className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
                            {entry.before && <div className="min-w-0"><dt className="text-faint">变化前</dt><dd className="whitespace-pre-wrap break-words">{field.before}</dd></div>}
                            <div className="min-w-0"><dt className="text-faint">{entry.before ? '变化后' : '已保存内容'}</dt><dd className="whitespace-pre-wrap break-words">{field.after}</dd></div>
                        </dl>
                    </details>)}
                    {entry.dueDate && <p className="text-sm">{entry.kind === 'manual-plan-due' ? '计划检查日期（市场当地）' : '复核计划日期'}：{entry.dueDate}</p>}
                    {entry.snoozedUntil && <p className="text-xs text-faint">稍后核查至 {observationTime(entry.snoozedUntil)}</p>}
                    <div className="flex flex-wrap gap-2">
                        {entry.planId && <button type="button" className="btn min-h-12" onClick={() => { window.dispatchEvent(new CustomEvent('openstock:open-plan', { detail: { id: entry.planId, symbol: entry.symbol } })); }}>查看原计划</button>}
                        <button type="button" className="btn min-h-12" onClick={() => { window.dispatchEvent(new CustomEvent('openstock:open-review', { detail: entry.factId ? { symbol: entry.symbol, evidenceReference: { kind: 'fact', id: entry.factId } } : entry.symbol })); document.getElementById('watchlist-observations')?.scrollIntoView({ block: 'start' }); }}>原判断 / 追加复核</button>
                        <Link href={`/stocks/${encodeURIComponent(entry.symbol)}`} className="btn min-h-12">查看 {entry.symbol} 依据</Link>
                        {href && <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="btn min-h-12">查看来源原文</a>}
                        <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void handle(entry, 'processed')}>标记已处理</button>
                        <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void handle(entry, 'snoozed')}>24 小时后核查</button>
                        <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void handle(entry, 'ignored')}>忽略本次变化</button>
                        {entry.status !== 'pending' && <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void handle(entry, 'pending')}>恢复待处理</button>}
                    </div>
                </article>;
            })}
        </div>
        {truncated && <p className="text-sm text-warn">结果超过返回上限；本页只展示当前返回部分。</p>}
        {limitations.length > 0 && <ul className="space-y-1 text-xs text-faint">{limitations.map(text => <li key={text}>{text}</li>)}</ul>}
    </section>;
}
