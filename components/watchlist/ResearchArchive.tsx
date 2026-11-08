'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { restoreWatchlist } from '@/lib/actions/watchlist.actions';
import { pauseAlert } from '@/lib/actions/alert.actions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import type { WatchlistEntry } from '@/lib/watchlist-observation';
import WatchlistJournal from './WatchlistJournal';
import { observationTime } from './ObservationEditor';

type RelatedAlert = { _id: string; symbol: string; active?: boolean; triggered?: boolean; expiresAt?: string };
export default function ResearchArchive({ entries, alerts, alertsAvailable = true }: { entries: WatchlistEntry[]; alerts: RelatedAlert[]; alertsAvailable?: boolean }) {
    const router = useRouter();
    const [history, setHistory] = useState<string>();
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
        function openReview(event: Event) {
            const detail = (event as CustomEvent).detail;
            const raw = typeof detail === 'string' ? detail : detail?.symbol;
            if (typeof raw !== 'string') return;
            const symbol = identifyMarketAndCode(raw).normalizedSymbol;
            if (entries.some(entry => entry.symbol === symbol)) setHistory(symbol);
        }
        window.addEventListener('openstock:open-review', openReview);
        return () => window.removeEventListener('openstock:open-review', openReview);
    }, [entries]);
    async function restore(symbol: string) {
        if (pending) return;
        setPending(true); setMessage('');
        try {
            const result = await restoreWatchlist(symbol);
            if (!result.success) { setMessage(result.error); return; }
            setMessage(`已恢复 ${symbol}，原观点、快照和复核历史保留。`);
            router.refresh();
        } catch { setMessage('恢复结果未确认，请刷新核对。研究历史仍保留。'); }
        finally { setPending(false); }
    }
    async function stop(id: string) {
        if (pending) return;
        setPending(true); setMessage('');
        try {
            const result = await pauseAlert(id);
            setMessage(result.success ? '已停用后续检测，触发和投递记录保留。' : '预警已触发或不存在，请刷新核对。');
            router.refresh();
        } catch { setMessage('停用结果未确认，请刷新核对。'); }
        finally { setPending(false); }
    }
    return <section id="research-archive" className="panel min-w-0 space-y-3 p-4">
        <h2 className="text-base font-semibold">研究归档</h2>
        <p className="text-sm text-faint">移出自选会归档研究。恢复关注沿用原记录；归档不自动停用独立预警，用户事件与人工计划也会保留。已在途的投递不会因停用撤回。</p>
        <p role="status" className="break-words text-sm">{message}</p>
        {!entries.length && <p className="text-sm text-faint">暂无归档研究。</p>}
        <ul className="space-y-3">{entries.map(entry => {
            const related = alerts.filter(alert => identifyMarketAndCode(alert.symbol).normalizedSymbol === entry.symbol);
            return <li key={entry.symbol} className="min-w-0 space-y-3 rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/stocks/${encodeURIComponent(entry.symbol)}`} className="font-medium underline">{entry.symbol} · {entry.company}</Link>
                    <span className="text-xs text-faint">归档 {observationTime(entry.archivedAt)}</span>
                    <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void restore(entry.symbol)} aria-label={`恢复关注 ${entry.symbol}`}>恢复关注</button>
                    <button type="button" className="btn min-h-12" aria-expanded={history === entry.symbol} onClick={() => setHistory(history === entry.symbol ? undefined : entry.symbol)}>查看 {entry.symbol} 归档历史</button>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">观察理由：{entry.note || '未记录'}</p>
                <p className="whitespace-pre-wrap break-words text-sm">失效条件：{entry.invalidation || '未记录'}</p>
                <p className="text-xs text-faint">{alertsAvailable ? `关联预警 ${related.length} 条；触发和投递详情见价格预警区。` : '预警读取失败，关联数量未知；不能据此判断已停用。请刷新后核对。'}</p>
                {related.map(alert => <div key={alert._id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{alert.symbol} · {alert.triggered ? '已触发，保留投递记录' : alert.active === false ? '已停用' : alert.expiresAt && Date.parse(alert.expiresAt) <= Date.now() ? '已过期' : '继续独立检测（依赖服务配置）'}</span>
                    {!alert.triggered && alert.active !== false && <button type="button" className="btn min-h-12" disabled={pending} onClick={() => void stop(alert._id)} aria-label={`停用归档标的 ${alert.symbol} 预警`}>停用预警</button>}
                </div>)}
                {history === entry.symbol && <WatchlistJournal key={entry.symbol} entry={entry} onSaved={() => router.refresh()} onClose={() => setHistory(undefined)} />}
            </li>;
        })}</ul>
    </section>;
}
