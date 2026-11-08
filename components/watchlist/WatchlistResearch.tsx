'use client';

import { useEffect, useRef, useState } from 'react';
import { getWatchlistData } from '@/lib/actions/finnhub.actions';
import type { WatchlistEntry } from '@/lib/watchlist-observation';
import WatchlistTable from './WatchlistTable';

type Rows = Awaited<ReturnType<typeof getWatchlistData>>;

/** Keep the last successful table mounted when an RSC refresh cannot read research. */
export default function WatchlistResearch({ items }: { items: WatchlistEntry[] | null }) {
    const [rows, setRows] = useState<Rows | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const queuedReviews = useRef<unknown[]>([]);
    useEffect(() => {
        const queue = (event: Event) => {
            if (rows !== null) return;
            const detail = (event as CustomEvent).detail;
            const symbol = typeof detail === 'string' ? detail : detail?.symbol;
            if (typeof symbol === 'string' && symbol.length <= 40) queuedReviews.current.push(detail);
        };
        window.addEventListener('openstock:open-review', queue);
        // Child table effects have mounted before this replay runs.
        const frame = rows !== null ? requestAnimationFrame(() => {
            const intents = new Map<string, unknown[]>();
            for (const detail of queuedReviews.current.splice(0)) {
                const value = detail as { symbol?: string; evidenceReference?: unknown };
                const symbol = typeof detail === 'string' ? detail : value.symbol;
                if (!symbol) continue;
                const references = intents.get(symbol) ?? [];
                if (typeof detail === 'object' && value.evidenceReference) references.push(value.evidenceReference);
                intents.set(symbol, references);
            }
            for (const [symbol, evidenceReferences] of intents) window.dispatchEvent(new CustomEvent('openstock:queued-review', { detail: { symbol, evidenceReferences } }));
        }) : undefined;
        return () => { window.removeEventListener('openstock:open-review', queue); if (frame !== undefined) cancelAnimationFrame(frame); };
    }, [rows]);
    useEffect(() => {
        if (items === null) return;
        let active = true;
        setLoading(true);
        void getWatchlistData(items).then(result => {
            if (!active) return;
            setRows(result); setFailed(false);
        }).catch(() => {
            if (active) setFailed(true);
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [items, retry]);
    const unavailable = items === null || failed;
    return <div className="min-w-0">
        {unavailable && <div role="status" className="space-y-2 p-4 text-sm">
            <p>当前研究或股票数据未读到，内容与数量尚未确认。{rows !== null ? '保留上次成功列表及已打开的草稿；显示内容可能已过期。' : '请核对维护状态后刷新重试。'}</p>
            <a className="inline-block min-h-12 underline" href="#task-data">查看资料与维护</a>
            {items !== null && <button type="button" className="btn min-h-12" disabled={loading} onClick={() => setRetry(value => value + 1)}>重试读取股票数据</button>}
        </div>}
        {rows !== null ? <WatchlistTable initialRows={rows} /> : !unavailable && <p role="status" className="p-4 text-sm">正在读取股票数据…</p>}
    </div>;
}
