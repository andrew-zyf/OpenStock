'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { updateWatchlistObservation } from '@/lib/actions/watchlist.actions';
import type { ObservationInput, ReviewStatus, WatchlistEntry } from '@/lib/watchlist-observation';
import { isReviewDate } from '@/lib/market/review-queue';
import { exchangeTimeZone } from '@/lib/market/dates';

export const REVIEW_LABELS: Record<ReviewStatus, string> = { watching: '观察中', validated: '已验证', invalidated: '已失效' };
export type ObservationDraft = { group: string; note: string; invalidation: string; targetPrice: string; reviewStatus: ReviewStatus; nextReviewDate: string; proximityPercent: string };
type Field = keyof ObservationDraft;

function draftFromEntry(entry: WatchlistEntry): ObservationDraft {
    return { group: entry.group ?? '', note: entry.note ?? '', invalidation: entry.invalidation ?? '',
        targetPrice: entry.targetPrice?.toString() ?? '', reviewStatus: entry.reviewStatus ?? 'watching',
        nextReviewDate: entry.nextReviewDate ?? '', proximityPercent: entry.proximityPercent?.toString() ?? '' };
}

export function validateObservationDraft(draft: ObservationDraft, baseline?: ObservationDraft): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    const changed = (field: Field) => !baseline || draft[field] !== baseline[field];
    if (changed('group') && draft.group.length > 80) errors.group = '自定义分组最多 80 字';
    if (changed('note') && draft.note.length > 2000) errors.note = '观察理由最多 2000 字';
    if (changed('invalidation') && draft.invalidation.length > 2000) errors.invalidation = '失效条件最多 2000 字';
    if (changed('targetPrice') && draft.targetPrice.trim() && (!Number.isFinite(Number(draft.targetPrice)) || Number(draft.targetPrice) <= 0)) {
        errors.targetPrice = '关键观察价须为大于 0 的有限数值';
    }
    if (changed('nextReviewDate') && draft.nextReviewDate && (!isReviewDate(draft.nextReviewDate) || draft.nextReviewDate < '1900-01-01')) errors.nextReviewDate = '请选择有效的复核日期';
    if (changed('proximityPercent') && draft.proximityPercent.trim() && (!Number.isFinite(Number(draft.proximityPercent)) || Number(draft.proximityPercent) < 0 || Number(draft.proximityPercent) > 100)) errors.proximityPercent = '接近范围须为 0 到 100 的百分比';
    if (changed('reviewStatus') && !Object.hasOwn(REVIEW_LABELS, draft.reviewStatus)) errors.reviewStatus = '请选择有效的复核状态';
    return errors;
}

export function observationInputFromDraft(draft: ObservationDraft, baseline?: ObservationDraft): ObservationInput {
    const values: ObservationInput = { group: draft.group.trim() || null, note: draft.note.trim() || null, invalidation: draft.invalidation.trim() || null,
        targetPrice: draft.targetPrice.trim() ? Number(draft.targetPrice) : null, reviewStatus: draft.reviewStatus,
        nextReviewDate: draft.nextReviewDate || null, proximityPercent: draft.proximityPercent.trim() ? Number(draft.proximityPercent) : null };
    if (!baseline) return values;
    return Object.fromEntries((Object.keys(draft) as Field[])
        .filter((field) => draft[field] !== baseline[field]).map((field) => [field, values[field]]));
}

export function observationTime(value?: string) {
    return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '未记录';
}

export default function ObservationEditor({ entry, currency, onSaved, onClose }: {
    entry: WatchlistEntry; currency: string; onSaved: (entry: WatchlistEntry) => void; onClose: () => void;
}) {
    const id = useId();
    const [draft, setDraft] = useState(() => draftFromEntry(entry));
    const [baseline, setBaseline] = useState(() => draftFromEntry(entry));
    const [revision, setRevision] = useState(entry.observationUpdatedAt ?? null);
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [pending, setPending] = useState(false);
    const saving = useRef(false);
    const [message, setMessage] = useState('');
    const [conflict, setConflict] = useState(false);
    const summary = useRef<HTMLParagraphElement>(null);
    const heading = useRef<HTMLLegendElement>(null);
    useEffect(() => { heading.current?.focus(); }, []);
    const controlClass = 'min-h-12 min-w-0 w-full rounded-md border border-line bg-background px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

    function change(field: Field, value: string) {
        setDraft((current) => ({ ...current, [field]: value }));
        setErrors((current) => ({ ...current, [field]: undefined }));
        if (!conflict) setMessage('');
    }
    function blur(field: Field, badInput = false) {
        setErrors((current) => ({ ...current, [field]: badInput ? (field === 'proximityPercent' ? '接近范围须为 0 到 100 的百分比' : field === 'nextReviewDate' ? '请选择有效的复核日期' : '关键观察价须为大于 0 的有限数值') : validateObservationDraft(draft, baseline)[field] }));
    }
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving.current) return;
        const nextErrors = validateObservationDraft(draft, baseline);
        const price = event.currentTarget.elements.namedItem('targetPrice') as HTMLInputElement;
        if (price.validity.badInput) nextErrors.targetPrice = '关键观察价须为大于 0 的有限数值';
        const proximity = event.currentTarget.elements.namedItem('proximityPercent') as HTMLInputElement;
        if (proximity.validity.badInput) nextErrors.proximityPercent = '接近范围须为 0 到 100 的百分比';
        const reviewDate = event.currentTarget.elements.namedItem('nextReviewDate') as HTMLInputElement;
        if (reviewDate.validity.badInput) nextErrors.nextReviewDate = '请选择有效的复核日期';
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) {
            setMessage('请修正下方字段后再保存。');
            summary.current?.focus();
            return;
        }
        if (conflict) {
            setMessage('记录已在其他页面更新。草稿仍保留，请复制草稿后重新载入页面，再核对并保存。');
            summary.current?.focus();
            return;
        }
        const input = observationInputFromDraft(draft, baseline);
        if (!Object.keys(input).length) {
            setMessage('尚未修改观察记录，无需保存。');
            return;
        }
        saving.current = true;
        setPending(true);
        setMessage('');
        try {
            const result = await updateWatchlistObservation(entry.symbol, input, revision);
            if (!result.success) {
                setConflict(result.code === 'CONFLICT');
                setMessage(result.code === 'CONFLICT'
                    ? '记录已在其他页面更新。草稿仍保留，请复制草稿后重新载入页面，再核对并保存。'
                    : '该标的已不在自选列表中。草稿仍保留，请核对列表。');
                return;
            }
            setRevision(result.entry.observationUpdatedAt ?? null);
            // Capture this submission, leaving any edits made while it was pending as a new patch.
            setBaseline(draft);
            onSaved(result.entry);
            setMessage('已保存本次提交的观察记录。提交后继续输入的内容仍为未保存草稿。');
        } catch {
            setMessage('保存失败，草稿仍保留。请检查登录或网络后重试。');
        } finally {
            saving.current = false;
            setPending(false);
            summary.current?.focus();
        }
    }

    return (
        <form method="post" onSubmit={submit} noValidate className="min-w-0 space-y-4 rounded-lg border border-line bg-surface p-4" aria-label={`${entry.symbol} 观察记录`}>
            <fieldset className="min-w-0 space-y-4">
                <legend ref={heading} tabIndex={-1} className="font-semibold text-foreground">编辑 {entry.symbol} 观察记录</legend>
                <p className="text-xs text-faint">文字与关键价均可留空，保存后清除原值。关键价仅作观察记录。</p>
                <p ref={summary} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-foreground">{message}</p>
                {(['group', 'note', 'invalidation'] as const).map((field) => {
                    const label = { group: '自定义分组', note: '观察理由', invalidation: '失效条件' }[field];
                    const maxLength = field === 'group' ? 80 : 2000;
                    const common = { id: `${id}-${field}`, name: field, value: draft[field], maxLength,
                        className: controlClass, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(field, event.target.value),
                        onBlur: () => blur(field), 'aria-invalid': Boolean(errors[field]), 'aria-describedby': `${id}-${field}-hint ${id}-${field}-error` };
                    return <div key={field} className="space-y-1">
                        <label htmlFor={`${id}-${field}`} className="block text-sm font-medium">{label}</label>
                        <p id={`${id}-${field}-hint`} className="text-xs text-faint">可选，修改后最多 {maxLength} 字{baseline[field].length > maxLength ? '；已有超长记录完整保留，未修改时不影响其他字段保存' : ''}</p>
                        {field === 'group' ? <input {...common} type="text" /> : <textarea {...common} rows={3} className={`${controlClass} resize-y`} />}
                        <p id={`${id}-${field}-error`} aria-live="polite" className="text-xs text-down">{errors[field]}</p>
                    </div>;
                })}
                <div className="space-y-1">
                    <label htmlFor={`${id}-targetPrice`} className="block text-sm font-medium">关键观察价（{currency}）</label>
                    <p id={`${id}-targetPrice-hint`} className="text-xs text-faint">可选，须大于 0；不触发价格预警。</p>
                    <input id={`${id}-targetPrice`} name="targetPrice" type="number" inputMode="decimal" min={Number.MIN_VALUE} step="any"
                        value={draft.targetPrice} onChange={(event) => change('targetPrice', event.target.value)}
                        onBlur={(event) => blur('targetPrice', event.target.validity.badInput)} className={`${controlClass} user-invalid:border-red-500`}
                        aria-invalid={Boolean(errors.targetPrice)} aria-describedby={`${id}-targetPrice-hint ${id}-targetPrice-error`} />
                    <p id={`${id}-targetPrice-error`} aria-live="polite" className="text-xs text-down">{errors.targetPrice}</p>
                </div>
                <div className="space-y-1">
                    <label htmlFor={`${id}-nextReviewDate`} className="block text-sm font-medium">下次复核日期</label>
                    <p id={`${id}-nextReviewDate-hint`} className="text-xs text-faint">按本市场日期（{exchangeTimeZone(entry.symbol)}）判断到期；留空清除期限。</p>
                    <input id={`${id}-nextReviewDate`} name="nextReviewDate" type="date" min="1900-01-01" value={draft.nextReviewDate}
                        onChange={(event) => change('nextReviewDate', event.target.value)} onBlur={(event) => blur('nextReviewDate', event.target.validity.badInput)}
                        className={controlClass} aria-invalid={Boolean(errors.nextReviewDate)} aria-describedby={`${id}-nextReviewDate-hint ${id}-nextReviewDate-error`} />
                    <p id={`${id}-nextReviewDate-error`} aria-live="polite" className="text-xs text-down">{errors.nextReviewDate}</p>
                </div>
                <div className="space-y-1">
                    <label htmlFor={`${id}-proximityPercent`} className="block text-sm font-medium">接近关键价范围（%）</label>
                    <p id={`${id}-proximityPercent-hint`} className="text-xs text-faint">双向绝对距离，0 到 100；留空恢复默认 2%。单次报价只说明接近，不判定跨越。</p>
                    <input id={`${id}-proximityPercent`} name="proximityPercent" type="number" inputMode="decimal" min="0" max="100" step="any"
                        value={draft.proximityPercent} onChange={(event) => change('proximityPercent', event.target.value)} onBlur={(event) => blur('proximityPercent', event.target.validity.badInput)}
                        className={controlClass} aria-invalid={Boolean(errors.proximityPercent)} aria-describedby={`${id}-proximityPercent-hint ${id}-proximityPercent-error`} />
                    <p id={`${id}-proximityPercent-error`} aria-live="polite" className="text-xs text-down">{errors.proximityPercent}</p>
                </div>
                <fieldset className="min-w-0 space-y-2" aria-describedby={`${id}-reviewStatus-error`}>
                    <legend className="text-sm font-medium">复核状态</legend>
                    <div className="flex flex-wrap gap-4">{(Object.entries(REVIEW_LABELS) as [ReviewStatus, string][]).map(([status, label]) => (
                        <label key={status} htmlFor={`${id}-${status}`} className="flex min-h-12 items-center gap-2 text-sm">
                            <input id={`${id}-${status}`} type="radio" name="reviewStatus" value={status} checked={draft.reviewStatus === status}
                                onChange={() => change('reviewStatus', status)} />{label}
                        </label>
                    ))}</div>
                    <p id={`${id}-reviewStatus-error`} aria-live="polite" className="text-xs text-down">{errors.reviewStatus}</p>
                </fieldset>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={pending} className="btn btn-primary min-h-12">{pending ? '保存中…' : '保存观察记录'}</button>
                <button type="button" onClick={onClose} className="btn min-h-12">关闭编辑</button>
                <span className="text-xs text-faint">关闭编辑会放弃未保存的输入。</span>
            </div>
        </form>
    );
}
