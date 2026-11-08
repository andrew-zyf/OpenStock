'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createManualPlan, getManualPlans, updateManualPlan } from '@/lib/actions/manual-plan.actions';
import { exchangeTimeZone } from '@/lib/market/dates';
import {
    MANUAL_PLAN_LIMIT, MANUAL_PLAN_TEXT_LIMIT, manualPlanFingerprint, validateCreateManualPlan,
    type ManualPlan,
} from '@/lib/manual-plan';

const STATES = { waiting: '等待中', completed: '已完成', cancelled: '已取消' };
const TEXT_FIELDS = { waitingCondition: '等待条件', invalidation: '失效条件', nextAction: '下一步行动' } as const;
const CONTROL = 'min-h-12 w-full rounded border border-line bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2';
const BUTTON = 'btn min-h-12';

/** A late list response must not overwrite a more recent successful local mutation. */
export function mergeManualPlans(previous: ManualPlan[], incoming: ManualPlan[]): ManualPlan[] {
    const plans = new Map(previous.map((plan) => [plan.id, plan]));
    for (const plan of incoming) if (!plans.has(plan.id) || plans.get(plan.id)!.version <= plan.version) plans.set(plan.id, plan);
    return [...plans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function ManualPlanForm({ plan, items = [], onSaved, onClose }: {
    plan?: ManualPlan; items?: { symbol: string; company?: string }[];
    onSaved: (plan: ManualPlan) => void; onClose?: () => void;
}) {
    const id = useId();
    const [symbol, setSymbol] = useState(plan?.symbol ?? items[0]?.symbol ?? '');
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
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
            });
            const fingerprint = manualPlanFingerprint(value);
            if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
            pending.current = true; setSaving(true); setMessage('');
            let saved: ManualPlan;
            if (plan) {
                const result = await updateManualPlan(plan.id, {
                    waitingCondition: value.waitingCondition, invalidation: value.invalidation,
                    nextAction: value.nextAction, checkDate: value.checkDate,
                }, plan.version);
                if (!result.success) throw new Error(result.error);
                saved = result.plan;
            } else saved = await createManualPlan({ ...value, clientRequestId: request.current.id });
            onSaved(saved);
            setMessage('已保存人工计划；修改内容后可新增另一条，原内容重试不会重复创建。');
            if (plan) onClose?.();
        } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，输入仍保留，请重试。'); }
        finally { pending.current = false; setSaving(false); status.current?.focus(); }
    }
    return <form method="post" onSubmit={submit} className="grid min-w-0 gap-3" aria-label={plan ? `编辑 ${plan.symbol} 人工计划` : '新建人工计划'}>
        <fieldset disabled={saving} className="grid min-w-0 gap-3">
            <legend className="mb-3 font-medium">{plan ? '编辑人工计划' : '新建人工计划'}（所有字段必填）</legend>
            <div><label htmlFor={`${id}-symbol`} className="mb-1 block">标的代码</label>
                <input id={`${id}-symbol`} name="symbol" required maxLength={25} value={symbol} readOnly={!!plan} onChange={(event) => setSymbol(event.target.value)} list={`${id}-symbols`} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-describedby={`${id}-symbol-help`} className={CONTROL} />
                <datalist id={`${id}-symbols`}>{items.map((item) => <option key={item.symbol} value={item.symbol}>{item.company}</option>)}</datalist>
                <p id={`${id}-symbol-help`} className="mt-1 text-xs text-faint">例如 AAPL、000001.SZ、00700.HK、2330.TW；可独立于自选保存。创建后标的固定。</p>
            </div>
            {Object.entries(TEXT_FIELDS).map(([key, label]) => <div key={key}><label htmlFor={`${id}-${key}`} className="mb-1 block">{label}</label>
                <textarea id={`${id}-${key}`} name={key} required maxLength={MANUAL_PLAN_TEXT_LIMIT} rows={3} defaultValue={plan?.[key as keyof typeof TEXT_FIELDS] ?? ''} className={`${CONTROL} resize-y`} /></div>)}
            <div><label htmlFor={`${id}-checkDate`} className="mb-1 block">检查日期</label>
                <p id={`${id}-date-help`} className="mb-1 text-xs text-faint">按标的市场当地自然日填写{symbol.trim() ? `（${exchangeTimeZone(symbol)}）` : ''}；日期不会自动执行任何行动。</p>
                <input id={`${id}-checkDate`} name="checkDate" type="date" required min="1900-01-01" max="9999-12-31" defaultValue={plan?.checkDate ?? ''} aria-describedby={`${id}-date-help`} className={CONTROL} /></div>
            <div className="flex flex-wrap gap-2"><button type="submit" className={`${BUTTON} btn-primary`}>{saving ? '保存中…' : plan ? '保存修改' : '保存人工计划'}</button>
                {onClose && <button type="button" className={BUTTON} onClick={onClose}>关闭编辑</button>}</div>
        </fieldset>
        <p ref={status} tabIndex={-1} role="status" aria-live="polite" className="break-words text-sm">{message}</p>
    </form>;
}

export function ManualPlanCard({ plan, busy, onEdit, onState }: {
    plan: ManualPlan; busy: boolean; onEdit: (button: HTMLButtonElement) => void; onState: (state: 'completed' | 'cancelled') => void;
}) {
    return <article className="min-w-0 rounded border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium"><Link className="underline" href={`/stocks/${encodeURIComponent(plan.symbol)}`}>{plan.symbol}</Link> · {STATES[plan.manualState]}</h3>
            <p className="text-xs text-faint">检查日期：<time dateTime={plan.checkDate}>{plan.checkDate}</time>（{exchangeTimeZone(plan.symbol)}）</p></div>
        <dl className="mt-3 grid gap-3">{Object.entries(TEXT_FIELDS).map(([key, label]) => <div key={key}><dt className="text-xs text-faint">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{plan[key as keyof typeof TEXT_FIELDS]}</dd></div>)}</dl>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={busy} aria-label={`编辑 ${plan.symbol} 计划（${plan.checkDate}）`} onClick={(event) => onEdit(event.currentTarget)}>编辑</button>
            {plan.manualState === 'waiting' && <><button type="button" className={BUTTON} disabled={busy} aria-label={`标记完成 ${plan.symbol} 计划（${plan.checkDate}）`} onClick={() => onState('completed')}>标记完成</button>
                <button type="button" className={BUTTON} disabled={busy} aria-label={`取消计划 ${plan.symbol}（${plan.checkDate}）`} onClick={() => onState('cancelled')}>取消计划</button></>}</div>
    </article>;
}

export default function ManualPlans({ items = [] }: { items?: { symbol: string; company?: string }[] }) {
    const id = useId();
    const [plans, setPlans] = useState<ManualPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [editing, setEditing] = useState<ManualPlan | null>(null);
    const [creating, setCreating] = useState(false);
    const pending = useRef(false);
    const active = useRef(true);
    const editor = useRef<HTMLDivElement>(null);
    const editTrigger = useRef<HTMLButtonElement | null>(null);
    const status = useRef<HTMLParagraphElement>(null);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const values = await getManualPlans();
            if (active.current) { setPlans((previous) => mergeManualPlans(previous, values)); setMessage(''); }
        } catch { if (active.current) setMessage('读取人工计划失败，已显示的记录和编辑输入仍保留，请重试。'); }
        finally { if (active.current) setLoading(false); }
    }, []);
    useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
    useEffect(() => { if (editing) editor.current?.focus(); }, [editing]);
    function saved(plan: ManualPlan) { setPlans((previous) => mergeManualPlans(previous, [plan])); }
    function closeEditor() { setEditing(null); editTrigger.current?.focus(); }
    async function changeState(plan: ManualPlan, manualState: 'completed' | 'cancelled') {
        if (pending.current) return;
        pending.current = true; setBusy(plan.id);
        try {
            const result = await updateManualPlan(plan.id, { manualState }, plan.version);
            if (!result.success) { setMessage(result.error); return; }
            saved(result.plan); setMessage(`已${manualState === 'completed' ? '标记完成' : '取消'} ${plan.symbol} 的人工计划，记录继续保留。`);
        } catch { setMessage('状态保存失败，请重新读取后核对。'); }
        finally { pending.current = false; setBusy(null); status.current?.focus(); }
    }
    const latest = editing && plans.find((plan) => plan.id === editing.id);
    return <section className="hatch min-w-0">
        <div className="section-head flex-wrap gap-2"><div><h2 className="section-title">人工计划</h2><p className="section-sub">人工计划，不代表持仓或成交</p></div>
            <button type="button" className={BUTTON} disabled={loading} onClick={() => void load()}>重新读取计划</button></div>
        <div className="grid min-w-0 gap-3 p-3 text-sm">
            <p className="text-faint">计划状态与观察复核状态独立。不会自动下单；完成和取消均保留原记录。最多累计保留 {MANUAL_PLAN_LIMIT} 条，当前已读取 {plans.length} 条。</p>
            {loading && <p>正在读取人工计划…</p>}
            <p ref={status} tabIndex={-1} role="status" aria-live="polite" className="break-words">{message}</p>
            {!loading && !plans.length && !message && <p>暂无人工计划，可记录等待条件、失效条件与下一步行动。</p>}
            <ul role="list" className="grid min-w-0 gap-3 lg:grid-cols-2">{plans.map((plan) => <li key={plan.id} className="min-w-0"><ManualPlanCard plan={plan} busy={busy !== null} onEdit={(button) => { editTrigger.current = button; setEditing(plan); setCreating(false); }} onState={(state) => void changeState(plan, state)} /></li>)}</ul>
            {editing && <div ref={editor} tabIndex={-1} className="min-w-0 rounded border border-line p-3">
                {latest && latest.version !== editing.version && <div className="mb-3"><p>已有新版本。当前输入仍保留；采用新版本会替换未保存的输入。</p><button type="button" className={BUTTON} onClick={() => setEditing(latest)}>使用最新记录重新编辑</button></div>}
                <ManualPlanForm key={`${editing.id}:${editing.version}`} plan={editing} onSaved={saved} onClose={closeEditor} />
            </div>}
            <div hidden={!!editing} className="grid min-w-0 gap-3"><button type="button" className={`${BUTTON} justify-self-start`} aria-expanded={creating} aria-controls={`${id}-create`} onClick={() => setCreating((value) => !value)}>{creating ? '收起新建计划' : '新建人工计划'}</button>
                <div id={`${id}-create`} hidden={!creating} className="min-w-0 rounded border border-line p-3"><ManualPlanForm items={items} onSaved={saved} /></div></div>
        </div>
    </section>;
}
