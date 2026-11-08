'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { identifyMarketAndCode } from '@/lib/market/instrument';

const VIEWS = [
    ['due', '今日待核查'], ['observe', '盘中观察'], ['review', '盘后复盘'],
    ['plans', '人工计划'], ['facts', '事实卡片'], ['data', '资料与维护'],
] as const;
type View = typeof VIEWS[number][0];
const HASH_VIEWS: Record<string, View> = {
    'research-changes': 'due', 'watchlist-observations': 'observe', 'daily-research': 'review',
    'manual-plans': 'plans', 'research-facts': 'facts', 'research-archive': 'data', 'research-backup': 'data',
};
for (const [view] of VIEWS) HASH_VIEWS[`task-${view}`] = view;

export default function ResearchWorkspace({ due, observe, review, plans, facts, data, activeSymbols, archivedSymbols, activeAvailable, archiveAvailable }: {
    due: ReactNode; observe: ReactNode; review: ReactNode; plans: ReactNode; facts: ReactNode; data: ReactNode;
    activeSymbols: string[]; archivedSymbols: string[]; activeAvailable: boolean; archiveAvailable: boolean;
}) {
    const router = useRouter();
    const [view, setView] = useState<View>('due');
    const [notice, setNotice] = useState<{ symbol: string; text: string }>();
    useEffect(() => {
        function readHash() {
            const next = HASH_VIEWS[window.location.hash.slice(1)];
            if (next) setView(next);
        }
        function show(next: View) {
            setView(next);
            router.replace(`#task-${next}`, { scroll: false });
        }
        function openPlan() { setNotice(undefined); show('plans'); }
        function openReview(event: Event) {
            const detail = (event as CustomEvent).detail;
            const raw = typeof detail === 'string' ? detail : detail?.symbol;
            if (typeof raw !== 'string' || raw.length > 40) return;
            const instrument = identifyMarketAndCode(raw);
            if (instrument.kind === 'unknown') return;
            const symbol = instrument.normalizedSymbol;
            if (activeSymbols.includes(symbol)) { setNotice(undefined); show('observe'); }
            else if (archivedSymbols.includes(symbol)) {
                show('data');
                setNotice({ symbol, text: `${symbol} 的研究已归档，已打开原观点历史。归档期间只读；可在资料区手动恢复关注后追加复核，事实和对照仍保留。` });
            } else if (!activeAvailable || !archiveAvailable) {
                show('data');
                setNotice({ symbol, text: `${symbol} 的研究归属暂时无法确认：自选或归档读取失败。请核对维护状态并刷新，再追加复核；独立证据仍保留。` });
            } else {
                show('facts');
                setNotice({ symbol, text: `${symbol} 暂无可追加的自选研究记录。独立事实、计划和对照仍保留；可进入标的详情手动加入自选，再追加复核。` });
            }
        }
        readHash();
        window.addEventListener('hashchange', readHash);
        window.addEventListener('openstock:open-plan', openPlan);
        window.addEventListener('openstock:open-review', openReview);
        return () => {
            window.removeEventListener('hashchange', readHash);
            window.removeEventListener('openstock:open-plan', openPlan);
            window.removeEventListener('openstock:open-review', openReview);
        };
    }, [activeSymbols, archivedSymbols, activeAvailable, archiveAvailable, router]);
    const panels = { due, observe, review, plans, facts, data };
    return <div className="min-w-0 space-y-3">
        <nav aria-label="研究任务" className="flex flex-wrap gap-2">
            {VIEWS.map(([key, label]) => <Link key={key} href={`#task-${key}`} scroll={false} aria-current={view === key ? 'location' : undefined}
                className={`btn min-h-12 ${view === key ? 'btn-primary' : ''}`} onClick={() => setView(key)}>{label}</Link>)}
        </nav>
        <p className="text-xs text-faint">按当前任务切换视图；已打开的表单与未提交文字在本页内保留。刷新或离开页面前请先保存。</p>
        {notice && <div role="status" className="panel space-y-2 p-3 text-sm"><p>{notice.text}</p><Link className="inline-block min-h-12 underline" href={`/stocks/${encodeURIComponent(notice.symbol)}`}>查看 {notice.symbol} 标的详情</Link></div>}
        {VIEWS.map(([key, label]) => <section key={key} id={`task-${key}`} hidden={view !== key} aria-label={label} className="min-w-0 space-y-3">
            {panels[key]}
        </section>)}
    </div>;
}
