'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createResearchFactForUI, getFactObservationChoicesForUI, getResearchFactByIdForUI, getResearchFactsForUI } from '@/lib/actions/research-facts.actions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import {
    FACT_ASSESSMENTS, FACT_ASSESSMENT_LABELS, FACT_TEXT_LIMIT, FACT_TYPES, FACT_TYPE_LABELS,
    researchFactFingerprint, validateCreateResearchFact,
    type FactObservationChoice, type ResearchFactRecord,
} from '@/lib/research-facts';

const CONTROL = 'min-h-12 w-full rounded border border-line bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2';
const BUTTON = 'btn min-h-12';

export function openFactReview(fact: Pick<ResearchFactRecord, 'symbol' | 'id'>) {
    window.dispatchEvent(new CustomEvent('openstock:open-review', { detail: { symbol: fact.symbol, evidenceReference: { kind: 'fact', id: fact.id } } }));
}
export function ResearchFactCard({ fact, onCorrect, onOriginal }: {
    fact: ResearchFactRecord; onCorrect: (button: HTMLButtonElement) => void; onOriginal: (id: string) => void;
}) {
    const original = fact.observationSnapshot;
    return <article id={`fact-${fact.id}`} className="min-w-0 rounded border border-line p-3">
        <h3 className="break-words font-medium">{fact.symbol} · {fact.title} · v{fact.version}</h3>
        <p className="mt-1 text-xs text-faint">{FACT_TYPE_LABELS[fact.factType]} · 报告期间：{fact.reportingPeriod} · {fact.exchangeId}</p>
        <dl className="mt-3 grid gap-3">
            <div><dt className="text-xs text-faint">关联原判断（保存当时版本）</dt><dd className="whitespace-pre-wrap break-words text-sm">{original ? <>
                {original.observation.note || '原判断未填写观察理由'}
                <p>失效条件：{original.observation.invalidation || '未填写'}</p>
                <p className="text-xs text-faint">{original.sourceSymbol} · {original.archivedAt ? '关联时已归档' : '关联时关注中'} · journal v{original.journalVersion} · {original.revisionId ? `观点版本 ${original.revisionId}` : '原记录当前状态'} · 原修改时间：{original.observationUpdatedAt ?? '未知'}</p>
            </> : '未关联原判断；可独立登记资料'}</dd></div>
            <div><dt className="text-xs text-faint">人工登记的事实原文／摘录</dt><dd className="whitespace-pre-wrap break-words text-sm">{fact.factText}</dd></div>
            <div><dt className="text-xs text-faint">来源</dt><dd className="break-words text-sm"><a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">原始来源：{fact.title}（新窗口）</a><p>{fact.sourceUrl}</p>
                <p>来源公开时间：{fact.sourcePublishedAt ? <time dateTime={fact.sourcePublishedAt}>{fact.sourcePublishedAt}</time> : '未知（未补造）'}</p>
                <p>人工登记保存时间：<time dateTime={fact.createdAt}>{fact.createdAt}</time>；未自动取回或核验官方来源。</p></dd></div>
            <div><dt className="text-xs text-faint">用户主观判断</dt><dd className="whitespace-pre-wrap break-words text-sm">{FACT_ASSESSMENT_LABELS[fact.assessment]}{fact.assessmentNote ? `：${fact.assessmentNote}` : ''}</dd></div>
        </dl>
        {fact.correctionOf && <div className="mt-3 break-words text-sm"><p>更正原因：{fact.correctionReason}；原事实继续保留。</p><button type="button" className={BUTTON} onClick={() => onOriginal(fact.correctionOf!)}>查看被更正的原事实</button></div>}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={BUTTON} aria-label={`追加复核 ${fact.symbol} ${fact.title} v${fact.version}`} onClick={() => openFactReview(fact)}>追加复核</button>
            <button type="button" className={BUTTON} aria-label={`追加更正 ${fact.symbol} ${fact.title} v${fact.version}`} onClick={(event) => onCorrect(event.currentTarget)}>追加更正</button></div>
    </article>;
}

export function ResearchFactForm({ correction, items = [], onSaved, onClose }: {
    correction?: ResearchFactRecord; items?: { symbol: string; company?: string }[];
    onSaved: (fact: ResearchFactRecord) => void; onClose?: () => void;
}) {
    const id = useId();
    const [symbol, setSymbol] = useState(correction?.symbol ?? items[0]?.symbol ?? '');
    const [choices, setChoices] = useState<FactObservationChoice[]>([]);
    const [selected, setSelected] = useState('');
    const [loadingChoices, setLoadingChoices] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [factType, setFactType] = useState<string>(correction?.factType ?? 'manual');
    const request = useRef<{ fingerprint: string; id: string } | null>(null);
    const pending = useRef(false);
    const symbolRef = useRef(symbol); symbolRef.current = symbol;
    const choicesGeneration = useRef(0);
    const status = useRef<HTMLParagraphElement>(null);
    const market = identifyMarketAndCode(symbol).market;
    async function loadChoices() {
        const requestedSymbol = symbol; const generation = ++choicesGeneration.current;
        setLoadingChoices(true); setMessage('');
        try {
            const result = await getFactObservationChoicesForUI(requestedSymbol);
            if (symbolRef.current !== requestedSymbol || choicesGeneration.current !== generation) return;
            if (!result.ok) { setMessage(result.error.message); return; }
            setChoices(result.value); setSelected('');
            if (!result.value.length) setMessage('没有可关联的原判断，可独立登记事实，无需加入自选。');
        } catch { if (symbolRef.current === requestedSymbol && choicesGeneration.current === generation) setMessage('读取原判断失败，输入仍保留，仍可独立登记'); }
        finally { if (choicesGeneration.current === generation) setLoadingChoices(false); }
    }
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending.current || !event.currentTarget.reportValidity()) return;
        const form = new FormData(event.currentTarget);
        try {
            const value = validateCreateResearchFact({
                symbol, factType, reportingPeriod: String(form.get('reportingPeriod') ?? ''), title: String(form.get('title') ?? ''),
                factText: String(form.get('factText') ?? ''), sourceUrl: String(form.get('sourceUrl') ?? ''),
                sourcePublishedAt: String(form.get('sourcePublishedAt') ?? '').trim() || null,
                assessment: String(form.get('assessment')), assessmentNote: String(form.get('assessmentNote') ?? ''),
                observationReference: selected ? choices[Number(selected)]?.reference : null,
                correctionOf: correction?.id ?? null, correctionReason: correction ? String(form.get('correctionReason') ?? '') : null,
                clientRequestId: request.current?.id ?? crypto.randomUUID(),
            });
            const fingerprint = researchFactFingerprint(value);
            if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
            pending.current = true; setSaving(true); setMessage('');
            const result = await createResearchFactForUI({ ...value, clientRequestId: request.current.id });
            if (!result.ok) { setMessage(result.error.message); return; }
            onSaved(result.value);
            setMessage('已保存人工登记事实；事实和主观判断不会自动验证观点。相同内容重试不会重复创建。');
            window.dispatchEvent(new CustomEvent('openstock:research-facts-changed'));
        } catch { setMessage('请核对标的、来源链接与含时区时间；保存未完成，输入仍保留，请重试。'); }
        finally { pending.current = false; setSaving(false); status.current?.focus(); }
    }
    return <form method="post" onSubmit={submit} className="grid min-w-0 gap-3" aria-label={correction ? `更正 ${correction.symbol} 事实` : '人工登记事实'}>
        <fieldset disabled={saving} className="grid min-w-0 gap-3">
            <legend className="mb-3 font-medium">{correction ? '追加更正（原事实保留）' : '人工登记事实'}</legend>
            <div><label htmlFor={`${id}-symbol`} className="mb-1 block">标的代码（必填）</label><input id={`${id}-symbol`} name="symbol" required maxLength={25} readOnly={!!correction} value={symbol} onChange={(event) => { setSymbol(event.target.value); setChoices([]); setSelected(''); setFactType('manual'); ++choicesGeneration.current; setLoadingChoices(false); }} list={`${id}-symbols`} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className={CONTROL} aria-describedby={`${id}-symbol-help`} />
                <datalist id={`${id}-symbols`}>{items.map((item) => <option key={item.symbol} value={item.symbol}>{item.company}</option>)}</datalist>
                <p id={`${id}-symbol-help`} className="text-xs text-faint">支持四地规范代码和别名；例如 AAPL、600519.SS、00700.HK、2330.TW。无需加入自选。</p></div>
            <div><label htmlFor={`${id}-type`} className="mb-1 block">事实类型（必填）</label><select id={`${id}-type`} name="factType" required value={factType} onChange={(event) => setFactType(event.target.value)} className={CONTROL}>{FACT_TYPES[market].map((type) => <option key={type} value={type}>{FACT_TYPE_LABELS[type]}</option>)}</select></div>
            <div><label htmlFor={`${id}-period`} className="mb-1 block">报告期间（必填）</label><p id={`${id}-period-help`} className="text-xs text-faint">照来源填写财年／季度／月份与累计口径，不自动换算期间。</p><input id={`${id}-period`} name="reportingPeriod" required maxLength={160} defaultValue={correction?.reportingPeriod ?? ''} aria-describedby={`${id}-period-help`} className={CONTROL} /></div>
            <div><label htmlFor={`${id}-title`} className="mb-1 block">来源标题（必填）</label><input id={`${id}-title`} name="title" required maxLength={200} defaultValue={correction?.title ?? ''} className={CONTROL} /></div>
            <div><label htmlFor={`${id}-text`} className="mb-1 block">事实原文／摘录（必填）</label><textarea id={`${id}-text`} name="factText" required maxLength={FACT_TEXT_LIMIT} rows={4} defaultValue={correction?.factText ?? ''} className={`${CONTROL} resize-y`} /></div>
            <div><label htmlFor={`${id}-url`} className="mb-1 block">原始来源链接（必填）</label><input id={`${id}-url`} name="sourceUrl" type="url" required maxLength={2000} defaultValue={correction?.sourceUrl ?? ''} autoCorrect="off" autoCapitalize="off" spellCheck={false} className={CONTROL} aria-describedby={`${id}-url-help`} /><p id={`${id}-url-help`} className="text-xs text-faint">仅 HTTP/HTTPS，不含账号密码。链接由用户登记，系统不自动核验是否官方。</p></div>
            <div><label htmlFor={`${id}-published`} className="mb-1 block">来源公开时间（可选，未知留空）</label><p id={`${id}-time-help`} className="text-xs text-faint">使用含时区的完整时间，例如 2026-11-08T18:00:00+08:00。保存时间单独由服务器记录；不是来源取回时间。</p><input id={`${id}-published`} name="sourcePublishedAt" maxLength={35} defaultValue={correction?.sourcePublishedAt ?? ''} autoCorrect="off" autoCapitalize="off" spellCheck={false} className={CONTROL} aria-describedby={`${id}-time-help`} /></div>
            <div className="grid gap-2"><button type="button" className={`${BUTTON} justify-self-start`} disabled={loadingChoices} onClick={() => void loadChoices()}>{loadingChoices ? '读取原判断中…' : '读取可关联原判断'}</button>
                <label htmlFor={`${id}-observation`}>关联原判断版本（可选，含已归档）</label><select id={`${id}-observation`} name="observationReference" value={selected} onChange={(event) => setSelected(event.target.value)} className={CONTROL}><option value="">{correction?.observationSnapshot ? '保留被更正事实关联的原判断快照' : '不关联，独立登记'}</option>{choices.map((item, index) => <option key={`${item.reference.recordId}:${item.reference.revisionId ?? 'current'}`} value={String(index)}>{item.snapshot.sourceSymbol} · {item.snapshot.archivedAt ? '已归档' : '关注中'} · {item.snapshot.revisionId ?? '当前状态'} · {item.snapshot.observation.note?.slice(0, 80) || '未填写观察理由'}</option>)}</select>
                {selected !== '' && <p className="whitespace-pre-wrap break-words">选中的原判断：{choices[Number(selected)]?.snapshot.observation.note || '未填写观察理由'}</p>}</div>
            <fieldset className="grid gap-1"><legend>用户主观判断（必选）</legend>{FACT_ASSESSMENTS.map((assessment) => <label key={assessment} htmlFor={`${id}-${assessment}`} className="flex min-h-12 items-center gap-2"><input id={`${id}-${assessment}`} type="radio" name="assessment" value={assessment} required defaultChecked={(correction?.assessment ?? 'undetermined') === assessment} />{FACT_ASSESSMENT_LABELS[assessment]}</label>)}</fieldset>
            <div><label htmlFor={`${id}-assessment-note`} className="mb-1 block">主观判断说明（可选）</label><textarea id={`${id}-assessment-note`} name="assessmentNote" maxLength={2000} rows={3} defaultValue={correction?.assessmentNote ?? ''} className={`${CONTROL} resize-y`} /></div>
            {correction && <div><label htmlFor={`${id}-reason`} className="mb-1 block">更正原因（必填）</label><textarea id={`${id}-reason`} name="correctionReason" required maxLength={2000} rows={2} className={`${CONTROL} resize-y`} /></div>}
            <div className="flex flex-wrap gap-2"><button type="submit" className={`${BUTTON} btn-primary`}>{saving ? '保存中…' : correction ? '保存追加更正' : '保存事实卡片'}</button>{onClose && <button type="button" className={BUTTON} onClick={onClose}>关闭更正</button>}</div>
        </fieldset>
        <p ref={status} role="status" aria-live="polite" tabIndex={-1} className="break-words text-sm">{message}</p>
    </form>;
}

export default function ResearchFacts({ items = [] }: { items?: { symbol: string; company?: string }[] }) {
    const id = useId();
    const [facts, setFacts] = useState<ResearchFactRecord[]>([]);
    const [cursor, setCursor] = useState<string | undefined>();
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [creating, setCreating] = useState(false);
    const [correction, setCorrection] = useState<ResearchFactRecord>();
    const pending = useRef(false);
    const readGeneration = useRef(0);
    const active = useRef(true);
    const editor = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const status = useRef<HTMLParagraphElement>(null);
    const load = useCallback(async (next?: string) => {
        if (pending.current) return;
        pending.current = true; setLoading(true);
        const generation = ++readGeneration.current;
        try {
            const result = await getResearchFactsForUI({ limit: 20, ...(next ? { cursor: next } : {}) });
            if (!active.current || generation !== readGeneration.current) return;
            if (!result.ok) { setMessage(result.error.message); return; }
            setFacts(result.value.facts); setCursor(result.value.nextCursor); setMessage('');
        } catch { if (active.current && generation === readGeneration.current) setMessage('读取事实失败，已显示资料与输入仍保留，请重试'); }
        finally { pending.current = false; if (active.current) setLoading(false); }
    }, []);
    useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
    useEffect(() => { if (correction) editor.current?.focus(); }, [correction]);
    function saved(fact: ResearchFactRecord) {
        ++readGeneration.current;
        setFacts((previous) => [fact, ...previous.filter((item) => item.id !== fact.id)].slice(0, 20));
        setCursor(undefined);
        setMessage('事实已保存；可选择追加复核，用户确认后才会写入研究历史。重新读取最新事实可继续分页。');
    }
    async function original(id: string) {
        try {
            const result = await getResearchFactByIdForUI(id);
            if (!result.ok) setMessage(result.error.message);
            else if (result.value) {
                const fact = result.value;
                ++readGeneration.current; setCursor(undefined);
                setFacts((previous) => [fact, ...previous.filter((item) => item.id !== id)].slice(0, 20));
                setMessage('已显示被更正的原事实；原文保持不变。重新读取最新事实可继续分页。');
            } else setMessage('未找到当前账户的原事实');
        } catch { setMessage('读取原事实失败，请重试'); }
        status.current?.focus();
    }
    function close() { setCorrection(undefined); trigger.current?.focus(); }
    return <section id="research-facts" className="hatch min-w-0">
        <div className="section-head flex-wrap gap-2"><div><h2 className="section-title">公告与事实卡片</h2><p className="section-sub">人工登记来源，关联原判断</p></div><button type="button" className={BUTTON} disabled={loading} onClick={() => void load()}>重新读取最新事实</button></div>
        <div className="grid min-w-0 gap-3 p-3 text-sm">
            <p className="text-faint">事实、价格变化与用户主观判断分别留存。新增证据不会自动验证观点；不自动抓取、计算财务变化或生成 AI 判断。每页 20 条，所有更正和原文继续保留。</p>
            <p ref={status} role="status" aria-live="polite" tabIndex={-1}>{message}</p>
            {loading && <p>正在读取事实卡片…</p>}
            {!loading && !facts.length && <p>尚无已读取事实，可直接登记未关注标的。</p>}
            <ul role="list" className="grid min-w-0 gap-3 lg:grid-cols-2">{facts.map((fact) => <li key={fact.id} className="min-w-0"><ResearchFactCard fact={fact} onCorrect={(button) => { trigger.current = button; setCorrection(fact); setCreating(false); }} onOriginal={(id) => void original(id)} /></li>)}</ul>
            {cursor && <button type="button" className={`${BUTTON} justify-self-start`} disabled={loading} onClick={() => void load(cursor)}>下一页较早事实</button>}
            {correction && <div ref={editor} tabIndex={-1} className="rounded border border-line p-3"><ResearchFactForm key={correction.id} correction={correction} onSaved={saved} onClose={close} /></div>}
            {!correction && <><button type="button" className={`${BUTTON} justify-self-start`} aria-expanded={creating} aria-controls={`${id}-create`} onClick={() => setCreating((value) => !value)}>人工登记新事实</button><div id={`${id}-create`} hidden={!creating}><ResearchFactForm items={items} onSaved={saved} /></div></>}
        </div>
    </section>;
}
