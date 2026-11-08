'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { cancelMarketEvent, createMarketEvent, getWatchlistEvents } from '@/lib/actions/market-events.actions';
import { useMarketResource } from '@/hooks/useMarketResource';
import { validateEventInput, type EventInput, type MarketEvent } from '@/lib/market/events';

const CERTAINTY = { 'official-schedule': '官方预告 · 可能变更', estimated: '来源预计 · 尚未确认披露', user: '用户记录 · 日期未核验' };
const KINDS = { earnings: '业绩披露', 'ex-dividend': '除权息', other: '其他事项' };
export default function MarketEventsCalendar({ items }: { items: { symbol: string; company?: string }[] }) {
    const id = useId();
    const resource = useMarketResource({ key: `events:${items.map((item) => item.symbol).sort().join(',')}`, loader: getWatchlistEvents, intervalMs: 300_000 });
    const [local, setLocal] = useState<MarketEvent[]>([]);
    const [cancelled, setCancelled] = useState<string[]>([]);
    const [symbol, setSymbol] = useState(items[0]?.symbol ?? '');
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);
    const requestId = useRef<string | null>(null);
    const status = useRef<HTMLParagraphElement>(null);
    const [cancelId, setCancelId] = useState<string | null>(null);
    const selected = items.some((item) => item.symbol === symbol) ? symbol : items[0]?.symbol ?? '';
    const events = [...new Map([...(resource.data?.events ?? []), ...local].map((event) => [event.id, event])).values()]
        .filter((event) => !cancelled.includes(event.id) && (event.certainty === 'user' || items.some((item) => item.symbol === event.symbol))).sort((a, b) => a.date.localeCompare(b.date));
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        if (pending.current || !form.reportValidity()) return;
        const fields = new FormData(form);
        requestId.current ??= crypto.randomUUID();
        let input: EventInput;
        try { input = validateEventInput({ symbol: selected, title: String(fields.get('title') ?? ''), date: String(fields.get('date') ?? ''),
            kind: String(fields.get('kind')) as EventInput['kind'], note: String(fields.get('note') ?? ''), sourceUrl: String(fields.get('sourceUrl') ?? ''), clientRequestId: requestId.current }); }
        catch (error) { setMessage(error instanceof Error ? error.message : '请核对输入'); status.current?.focus(); return; }
        pending.current = true; setSaving(true); setMessage('');
        try {
            const saved = await createMarketEvent(input);
            setLocal((previous) => [...previous.filter((item) => item.id !== saved.id), saved]);
            // Leave inputs intact so a delayed response cannot discard edits made while saving.
            setMessage('已保存用户记录。日期未由系统核验；修改输入后可新增另一条。');
        } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，输入仍保留。'); }
        finally { pending.current = false; setSaving(false); status.current?.focus(); }
    }
    async function cancel(event: MarketEvent) {
        setCancelId(event.id);
        try { await cancelMarketEvent(event.id); setCancelled((previous) => [...previous, event.id]); setMessage('已撤销用户记录。'); }
        catch { setMessage('撤销失败，请重试。'); }
        finally { setCancelId(null); }
    }
    const control = 'min-h-11 w-full rounded border border-line bg-background px-3 py-2 text-sm';
    return <section className="hatch min-w-0">
        <div className="section-head"><div><h2 className="section-title">自选事件日程</h2><p className="section-sub">官方来源覆盖各市场当地日期起未来 7 个自然日；用户记录另行保留</p></div></div>
        <div className="flex flex-col gap-3 p-3 text-sm">
            {resource.loading && <p role="status">正在读取事件…</p>}
            {resource.error && <p role="status" className="text-warn">事件读取失败{resource.data ? '，保留上次结果' : '，请稍后重试'}。</p>}
            {!items.length && <p>加入自选后，可查看已接入的事件来源或手工记录待核查事项。</p>}
            {resource.data && !events.length && <p>本次覆盖范围内未取得事件；不代表所有市场均无事件。</p>}
            <ul className="divide-y divide-line">{events.map((event) => <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0 flex-1"><p><time dateTime={event.date}>{event.date}</time> · <Link className="underline" href={`/stocks/${event.symbol}`}>{event.symbol}</Link> · {KINDS[event.kind]}</p>
                    <p className="break-words font-medium">{event.title}</p><p className="text-xs text-faint">{CERTAINTY[event.certainty]} · {event.source}</p>
                    {event.note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-faint">{event.note}</p>}
                    {event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="text-xs underline">查看来源原文</a>}
                </div>
                {event.certainty === 'user' && <button type="button" className="btn text-xs" disabled={cancelId === event.id} onClick={() => void cancel(event)}>撤销用户记录</button>}
            </li>)}</ul>
            {resource.data?.sources.map((source) => <p key={source.source} className={`text-xs ${source.status === 'error' ? 'text-warn' : 'text-faint'}`}>{source.source}：{source.detail}</p>)}
            <p className="text-xs text-faint">用户记录不因链接指向官方网页而自动升级为官方确认。未接入市场不从新闻标题猜测日期；最多展示 100 条有效用户记录。</p>
            {items.length > 0 && <details className="rounded border border-line p-3"><summary className="cursor-pointer font-medium">添加用户事件</summary>
                <form onSubmit={submit} noValidate onChange={() => { requestId.current = null; setMessage(''); }} className="mt-3 grid gap-3 sm:grid-cols-2" aria-label="添加用户事件">
                    <div><label htmlFor={`${id}-symbol`}>自选标的</label><select id={`${id}-symbol`} name="symbol" className={control} value={selected} onChange={(event) => setSymbol(event.target.value)}>{items.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} {item.company}</option>)}</select></div>
                    <div><label htmlFor={`${id}-date`}>事件日期（标的市场当地日期）</label><input id={`${id}-date`} name="date" type="date" required className={control} /></div>
                    <div><label htmlFor={`${id}-title`}>事件标题</label><input id={`${id}-title`} name="title" required maxLength={120} className={control} /></div>
                    <div><label htmlFor={`${id}-kind`}>类别</label><select id={`${id}-kind`} name="kind" className={control}>{Object.entries(KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
                    <div className="sm:col-span-2"><label htmlFor={`${id}-url`}>参考链接（可选）</label><input id={`${id}-url`} name="sourceUrl" type="url" maxLength={1500} className={control} /></div>
                    <div className="sm:col-span-2"><label htmlFor={`${id}-note`}>待核查内容（可选）</label><textarea id={`${id}-note`} name="note" rows={3} maxLength={2000} className={control} /></div>
                    <button type="submit" disabled={saving} className="btn btn-primary justify-self-start">{saving ? '保存中…' : '保存用户事件'}</button>
                </form>
            </details>}
            <p ref={status} tabIndex={-1} role="status" aria-live="polite">{message}</p>
        </div>
    </section>;
}
