'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createManualPlan, getManualPlan, getManualPlans, getManualPlanScheduleHistory, updateManualPlan } from '@/lib/actions/manual-plan.actions';
import { exchangeTimeZone } from '@/lib/market/dates';
import {
    MANUAL_PLAN_LIMIT, MANUAL_PLAN_TEXT_LIMIT, manualPlanFingerprint, validateCreateManualPlan,
    type ManualPlan, type ManualPlanSchedule, type ManualPlanPageOptions,
} from '@/lib/manual-plan';

const STATES = { waiting: '等待中', completed: '已完成', cancelled: '已取消' };
const TEXT_FIELDS = { waitingCondition: '等待条件', invalidation: '失效条件', nextAction: '下一步行动' } as const;
const CONTROL = 'min-h-12 w-full rounded border border-line bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2';
const BUTTON = 'btn min-h-12';
type StateDraft = { state: 'completed' | 'cancelled'; reason: string };
type CreationSource = { symbol: string; observationVersionId: string };

/** A late list response must not overwrite a more recent successful local mutation. */
export function mergeManualPlans(previous: ManualPlan[], incoming: ManualPlan[]): ManualPlan[] {
    const plans = new Map(previous.map((plan) => [plan.id, plan]));
    for (const plan of incoming) if (!plans.has(plan.id) || plans.get(plan.id)!.version <= plan.version) plans.set(plan.id, plan);
    return [...plans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function ManualPlanForm({ plan, items = [], source, onSaved, onClose }: {
    plan?: ManualPlan; items?: { symbol: string; company?: string }[]; source?: CreationSource;
    onSaved: (plan: ManualPlan) => void; onClose?: () => void;
}) {
    const id = useId();
    const [symbol, setSymbol] = useState(plan?.symbol ?? source?.symbol ?? items[0]?.symbol ?? '');
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [date, setDate] = useState(plan?.checkDate ?? '');
    const pending = useRef(false);
    const request = useRef<{ fingerprint: string; id: string } | null>(null);
    const status = useRef<HTMLParagraphElement>(null);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        if (pending.current || !form.reportValidity()) return;
        const fields = new FormData(form);
        try {
            const value = validateCreateManualPlan({
                symbol, waitingCondition: String(fields.get('waitingCondition') ?? ''), invalidation: String(fields.get('invalidation') ?? ''),
                nextAction: String(fields.get('nextAction') ?? ''), checkDate: String(fields.get('checkDate') ?? ''),
                clientRequestId: request.current?.id ?? crypto.randomUUID(),
                ...(plan?.observationVersionId ? { observationVersionId: plan.observationVersionId } : !plan && fields.get('observationVersionId') ? { observationVersionId: String(fields.get('observationVersionId')) } : {}),
            });
            const fingerprint = manualPlanFingerprint(value);
            if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
            pending.current = true; setSaving(true); setMessage('');
            let saved: ManualPlan;
            if (plan) {
                const result = await updateManualPlan(plan.id, {
                    waitingCondition: value.waitingCondition, invalidation: value.invalidation,
                    nextAction: value.nextAction, checkDate: value.checkDate,
                    ...(value.checkDate !== plan.checkDate ? { scheduleReason: String(fields.get('scheduleReason') ?? '') } : {}),
                }, plan.version);
                if (!result.success) throw new Error(result.error);
                saved = result.plan;
            } else {
                const result = await createManualPlan({ ...value, clientRequestId: request.current.id });
                if (!result.success) throw new Error(result.error);
                saved = result.plan;
            }
            onSaved(saved);
            setMessage('已保存人工计划；修改内容后可新增另一条，原内容重试不会重复创建。');
            if (plan) onClose?.();
        } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，输入仍保留，请重试。'); }
        finally { pending.current = false; setSaving(false); status.current?.focus(); }
    }
    return <form method="post" onSubmit={submit} className="grid min-w-0 gap-3" aria-label={plan ? `编辑 ${plan.symbol} 人工计划` : '新建人工计划'}>
        <fieldset disabled={saving} className="grid min-w-0 gap-3">
            <legend className="mb-3 font-medium">{plan ? '编辑人工计划' : '新建人工计划'}（条件、行动与日期必填）</legend>
            <div><label htmlFor={`${id}-symbol`} className="mb-1 block">标的代码</label>
                <input id={`${id}-symbol`} name="symbol" required maxLength={25} value={symbol} readOnly={!!plan} onChange={(event) => setSymbol(event.target.value)} list={`${id}-symbols`} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-describedby={`${id}-symbol-help`} className={CONTROL} />
                <datalist id={`${id}-symbols`}>{items.map((item) => <option key={item.symbol} value={item.symbol}>{item.company}</option>)}</datalist>
                <p id={`${id}-symbol-help`} className="mt-1 text-xs text-faint">例如 AAPL、000001.SZ、00700.HK、2330.TW；可独立于自选保存。创建后标的固定。</p>
            </div>
            {Object.entries(TEXT_FIELDS).map(([key, label]) => <div key={key}><label htmlFor={`${id}-${key}`} className="mb-1 block">{label}</label>
                <textarea id={`${id}-${key}`} name={key} required maxLength={MANUAL_PLAN_TEXT_LIMIT} rows={3} defaultValue={plan?.[key as keyof typeof TEXT_FIELDS] ?? ''} className={`${CONTROL} resize-y`} /></div>)}
            <div><label htmlFor={`${id}-checkDate`} className="mb-1 block">检查日期</label>
                <p id={`${id}-date-help`} className="mb-1 text-xs text-faint">按标的市场当地自然日填写{symbol.trim() ? `（${exchangeTimeZone(symbol)}）` : ''}；日期不会自动执行任何行动。</p>
                <input id={`${id}-checkDate`} name="checkDate" type="date" required min="1900-01-01" max="9999-12-31" value={date} onChange={(event) => setDate(event.target.value)} aria-describedby={`${id}-date-help`} className={CONTROL} /></div>
            {plan && <div hidden={date === plan.checkDate}><label htmlFor={`${id}-scheduleReason`} className="mb-1 block">调整日期的原因（修改日期时必填）</label>
                <textarea id={`${id}-scheduleReason`} name="scheduleReason" required={date !== plan.checkDate} maxLength={MANUAL_PLAN_TEXT_LIMIT} rows={2} className={`${CONTROL} resize-y`} /></div>}
            {!plan && <div><label htmlFor={`${id}-observationVersionId`} className="mb-1 block">关联观点版本编号（选填）</label>
                <p id={`${id}-observation-help`} className="mb-1 text-xs text-faint">仅接受本账户同标的的已保存观点版本；留空可独立创建。计划保留创建时的观点原文。</p>
                <input id={`${id}-observationVersionId`} name="observationVersionId" defaultValue={source?.observationVersionId ?? ''} maxLength={100} pattern="[A-Za-z0-9_-]{1,100}" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-describedby={`${id}-observation-help`} className={CONTROL} /></div>}
            <div className="flex flex-wrap gap-2"><button type="submit" className={`${BUTTON} btn-primary`}>{saving ? '保存中…' : plan ? '保存修改' : '保存人工计划'}</button>
                {onClose && <button type="button" className={BUTTON} onClick={onClose}>关闭编辑</button>}</div>
        </fieldset>
        <p ref={status} tabIndex={-1} role="status" aria-live="polite" className="break-words text-sm">{message}</p>
    </form>;
}

export function ManualPlanCard({ plan, busy, onEdit, onState, draft, onDraft }: {
    plan: ManualPlan; busy: boolean; onEdit: (button: HTMLButtonElement) => void; onState: (state: 'completed' | 'cancelled', reason: string) => void;
    draft?: StateDraft; onDraft?: (draft?: StateDraft) => void;
}) {
    const id = useId();
    const [localDraft, setLocalDraft] = useState<StateDraft>();
    const terminal = onDraft ? draft : localDraft;
    const setDraft = onDraft ?? setLocalDraft;
    return <article className="min-w-0 rounded border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium"><Link className="underline" href={`/stocks/${encodeURIComponent(plan.symbol)}`}>{plan.symbol}</Link> · {STATES[plan.manualState]}</h3>
            <p className="text-xs text-faint">检查日期：<time dateTime={plan.checkDate}>{plan.checkDate}</time>（{exchangeTimeZone(plan.symbol)}）</p></div>
        <dl className="mt-3 grid gap-3">{Object.entries(TEXT_FIELDS).map(([key, label]) => <div key={key}><dt className="text-xs text-faint">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{plan[key as keyof typeof TEXT_FIELDS]}</dd></div>)}</dl>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={busy} aria-label={`编辑 ${plan.symbol} 计划（${plan.checkDate}）`} onClick={(event) => onEdit(event.currentTarget)}>编辑</button>
            {plan.manualState === 'waiting' && <><button type="button" className={BUTTON} disabled={busy} aria-label={`标记完成 ${plan.symbol} 计划（${plan.checkDate}）`} onClick={() => setDraft({ state: 'completed', reason: terminal?.reason ?? '' })}>标记完成</button>
                <button type="button" className={BUTTON} disabled={busy} aria-label={`取消计划 ${plan.symbol}（${plan.checkDate}）`} onClick={() => setDraft({ state: 'cancelled', reason: terminal?.reason ?? '' })}>取消计划</button></>}</div>
        {plan.stateReason && <p className="mt-3 whitespace-pre-wrap break-words">完成依据 / 取消原因：{plan.stateReason}</p>}
        {plan.observationVersionId && <div className="mt-3 grid gap-1 text-xs text-faint"><p>创建时关联观点版本：{plan.observationVersionId}；请核对后续观点变化，计划条件不会自动覆盖。</p>
            <p className="whitespace-pre-wrap break-words">原判断：{plan.observationSnapshot?.note || '未填写'}；原失效条件：{plan.observationSnapshot?.invalidation || '未填写'}</p></div>}
        {terminal && plan.manualState === 'waiting' && <form method="post" className="mt-3 grid gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (!busy && event.currentTarget.reportValidity()) onState(terminal.state, terminal.reason);
        }}><label htmlFor={`${id}-stateReason`}>{terminal.state === 'completed' ? '完成依据' : '取消原因'}（必填）</label>
            <textarea id={`${id}-stateReason`} name="stateReason" required maxLength={MANUAL_PLAN_TEXT_LIMIT} rows={2} value={terminal.reason} onChange={(event) => setDraft({ ...terminal, reason: event.target.value })} className={`${CONTROL} resize-y`} />
            <div className="flex flex-wrap gap-2"><button type="submit" className={BUTTON} disabled={busy}>保存{terminal.state === 'completed' ? '完成依据' : '取消原因'}</button><button type="button" className={BUTTON} onClick={() => setDraft(undefined)}>返回计划</button></div>
        </form>}
    </article>;
}

function ScheduleHistory({ plan }: { plan: ManualPlan }) {
    const [history, setHistory] = useState<ManualPlanSchedule[]>([]);
    const [cursor, setCursor] = useState<number>();
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    async function load() {
        if (busy) return;
        setBusy(true);
        try {
            const result = await getManualPlanScheduleHistory(plan.id, cursor);
            if (!result.success) { setMessage(result.error); return; }
            setHistory((previous) => [...new Map([...previous, ...result.history].map((row) => [row.revision, row])).values()]);
            setCursor(result.nextCursor); setLoaded(true); setMessage('');
        } catch { setMessage('读取日期调整记录失败，请重试。'); }
        finally { setBusy(false); }
    }
    return <div className="grid gap-2"><p className="text-xs text-faint">当前安排版本 {plan.scheduleRevision}；日期按标的市场自然日保留。</p>
        {(!loaded || cursor) && <button type="button" className={`${BUTTON} justify-self-start`} disabled={busy} onClick={() => void load()}>{loaded ? '读取更早的日期调整' : '查看日期调整记录'}</button>}
        {loaded && !history.length && <p className="text-xs text-faint">尚无日期调整记录。</p>}
        <ol role="list" className="grid gap-2">{history.map((row) => <li key={row.revision} className="text-xs"><p><time dateTime={row.fromDate}>{row.fromDate}</time> → <time dateTime={row.toDate}>{row.toDate}</time>（安排版本 {row.revision}）</p><p className="whitespace-pre-wrap break-words">{row.reason}</p></li>)}</ol>
        <p role="status" className="text-sm">{message}</p>
    </div>;
}

export default function ManualPlans({ items = [] }: { items?: { symbol: string; company?: string }[] }) {
    const id = useId();
    const [plans, setPlans] = useState<ManualPlan[]>([]);
    const [scope, setScope] = useState<NonNullable<ManualPlanPageOptions['scope']>>('waiting');
    const [cursor, setCursor] = useState<string>();
    const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
    const [nextCursor, setNextCursor] = useState<string>();
    const [activeCount, setActiveCount] = useState<number>();
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    // Keep each opened editor mounted while paging/switching so unsaved drafts survive.
    const [editors, setEditors] = useState<ManualPlan[]>([]);
    const [editingId, setEditingId] = useState<string>();
    const [focusedPlan, setFocusedPlan] = useState<ManualPlan>();
    const [stateDrafts, setStateDrafts] = useState<Record<string, StateDraft>>({});
    const [creating, setCreating] = useState(false);
    const [creationSources, setCreationSources] = useState<CreationSource[]>([]);
    const [creationKey, setCreationKey] = useState('independent');
    const pending = useRef(false);
    const active = useRef(true);
    const generation = useRef(0);
    const openGeneration = useRef(0);
    const editor = useRef<HTMLDivElement>(null);
    const creator = useRef<HTMLDivElement>(null);
    const editTrigger = useRef<HTMLButtonElement | null>(null);
    const status = useRef<HTMLParagraphElement>(null);
    const load = useCallback(async (selected: NonNullable<ManualPlanPageOptions['scope']> = 'waiting', after?: string, back: (string | undefined)[] = []) => {
        const request = ++generation.current;
        setLoading(true);
        try {
            const result = await getManualPlans({ scope: selected, ...(after ? { cursor: after } : {}) });
            if (!active.current || request !== generation.current) return;
            if (!result.success) { setMessage(result.error); return; }
            setPlans((previous) => result.plans.map((plan) => previous.find((old) => old.id === plan.id && old.version > plan.version) ?? plan));
            setScope(selected); setCursor(after); setPreviousCursors(back); setNextCursor(result.nextCursor); setActiveCount(result.activeCount); setMessage('');
        } catch { if (active.current && request === generation.current) setMessage('读取人工计划失败，已显示的记录和编辑输入仍保留，请重试。'); }
        finally { if (active.current && request === generation.current) setLoading(false); }
    }, []);
    useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
    const openEditor = useCallback((plan: ManualPlan) => {
        setEditors((previous) => previous.some((draft) => draft.id === plan.id) ? previous : [...previous, plan]);
        setEditingId(plan.id); setCreating(false);
    }, []);
    useEffect(() => {
        const open = async (event: Event) => {
            const detail = (event as CustomEvent<{ id?: string; symbol?: string; observationVersionId?: string }>).detail;
            if (!detail) return;
            if (!detail.id && typeof detail.symbol === 'string' && detail.symbol.length <= 25
                && typeof detail.observationVersionId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(detail.observationVersionId)) {
                ++openGeneration.current;
                const source = { symbol: detail.symbol, observationVersionId: detail.observationVersionId };
                const key = `${source.symbol}:${source.observationVersionId}`;
                setCreationSources((previous) => previous.some((value) => `${value.symbol}:${value.observationVersionId}` === key) ? previous : [...previous, source]);
                setCreationKey(key); setCreating(true); setEditingId(undefined);
                setMessage('已打开关联原观点的新建草稿；独立新建与已有编辑草稿继续保留。');
                creator.current?.focus();
                return;
            }
            if (typeof detail.id !== 'string') return;
            const request = ++openGeneration.current;
            try {
                const result = await getManualPlan(detail.id);
                if (!active.current || request !== openGeneration.current) return;
                if (!result.success) { setMessage(result.error); return; }
                setFocusedPlan(result.plan);
                setPlans((previous) => previous.map((plan) => plan.id === result.plan.id && plan.version < result.plan.version ? result.plan : plan));
                openEditor(result.plan);
            } catch { if (active.current) setMessage('读取指定人工计划失败，已有输入仍保留，请重试。'); }
        };
        window.addEventListener('openstock:open-plan', open);
        return () => window.removeEventListener('openstock:open-plan', open);
    }, [openEditor]);
    useEffect(() => { if (editingId) { editor.current?.focus(); editor.current?.scrollIntoView({ block: 'nearest' }); } }, [editingId, focusedPlan]);
    useEffect(() => { if (creating && !editingId) creator.current?.focus(); }, [creating, creationKey, editingId]);
    function stateDraft(planId: string, draft?: StateDraft) {
        setStateDrafts((previous) => {
            const next = { ...previous };
            if (draft) next[planId] = draft; else delete next[planId];
            return next;
        });
    }
    async function refreshPlan(planId: string) {
        try {
            const result = await getManualPlan(planId);
            if (!active.current) return;
            if (!result.success) { setMessage(result.error); return; }
            setFocusedPlan(result.plan);
            setPlans((previous) => previous.map((plan) => plan.id === result.plan.id && plan.version < result.plan.version ? result.plan : plan));
        } catch { setMessage('读取指定人工计划失败，已有输入仍保留，请重试。'); }
    }
    function saved(plan: ManualPlan) {
        ++generation.current;
        setPlans((previous) => mergeManualPlans(previous, [plan]));
        setFocusedPlan((previous) => previous?.id === plan.id ? plan : previous);
        window.dispatchEvent(new CustomEvent('openstock:manual-plan-updated'));
        void load(scope, cursor, previousCursors);
    }
    function closeEditor(planId: string) {
        setEditors((previous) => previous.filter((plan) => plan.id !== planId));
        setEditingId(undefined); editTrigger.current?.focus();
    }
    async function changeState(plan: ManualPlan, manualState: 'completed' | 'cancelled', stateReason: string) {
        if (pending.current) return;
        pending.current = true; setBusy(plan.id);
        try {
            const result = await updateManualPlan(plan.id, { manualState, stateReason }, plan.version);
            if (!result.success) { setMessage(result.error); return; }
            saved(result.plan); stateDraft(plan.id); setMessage(`已${manualState === 'completed' ? '标记完成' : '取消'} ${plan.symbol} 的人工计划，记录继续保留。`);
        } catch { setMessage('状态保存失败，请重新读取后核对。'); }
        finally { pending.current = false; setBusy(null); status.current?.focus(); }
    }
    const displayed = focusedPlan && !plans.some((plan) => plan.id === focusedPlan.id) ? [focusedPlan, ...plans] : plans;
    return <section className="hatch min-w-0">
        <div className="section-head flex-wrap gap-2"><div><h2 className="section-title">人工计划</h2><p className="section-sub">人工计划，不代表持仓或成交</p></div>
            <button type="button" className={BUTTON} disabled={loading} onClick={() => void load(scope, cursor, previousCursors)}>重新读取计划</button></div>
        <div className="grid min-w-0 gap-3 p-3 text-sm">
            <p className="text-faint">计划状态与观察复核状态独立。不会自动下单；完成和取消均保留原记录。最多同时保留 {MANUAL_PLAN_LIMIT} 条等待中的计划{activeCount !== undefined ? `，当前 ${activeCount} 条` : ''}；历史分页保留，不占活动容量。</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="计划范围"><button type="button" className={BUTTON} aria-pressed={scope === 'waiting'} disabled={loading} onClick={() => void load('waiting')}>等待中的计划</button><button type="button" className={BUTTON} aria-pressed={scope === 'history'} disabled={loading} onClick={() => void load('history')}>已完成与已取消历史</button></div>
            {loading && <p>正在读取人工计划…</p>}
            <p ref={status} tabIndex={-1} role="status" aria-live="polite" className="break-words">{message}</p>
            {!loading && !plans.length && !message && <p>{scope === 'history' ? '暂无已完成或已取消的计划。' : '暂无等待中的人工计划，可记录等待条件、失效条件与下一步行动。'}</p>}
            <ul role="list" className="grid min-w-0 gap-3 lg:grid-cols-2">{displayed.map((plan) => <li key={plan.id} className="min-w-0"><ManualPlanCard plan={plan} busy={busy !== null} draft={stateDrafts[plan.id]} onDraft={(draft) => stateDraft(plan.id, draft)} onEdit={(button) => { editTrigger.current = button; openEditor(plan); }} onState={(state, reason) => void changeState(plan, state, reason)} /></li>)}</ul>
            <nav aria-label="人工计划分页" className="flex flex-wrap items-center gap-2"><button type="button" className={BUTTON} disabled={loading || !previousCursors.length} onClick={() => void load(scope, previousCursors.at(-1), previousCursors.slice(0, -1))}>上一页</button><span>第 {previousCursors.length + 1} 页，本页 {plans.length} 条</span><button type="button" className={BUTTON} disabled={loading || !nextCursor} onClick={() => void load(scope, nextCursor, [...previousCursors, cursor])}>下一页</button></nav>
            {editors.length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label="保留的编辑草稿">{editors.map((plan) => <button type="button" key={plan.id} className={BUTTON} aria-pressed={editingId === plan.id} onClick={() => setEditingId(plan.id)}>继续编辑 {plan.symbol}（{plan.checkDate}）</button>)}<button type="button" className={BUTTON} onClick={() => { setEditingId(undefined); setCreating(true); }}>返回新建草稿</button></div>}
            {editors.map((editing) => {
                const latest = displayed.find((plan) => plan.id === editing.id);
                return <div key={`${editing.id}:${editing.version}`} ref={editingId === editing.id ? editor : undefined} hidden={editingId !== editing.id} tabIndex={-1} className="min-w-0 rounded border border-line p-3">
                    {latest && latest.version !== editing.version && <div className="mb-3"><p>已有新版本。当前输入仍保留；采用新版本会替换未保存的输入。</p><button type="button" className={BUTTON} onClick={() => setEditors((previous) => previous.map((plan) => plan.id === editing.id ? latest : plan))}>使用最新记录重新编辑</button></div>}
                    <button type="button" className={`${BUTTON} mb-3`} onClick={() => void refreshPlan(editing.id)}>读取这条计划最新版本（保留草稿）</button>
                    <ManualPlanForm plan={editing} onSaved={saved} onClose={() => closeEditor(editing.id)} />
                    <ScheduleHistory key={`${editing.id}:${latest?.scheduleRevision ?? editing.scheduleRevision}`} plan={latest ?? editing} />
                </div>;
            })}
            <div hidden={!!editingId} className="grid min-w-0 gap-3"><button type="button" className={`${BUTTON} justify-self-start`} aria-expanded={creating} aria-controls={`${id}-create`} onClick={() => setCreating((value) => !value)}>{creating ? '收起新建计划' : '新建人工计划'}</button>
                <div id={`${id}-create`} ref={creator} tabIndex={-1} hidden={!creating} className="grid min-w-0 gap-3 rounded border border-line p-3">
                    {creationSources.length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label="保留的新建草稿"><button type="button" className={BUTTON} aria-pressed={creationKey === 'independent'} onClick={() => setCreationKey('independent')}>独立新建草稿</button>{creationSources.map((source) => {
                        const key = `${source.symbol}:${source.observationVersionId}`;
                        return <button type="button" key={key} className={BUTTON} aria-pressed={creationKey === key} onClick={() => setCreationKey(key)}>关联 {source.symbol} · {source.observationVersionId}</button>;
                    })}</div>}
                    <div hidden={creationKey !== 'independent'}><ManualPlanForm items={items} onSaved={saved} /></div>
                    {creationSources.map((source) => { const key = `${source.symbol}:${source.observationVersionId}`; return <div key={key} hidden={creationKey !== key}><ManualPlanForm source={source} items={items} onSaved={saved} /></div>; })}
                </div></div>
        </div>
    </section>;
}
