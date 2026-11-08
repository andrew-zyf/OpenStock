'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { appendWatchlistReview, getWatchlistJournal } from '@/lib/actions/watchlist.actions';
import type { WatchlistEntry } from '@/lib/watchlist-observation';
import { isMarketDate, REVIEW_LIMITS, type ResearchEvidenceReference, type WatchlistJournalEntry, type WatchlistReview, type WatchlistReviewInput } from '@/lib/watchlist-review';
import ResearchEvidenceDetails from './ResearchEvidenceDetails';
import { exchangeDateForSymbol, exchangeTimeZone } from '@/lib/market/dates';
import { observationTime, REVIEW_LABELS } from './ObservationEditor';

const TYPES = { price: '价格验证', fact: '事实验证', judgment: '判断复核' } as const;
export type ReviewDraft = { tradingDate: string; hypothesis: string; changes: string; conclusion: string; verificationType: string; evidenceURLs: string; nextReviewDate: string };
const EMPTY: ReviewDraft = { tradingDate: '', hypothesis: '', changes: '', conclusion: '', verificationType: 'judgment', evidenceURLs: '', nextReviewDate: '' };
type Errors = Partial<Record<keyof ReviewDraft, string>>;

export function safeEvidenceURL(value: string): string | undefined {
    try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { /* Display unsafe stored values as text. */ }
}

export function validateReviewDraft(draft: ReviewDraft, today?: string): Errors {
    const errors: Errors = {};
    if (!isMarketDate(draft.tradingDate)) errors.tradingDate = '请选择本次复核对应的交易日期';
    else if (today && draft.tradingDate > today) errors.tradingDate = '复核日期不能晚于本市场今天';
    for (const field of ['hypothesis', 'changes', 'conclusion'] as const) {
        if (!draft[field].trim() || draft[field].length > REVIEW_LIMITS.text) errors[field] = `请填写 1 到 ${REVIEW_LIMITS.text} 字`;
    }
    if (!Object.hasOwn(TYPES, draft.verificationType)) errors.verificationType = '请选择有效的验证类型';
    const urls = draft.evidenceURLs.split('\n').map(url => url.trim()).filter(Boolean);
    if (urls.length > REVIEW_LIMITS.evidenceURLs || urls.some(url => url.length > REVIEW_LIMITS.url || !safeEvidenceURL(url))) errors.evidenceURLs = '最多 10 个 HTTP/HTTPS 链接，每行一个，不能包含账号密码';
    if (draft.nextReviewDate && !isMarketDate(draft.nextReviewDate)) errors.nextReviewDate = '请选择有效的下次复核日期';
    return errors;
}

export function reviewInputFromDraft(draft: ReviewDraft, clientRequestId: string, correctionOf?: string, evidenceReferences?: ResearchEvidenceReference[]): WatchlistReviewInput {
    return { tradingDate: draft.tradingDate, hypothesis: draft.hypothesis.trim(), changes: draft.changes.trim(), conclusion: draft.conclusion.trim(),
        verificationType: draft.verificationType as WatchlistReviewInput['verificationType'],
        evidenceURLs: draft.evidenceURLs.split('\n').map(url => url.trim()).filter(Boolean), clientRequestId,
        ...(draft.nextReviewDate ? { nextReviewDate: draft.nextReviewDate } : {}), ...(correctionOf ? { correctionOf } : {}),
        ...(evidenceReferences?.length ? { evidenceReferences } : {}) };
}

export function mergeJournalEntries(current: WatchlistJournalEntry[], incoming: WatchlistJournalEntry[]): WatchlistJournalEntry[] {
    const entries = new Map(current.map(entry => [`${entry.kind}:${entry.id}`, entry]));
    for (const entry of incoming) entries.set(`${entry.kind}:${entry.id}`, entry);
    return [...entries.values()].sort((a, b) => (b.kind === 'review' ? b.createdAt : b.recordedAt).localeCompare(a.kind === 'review' ? a.createdAt : a.recordedAt) || b.id.localeCompare(a.id));
}

export function JournalRecord({ entry, onCorrect, symbol }: { entry: WatchlistJournalEntry; onCorrect?: (review: WatchlistReview) => void; symbol?: string }) {
    if (entry.kind === 'observation') return <article className="min-w-0 space-y-2 rounded-md border border-line p-3 text-sm">
        <h4 className="font-medium">历史观点 · {entry.source === 'legacy-capture' ? '旧记录留存' : '观察版本'}</h4>
        <p className="text-xs text-faint">修改时间：{entry.modifiedAt ? observationTime(entry.modifiedAt) : '未知（不以加入时间代替）'} · 留存：{observationTime(entry.recordedAt)}</p>
        <dl className="space-y-2 break-words whitespace-pre-wrap">
            <div><dt className="text-faint">观察理由</dt><dd>{entry.observation.note || '未记录'}</dd></div>
            <div><dt className="text-faint">失效条件</dt><dd>{entry.observation.invalidation || '未记录'}</dd></div>
            <div><dt className="text-faint">分组 / 状态</dt><dd>{entry.observation.group || '未分组'} · {REVIEW_LABELS[entry.observation.reviewStatus]}</dd></div>
            <div><dt className="text-faint">关键价 / 接近范围 / 下次日期</dt><dd>{entry.observation.targetPrice ?? '未设置'} / {entry.observation.proximityPercent ?? 2}% / {entry.observation.nextReviewDate || '未设置'}</dd></div>
        </dl>
        {symbol && <button type="button" className="btn min-h-12" onClick={() => window.dispatchEvent(new CustomEvent('openstock:open-plan', { detail: { symbol, observationVersionId: entry.id } }))}>基于此观点创建人工计划</button>}
    </article>;
    return <article id={`review-${entry.id}`} className="min-w-0 space-y-2 rounded-md border border-line p-3 text-sm">
        <h4 className="font-medium">{entry.correctionOf ? '更正复核' : '复核记录'} · {entry.tradingDate} · {TYPES[entry.verificationType]}</h4>
        <p className="break-all text-xs text-faint">记录编号：{entry.id} · 追加：{observationTime(entry.createdAt)}</p>
        {entry.correctionOf && <p className="break-all text-xs text-faint">更正原记录：{entry.correctionOf}；原文保留，可能位于更早分页。</p>}
        <dl className="space-y-2 whitespace-pre-wrap break-words">{(['hypothesis', 'changes', 'conclusion'] as const).map(field => <div key={field}><dt className="text-faint">{{ hypothesis: '当时假设', changes: '发生变化', conclusion: '复核结论' }[field]}</dt><dd>{entry[field]}</dd></div>)}</dl>
        <p className="text-xs text-faint">下次复核：{entry.nextReviewDate === null ? '已清除计划' : entry.nextReviewDate || '本条未调整计划'}</p>
        {entry.sourceQuote && <p className="text-xs text-faint">提交时行情参考（非所选交易日的历史证据）：{entry.sourceQuote.price} {entry.sourceQuote.currency} · {entry.sourceQuote.source} · {observationTime(entry.sourceQuote.asOf)}</p>}
        {!!entry.evidenceURLs.length && <ul aria-label="证据链接" className="space-y-1">{entry.evidenceURLs.map((value, index) => {
            const href = safeEvidenceURL(value);
            return <li key={`${value}-${index}`} className="break-all">{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{href}</a> : <span>{value}（无效链接）</span>}</li>;
        })}</ul>}
        {!!entry.evidenceReferences?.length && <ul aria-label="已留存研究证据" className="space-y-2">{entry.evidenceReferences.map(reference => <li key={`${reference.kind}:${reference.id}`}>{symbol ? <ResearchEvidenceDetails symbol={symbol} reference={reference} /> : <span>{reference.kind === 'fact' ? '事实卡片' : '盘后对照'} · {reference.id}</span>}</li>)}</ul>}
        {onCorrect && <button type="button" className="btn min-h-12 text-xs" onClick={() => onCorrect(entry)}>追加更正（保留原文）</button>}
    </article>;
}

export default function WatchlistJournal({ entry, onSaved, onClose, evidenceReferences }: { entry: WatchlistEntry; onSaved: (entry: WatchlistEntry) => void; onClose: () => void; evidenceReferences?: ResearchEvidenceReference[] }) {
    const id = useId();
    const [entries, setEntries] = useState<WatchlistJournalEntry[]>([]);
    const [cursor, setCursor] = useState<string>();
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const loadingRef = useRef(false);
    const alive = useRef(true);
    const [draft, setDraft] = useState<ReviewDraft>({ ...EMPTY });
    const [correction, setCorrection] = useState<string>();
    const [references, setReferences] = useState<ResearchEvidenceReference[]>(evidenceReferences ?? []);
    useEffect(() => {
        if (!evidenceReferences?.length) return;
        setReferences(current => {
            const combined = new Map(current.map(reference => [`${reference.kind}:${reference.id}`, reference]));
            for (const reference of evidenceReferences) combined.set(`${reference.kind}:${reference.id}`, reference);
            return [...combined.values()];
        });
    }, [evidenceReferences]);
    const [errors, setErrors] = useState<Errors>({});
    const [pending, setPending] = useState(false);
    const saving = useRef(false);
    // Retain the exact payload and id on ambiguous failures; a retry cannot duplicate a review.
    const attempt = useRef<{ fingerprint: string; input: WatchlistReviewInput } | null>(null);
    const submittedFingerprint = useRef<string | undefined>(undefined);
    const [message, setMessage] = useState('');
    const summary = useRef<HTMLParagraphElement>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const hypothesisControl = useRef<HTMLTextAreaElement>(null);
    const [today, setToday] = useState<string>();
    const zone = exchangeTimeZone(entry.symbol);
    const controlClass = 'min-h-12 min-w-0 w-full rounded-md border border-line bg-background px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

    async function load(before?: string) {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true); setLoadError('');
        try {
            const result = await getWatchlistJournal(entry.symbol, { limit: 10, ...(before ? { before } : {}) });
            if (!alive.current) return;
            if (!result.success) { setLoadError(result.error); return; }
            setEntries(current => mergeJournalEntries(current, result.entries));
            setCursor(result.nextCursor); setLoaded(true);
        } catch { if (alive.current) setLoadError('历史加载失败，请重试。已加载记录仍保留。'); }
        finally { loadingRef.current = false; if (alive.current) setLoading(false); }
    }
    useEffect(() => {
        alive.current = true;
        heading.current?.focus();
        setToday(exchangeDateForSymbol(entry.symbol));
        void load();
        return () => { alive.current = false; };
        // One journal instance per symbol; quote polling must not reset history or drafts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entry.symbol]);
    function change(field: keyof ReviewDraft, value: string) {
        setDraft(current => ({ ...current, [field]: value })); setErrors(current => ({ ...current, [field]: undefined }));
    }
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving.current) return;
        const exchangeToday = exchangeDateForSymbol(entry.symbol);
        const nextErrors = validateReviewDraft(draft, exchangeToday);
        for (const field of ['tradingDate', 'nextReviewDate'] as const) {
            if ((event.currentTarget.elements.namedItem(field) as HTMLInputElement).validity.badInput) nextErrors[field] = '请选择有效日期';
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) { setMessage('请修正字段后再追加复核。'); summary.current?.focus(); return; }
        if (references.length > 10) { setMessage('研究证据最多 10 条，请先移除多余引用。'); summary.current?.focus(); return; }
        const fingerprint = JSON.stringify({ draft, correction, references });
        if (submittedFingerprint.current === fingerprint) { setMessage('这份草稿已成功追加，请先修改内容或开始新草稿。'); summary.current?.focus(); return; }
        if (attempt.current && attempt.current.fingerprint !== fingerprint) {
            setMessage('上次提交结果尚未确认。请先重试上次提交，再保存当前草稿。'); summary.current?.focus(); return;
        }
        if (!attempt.current) attempt.current = { fingerprint, input: reviewInputFromDraft(draft, crypto.randomUUID(), correction, references) };
        await saveAttempt();
    }
    async function saveAttempt() {
        if (saving.current || !attempt.current) return;
        saving.current = true; setPending(true); setMessage('');
        try {
            const result = await appendWatchlistReview(entry.symbol, attempt.current.input);
            if (!result.success) {
                // Maintenance can describe a committed write with an uncertain response.
                // Retain its request ID so recovery retries cannot append a duplicate.
                if (result.code !== 'LIFECYCLE_MAINTENANCE' && result.code !== 'LIFECYCLE_BUSY') attempt.current = null;
                setMessage(result.code === 'JOURNAL_CAPACITY'
                    ? '本次未追加：研究历史已达到单条容量限制。草稿仍保留，请前往「研究备份」导出完整 JSON；已有历史不会截断。'
                    : result.error);
                return;
            }
            setEntries(current => mergeJournalEntries(current, result.entries));
            setLoaded(true);
            submittedFingerprint.current = attempt.current.fingerprint;
            attempt.current = null;
            onSaved(result.entry);
            // Keep the draft intact, including edits typed while awaiting the response.
            setMessage('已追加复核。输入仍保留；继续追加前请核对，避免重复记录。');
        } catch { setMessage('提交结果尚未确认，草稿保留。请重试上次提交以确认结果，同一请求不会重复追加。'); }
        finally { saving.current = false; setPending(false); summary.current?.focus(); }
    }
    function correct(review: WatchlistReview) {
        setCorrection(review.id);
        setReferences(review.evidenceReferences ?? []);
        setMessage(`正在追加更正，原记录 ${review.id} 将完整保留。请填写更正内容并核对证据引用。`);
        hypothesisControl.current?.focus();
    }
    return <section className="min-w-0 space-y-4 rounded-lg border border-line bg-surface p-4" aria-label={`${entry.symbol} 历史与复核`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 ref={heading} tabIndex={-1} className="font-semibold">{entry.symbol} 观点历史与复核</h3><button type="button" className="btn min-h-12" onClick={onClose}>关闭历史与复核</button></div>
        <p className="text-xs text-faint">历史按追加时间倒序加载。旧观点只记录已留存内容，不补造过去的修改时间；复核按你选择的交易日归档。</p>
        <div className="space-y-3" aria-busy={loading}>
            {entries.map(item => <JournalRecord key={`${item.kind}-${item.id}`} entry={item} symbol={entry.symbol} onCorrect={entry.archivedAt ? undefined : correct} />)}
            {loading && <p role="status" className="text-sm text-faint">正在加载历史…</p>}
            {loadError && <div role="alert"><p className="text-sm text-down">{loadError}</p><button type="button" className="btn min-h-12" disabled={loading} onClick={() => void load(loaded ? cursor : undefined)}>重试加载历史</button></div>}
            {loaded && !entries.length && !loading && <p className="text-sm text-faint">暂无已留存的历史或复核记录。可在下方追加第一次复核。</p>}
            {cursor && !loadError && <button type="button" className="btn min-h-12" disabled={loading} onClick={() => void load(cursor)}>{loading ? '加载中…' : '加载更多历史'}</button>}
        </div>
        {entry.archivedAt ? <p className="text-sm text-faint">研究已归档，历史只读。恢复关注后可继续追加复核。</p> : <form method="post" noValidate onSubmit={submit} className="space-y-4 border-t border-line pt-4" aria-label={`${entry.symbol} 追加复核`}>
            <fieldset className="min-w-0 space-y-4">
                <legend className="font-medium">{correction ? '追加更正复核' : '追加复核'}</legend>
                <p className="text-xs text-faint">记录已发生的变化并区分价格、事实和判断；不把待发生的事件写成已验证事实。交易日由你选择（{zone}）。</p>
                <p ref={summary} tabIndex={-1} role="status" aria-live="polite" className="break-words text-sm">{message}</p>
                {message.includes('容量') && <a href="#research-backup" className="inline-block min-h-12 underline">前往研究备份，导出已有历史</a>}
                {correction && <p className="break-all text-xs">更正记录：{correction} <button type="button" className="btn min-h-12" onClick={() => setCorrection(undefined)}>取消更正引用</button></p>}
                <div className="space-y-1"><label htmlFor={`${id}-tradingDate`} className="block text-sm font-medium">复核交易日（必填）</label>
                    <input id={`${id}-tradingDate`} name="tradingDate" type="date" required min="1900-01-01" max={today} value={draft.tradingDate} onChange={event => change('tradingDate', event.target.value)} onBlur={() => setErrors(current => ({ ...current, tradingDate: validateReviewDraft(draft, today).tradingDate }))} className={controlClass} aria-invalid={Boolean(errors.tradingDate)} aria-describedby={`${id}-tradingDate-error`} />
                    <p id={`${id}-tradingDate-error`} className="text-xs text-down" aria-live="polite">{errors.tradingDate}</p></div>
                {(['hypothesis', 'changes', 'conclusion'] as const).map(field => <div key={field} className="space-y-1"><label htmlFor={`${id}-${field}`} className="block text-sm font-medium">{{ hypothesis: '当时假设', changes: '发生变化', conclusion: '复核结论' }[field]}（必填）</label>
                    <textarea ref={field === 'hypothesis' ? hypothesisControl : undefined} id={`${id}-${field}`} name={field} required maxLength={REVIEW_LIMITS.text} rows={3} value={draft[field]} onChange={event => change(field, event.target.value)} onBlur={() => setErrors(current => ({ ...current, [field]: validateReviewDraft(draft, today)[field] }))} className={`${controlClass} resize-y`} aria-invalid={Boolean(errors[field])} aria-describedby={`${id}-${field}-error`} />
                    <p id={`${id}-${field}-error`} className="text-xs text-down" aria-live="polite">{errors[field]}</p></div>)}
                <fieldset aria-describedby={`${id}-verificationType-error`}><legend className="text-sm font-medium">验证类型（必填）</legend><div className="flex flex-wrap gap-3">{Object.entries(TYPES).map(([value, label]) => <label key={value} className="flex min-h-12 items-center gap-2"><input type="radio" name="verificationType" value={value} checked={draft.verificationType === value} onChange={() => change('verificationType', value)} />{label}</label>)}</div><p id={`${id}-verificationType-error`} className="text-xs text-down" aria-live="polite">{errors.verificationType}</p></fieldset>
                <div className="space-y-1"><label htmlFor={`${id}-evidenceURLs`} className="block text-sm font-medium">证据链接（可选）</label><p id={`${id}-evidenceURLs-hint`} className="text-xs text-faint">最多 10 个 HTTP/HTTPS 地址，每行一个；链接内容由外部来源提供。</p>
                    <textarea id={`${id}-evidenceURLs`} name="evidenceURLs" rows={3} value={draft.evidenceURLs} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={event => change('evidenceURLs', event.target.value)} onBlur={() => setErrors(current => ({ ...current, evidenceURLs: validateReviewDraft(draft, today).evidenceURLs }))} className={`${controlClass} resize-y`} aria-invalid={Boolean(errors.evidenceURLs)} aria-describedby={`${id}-evidenceURLs-hint ${id}-evidenceURLs-error`} /><p id={`${id}-evidenceURLs-error`} className="text-xs text-down" aria-live="polite">{errors.evidenceURLs}</p></div>
                {!!references.length && <section aria-label="本次复核引用的研究证据" className="space-y-2">
                    <h4 className="text-sm font-medium">本次研究证据（{references.length} / 10）</h4>
                    <p className="text-xs text-faint">引用已保存的原始资料；不会覆盖上方文字。提交时会核对账户和标的归属。</p>
                    <ul className="space-y-2">{references.map(reference => <li key={`${reference.kind}:${reference.id}`} className="min-w-0 space-y-1">
                        <ResearchEvidenceDetails symbol={entry.symbol} reference={reference} />
                        <button type="button" className="btn min-h-12" onClick={() => setReferences(current => current.filter(item => item.kind !== reference.kind || item.id !== reference.id))}>移除{reference.kind === 'fact' ? '事实' : '对照'}引用 {reference.id}</button>
                    </li>)}</ul>
                </section>}
                <div className="space-y-1"><label htmlFor={`${id}-nextReviewDate`} className="block text-sm font-medium">下次复核日期（可选）</label><p id={`${id}-nextReviewDate-hint`} className="text-xs text-faint">填写后同步当前待复核计划；留空保持原计划。清除计划请编辑观察记录。</p>
                    <input id={`${id}-nextReviewDate`} name="nextReviewDate" type="date" min="1900-01-01" value={draft.nextReviewDate} onChange={event => change('nextReviewDate', event.target.value)} onBlur={() => setErrors(current => ({ ...current, nextReviewDate: validateReviewDraft(draft, today).nextReviewDate }))} className={controlClass} aria-invalid={Boolean(errors.nextReviewDate)} aria-describedby={`${id}-nextReviewDate-hint ${id}-nextReviewDate-error`} /><p id={`${id}-nextReviewDate-error`} className="text-xs text-down" aria-live="polite">{errors.nextReviewDate}</p></div>
            </fieldset>
            <div className="flex flex-wrap gap-3"><button type="submit" disabled={pending} className="btn btn-primary min-h-12">{pending ? '提交中…' : '追加复核记录'}</button>
                {attempt.current && !pending && <button type="button" className="btn min-h-12" onClick={() => void saveAttempt()}>重试上次提交</button>}
                <button type="button" className="btn min-h-12" onClick={() => { setDraft({ ...EMPTY }); setCorrection(undefined); setReferences([]); setErrors({}); }}>开始新草稿</button></div>
        </form>}
    </section>;
}
