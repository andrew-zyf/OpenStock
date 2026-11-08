"use client";

import React, { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Bell, Search, Star } from "lucide-react";
import CreateAlertModal from "./CreateAlertModal";
import ObservationEditor, { observationTime, REVIEW_LABELS } from "./ObservationEditor";
import WatchlistJournal from "./WatchlistJournal";
import { buildReviewQueue, observationDistance } from "@/lib/market/review-queue";
import WatchlistButton from "@/components/WatchlistButton";
import ChangePill from "@/components/ChangePill";
import PriceFlash from "@/components/PriceFlash";
import { useLiveQuoteResource, type LiveQuote } from "@/hooks/useLiveQuotes";
import { SearchButton } from "@/components/SearchCommand";
import { formatNumber, formatPrice } from "@/lib/utils";
import { identifyMarketAndCode } from "@/lib/market/instrument";
import { getInstrumentCapabilities } from "@/lib/market/capabilities";
import { compareDailyQuotes, getBenchmarkOptions } from "@/lib/market/comparison";
import { alertsEnabled, isRealtime } from "@/lib/market-data";
import type { getWatchlistData } from "@/lib/actions/finnhub.actions";
import type { ReviewStatus, WatchlistEntry } from "@/lib/watchlist-observation";
import { validateEvidenceReferences, type ResearchEvidenceReference } from "@/lib/watchlist-review";

type Row = Awaited<ReturnType<typeof getWatchlistData>>[number];
type MarketFilter = 'all' | 'us' | 'cn' | 'hk' | 'tw';
type SortField = 'default' | 'changePercent' | 'price' | 'distance';

const SUGGESTIONS = [
    { symbol: 'AAPL', label: '苹果 (美股)' },
    { symbol: 'NVDA', label: '英伟达 (美股)' },
    { symbol: '600' + '519.SS', label: '贵州茅台 (A股)' },
    { symbol: '300750.SZ', label: '宁德时代 (A股)' },
    { symbol: '0700.HK', label: '腾讯控股 (港股)' },
    { symbol: '9988.HK', label: '阿里巴巴 (港股)' },
    { symbol: '2330.TW', label: '台积电 (台股)' },
    { symbol: '2454.TW', label: '联发科 (台股)' },
];
const MARKETS = [
    { id: 'all', label: '全部' }, { id: 'us', label: '美股' }, { id: 'cn', label: 'A股' },
    { id: 'hk', label: '港股' }, { id: 'tw', label: '台股' },
] as const;

export function observationPriceChange(entry: Pick<WatchlistEntry, 'initialSnapshot'>, quote?: LiveQuote | null): { value?: number; reason?: string } {
    const initial = entry.initialSnapshot;
    if (!initial) return { reason: '未记录初始观察价（旧记录不补造）' };
    if (quote?.c == null || !Number.isFinite(quote.c) || quote.c <= 0 || quote.priceBasis !== 'last-trade') return { reason: '暂无可比的最新成交价' };
    if (quote.stale) return { reason: '最新报价已过期，暂不计算' };
    if (quote.currency !== initial.currency) return { reason: '初始价与最新价币种不同，暂不计算' };
    if (!Number.isFinite(initial.price) || initial.price <= 0) return { reason: '初始观察价无效' };
    return { value: (quote.c / initial.price - 1) * 100 };
}

export default function WatchlistTable({ initialRows }: { initialRows: Row[] }) {
    const id = useId();
    const [baseRows, setBaseRows] = useState(initialRows);
    const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
    const [groupFilter, setGroupFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<ReviewStatus | ''>('');
    const [sortField, setSortField] = useState<SortField>('default');
    const [sortAsc, setSortAsc] = useState(false);
    const [editing, setEditing] = useState<string[]>([]);
    const [journals, setJournals] = useState<string[]>([]);
    const [journalEvidence, setJournalEvidence] = useState<Record<string, ResearchEvidenceReference[]>>({});
    const [dueOnly, setDueOnly] = useState(false);
    const [now, setNow] = useState<Date | null>(null);
    useEffect(() => {
        setNow(new Date());
        const timer = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(timer);
    }, []);
    const [benchmarks, setBenchmarks] = useState<Record<string, string>>({});
    const quoteSymbols = [...new Set(baseRows.flatMap((row) => [row.symbol, ...getBenchmarkOptions(row.symbol).map((option) => option.symbol)]))];
    const quotes = useLiveQuoteResource(quoteSymbols);
    const live = quotes.data ?? {};

    useEffect(() => setBaseRows(initialRows), [initialRows]);
    useEffect(() => {
        function openReview(event: Event) {
            const detail = (event as CustomEvent).detail;
            const rawSymbol = typeof detail === 'string' ? detail : detail?.symbol;
            if (typeof rawSymbol !== 'string') return;
            const symbol = identifyMarketAndCode(rawSymbol).normalizedSymbol;
            if (!initialRows.some(row => row.symbol === symbol)) return;
            if (typeof detail === 'object' && (detail?.evidenceReference || Array.isArray(detail?.evidenceReferences))) {
                try {
                    const incoming = detail.evidenceReference ? [detail.evidenceReference] : detail.evidenceReferences;
                    const checked = incoming.flatMap((value: unknown) => validateEvidenceReferences([value]));
                    const references = [...new Map(checked.map((reference: ResearchEvidenceReference) => [`${reference.kind}:${reference.id}`, reference])).values()] as ResearchEvidenceReference[];
                    // Each dispatch adds to the mounted draft; it never replaces typed text.
                    setJournalEvidence(current => ({ ...current, [symbol]: references }));
                } catch { return; }
            }
            setJournals(current => current.includes(symbol) ? current : [...current, symbol]);
            requestAnimationFrame(() => {
                const panel = document.getElementById(`${id}-journal-${symbol.replace(/[^a-zA-Z0-9]/g, '-')}`);
                if (!panel || panel.closest('[hidden]')) return;
                panel.querySelector<HTMLElement>('h3[tabindex="-1"]')?.focus({ preventScroll: true });
                panel.scrollIntoView({ block: 'start' });
            });
        }
        window.addEventListener('openstock:open-review', openReview);
        window.addEventListener('openstock:queued-review', openReview);
        return () => {
            window.removeEventListener('openstock:open-review', openReview);
            window.removeEventListener('openstock:queued-review', openReview);
        };
    }, [initialRows, id]);

    const liveRows = baseRows.map((row) => {
        const quote = live[row.symbol];
        return quote?.c != null ? { ...row, price: quote.c, change: quote.d, changePercent: quote.dp,
            currency: quote.currency ?? row.currency, marketCap: quote.marketCap ?? row.marketCap } : row;
    });
    function rowQuote(row: Row): LiveQuote | undefined {
        const quote = live[row.symbol] ?? (row.price > 0 ? { c: row.price, d: row.change, dp: row.changePercent, pc: row.previousClose,
            currency: row.currency, priceBasis: row.priceBasis, source: row.source, asOf: row.asOf, fetchedAt: row.fetchedAt } : undefined);
        return quote && (quotes.error || live[row.symbol] === null) ? { ...quote, stale: true } : quote;
    }
    // The tick schedules natural expiry, but new quotes can arrive between ticks.
    // Evaluate against render time so their source timestamps are not mistaken for future data.
    const queue = now ? buildReviewQueue(baseRows, Object.fromEntries(baseRows.map(row => [row.symbol, rowQuote(row)])), new Date()) : [];
    const dueSymbols = new Set(queue.filter(item => item.dueDate).map(item => item.symbol));
    const distanceFor = (row: Row) => observationDistance(row.targetPrice, rowQuote(row)?.c);
    function closeJournal(symbol: string) {
        setJournals(current => current.filter(item => item !== symbol));
        setJournalEvidence(current => { const next = { ...current }; delete next[symbol]; return next; });
    }
    const panelId = (symbol: string, kind: 'editor' | 'journal') => `${id}-${kind}-${symbol.replace(/[^a-zA-Z0-9]/g, '-')}`;
    function openPanel(symbol: string, kind: 'editor' | 'journal') {
        const setter = kind === 'editor' ? setEditing : setJournals;
        setter(current => current.includes(symbol) ? current : [...current, symbol]);
        requestAnimationFrame(() => document.getElementById(panelId(symbol, kind))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    const groupOptions = [...new Set(baseRows.map((row) => row.group).filter((group): group is string => Boolean(group)))].sort();
    const counts = Object.fromEntries(MARKETS.map(({ id: market }) => [market,
        market === 'all' ? liveRows.length : liveRows.filter((row) => identifyMarketAndCode(row.symbol).market === market).length]));
    // Keep open editors mounted even if a refresh or save changes a field used by the filters.
    const filteredRows = liveRows.filter((row) => editing.includes(row.symbol) || journals.includes(row.symbol) || ((marketFilter === 'all' || identifyMarketAndCode(row.symbol).market === marketFilter)
        && (!groupFilter || (groupFilter === '__ungrouped' ? !row.group : `named:${row.group}` === groupFilter))
        && (!statusFilter || row.reviewStatus === statusFilter) && (!dueOnly || dueSymbols.has(row.symbol))));
    const sortedRows = [...filteredRows].sort((a, b) => {
        if (sortField === 'default') return 0;
        if (sortField === 'distance') {
            const left = distanceFor(a)?.absolutePercent;
            const right = distanceFor(b)?.absolutePercent;
            if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
            return sortAsc ? left - right : right - left;
        }
        const diff = (a[sortField] ?? 0) - (b[sortField] ?? 0);
        return sortAsc ? diff : -diff;
    });
    function toggleSort(field: SortField) {
        setSortAsc(sortField === field ? !sortAsc : field === 'distance');
        setSortField(field);
    }
    function saved(entry: WatchlistEntry) {
        // Explicit undefined fields remove values cleared by the server without touching current quote fields.
        setBaseRows((current) => current.map((row) => row.symbol === entry.symbol ? { ...row, ...entry,
            group: entry.group, note: entry.note, invalidation: entry.invalidation, targetPrice: entry.targetPrice,
            reviewedAt: entry.reviewedAt, observationUpdatedAt: entry.observationUpdatedAt,
            nextReviewDate: entry.nextReviewDate, proximityPercent: entry.proximityPercent } : row));
    }

    if (!liveRows.length) return (
        <div className="empty-state">
            <span className="empty-icon"><Star className="size-5" /></span>
            <h3>自选列表暂无股票</h3>
            <p className="max-w-sm">搜索标的并点击星标加入自选，记录观察理由、失效条件与复核进度。</p>
            <SearchButton className="btn btn-primary mt-3"><Search /> 搜索股票</SearchButton>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">{SUGGESTIONS.map((suggestion) => (
                <Link key={suggestion.symbol} href={`/stocks/${suggestion.symbol}`} className="pill mono h-7 px-3 hover:bg-hover hover:text-foreground">{suggestion.label}</Link>
            ))}</div>
        </div>
    );

    return (
        <div className="flex min-w-0 max-w-full flex-col">
            <section aria-labelledby={`${id}-queue-title`} className="space-y-3 border-b border-line p-3">
                <h3 id={`${id}-queue-title`} className="font-semibold">待复核队列</h3>
                <p className="text-xs text-faint">到期按标的市场日期判断。接近范围默认 ±2%，仅纳入 120 秒内有来源时间的有效成交价；休市、过期、昨收和缺时间报价不列为价格线索。单次快照不判定跨越，也不代表后台预警。</p>
                {!now ? <p role="status" className="text-sm text-faint">正在确认本市场日期…</p> : !queue.length ? <p className="text-sm text-faint">暂无到期计划或符合条件的接近价线索。报价缺失不表示没有价格变化。</p> : <ul className="space-y-2">{queue.map(item => <li key={item.symbol} className="min-w-0 rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/stocks/${item.symbol}`} className="font-medium hover:text-brand-ink">{item.symbol}</Link><div className="flex flex-wrap gap-2">
                        <button type="button" className="btn min-h-12 text-xs" aria-controls={panelId(item.symbol, 'editor')} onClick={() => openPanel(item.symbol, 'editor')}>编辑观察</button>
                        <button type="button" className="btn min-h-12 text-xs" aria-controls={panelId(item.symbol, 'journal')} onClick={() => openPanel(item.symbol, 'journal')}>追加复核 / 历史</button>
                    </div></div>
                    {item.dueDate && <p className="mt-1 text-sm">到期复核：计划 {item.dueDate}；本市场今日 {item.exchangeDate}（{item.timeZone}）。计划更新：{observationTime(baseRows.find(row => row.symbol === item.symbol)?.observationUpdatedAt)}</p>}
                    {item.proximity && <><p className="mt-1 text-sm">接近观察价：现价 {item.proximity.price}，关键价 {item.proximity.targetPrice}；现价{item.proximity.signedPercent > 0 ? '在线上方' : item.proximity.signedPercent < 0 ? '在线下方' : '在线上'} {item.proximity.signedPercent > 0 ? '+' : ''}{item.proximity.signedPercent.toFixed(2)}%，绝对距离 {item.proximity.absolutePercent.toFixed(2)}% ≤ {item.proximity.threshold}%。</p><p className="mt-1 break-words text-xs text-faint">{item.proximity.source} · 行情 {observationTime(item.proximity.asOf)} · 本市场 {item.exchangeDate}</p></>}
                </li>)}</ul>}
            </section>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label="市场筛选">{MARKETS.map((tab) => (
                    <button key={tab.id} type="button" aria-pressed={marketFilter === tab.id} onClick={() => setMarketFilter(tab.id)}
                        className={`rounded-lg px-2.5 py-2 text-xs font-semibold ${marketFilter === tab.id ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'}`}>
                        {tab.label} <span className="text-[10px] opacity-70">({counts[tab.id]})</span>
                    </button>
                ))}</div>
                <span className="mono text-xs text-faint" role="status">{isRealtime ? '15 秒轮询' : '每小时轮询'}{quotes.stale ? ' · 部分更新失败，保留上次报价' : ''}</span>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-3 py-3">
                <div className="min-w-0 max-w-full space-y-1">
                    <label htmlFor={`${id}-group`} className="block text-xs text-faint">自定义分组</label>
                    <select id={`${id}-group`} name="groupFilter" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="min-w-0 max-w-full rounded border border-line bg-background px-2 py-2 text-sm">
                        <option value="">全部分组</option><option value="__ungrouped">未分组</option>
                        {groupOptions.map((group) => <option key={group} value={`named:${group}`}>{group}</option>)}
                    </select>
                </div>
                <div className="min-w-0 max-w-full space-y-1">
                    <label htmlFor={`${id}-status`} className="block text-xs text-faint">复核状态</label>
                    <select id={`${id}-status`} name="statusFilter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReviewStatus | '')} className="min-w-0 max-w-full rounded border border-line bg-background px-2 py-2 text-sm">
                        <option value="">全部状态</option>{Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>
                <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" name="dueOnly" checked={dueOnly} onChange={event => setDueOnly(event.target.checked)} />仅到期待复核</label>
                <p className="text-xs text-faint" role="status">显示 {sortedRows.length} / {liveRows.length} 只{editing.length || journals.length ? ' · 编辑或复核中的标的保留显示' : ''}</p>
                {(marketFilter !== 'all' || groupFilter || statusFilter || dueOnly) && <button type="button" className="btn text-xs" onClick={() => { setMarketFilter('all'); setGroupFilter(''); setStatusFilter(''); setDueOnly(false); }}>重置筛选</button>}
            </div>
            {!sortedRows.length && <p className="py-10 text-center text-sm text-faint">没有符合当前筛选的标的，可重置筛选查看全部。</p>}
            <div className="min-w-0 max-w-full overflow-x-auto">
                <table className="data-table [&_td]:py-3">
                    <caption className="sr-only">自选观察记录、价格变化、同市场基准和行情来源。观察价变动未处理除权和费用。</caption>
                    <thead><tr>
                        <th scope="col">公司 / 详情</th><th scope="col">观察记录</th>
                        <th scope="col" className="is-num" aria-sort={sortField === 'price' ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                            <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('price')}>最新价 <ArrowUpDown className="size-3" /></button>
                            <button type="button" className="mt-1 block text-xs text-faint" onClick={() => toggleSort('changePercent')}>今日涨跌排序{sortField === 'changePercent' ? (sortAsc ? ' ↑' : ' ↓') : ''}</button>
                        </th>
                        <th scope="col" aria-sort={sortField === 'distance' ? (sortAsc ? 'ascending' : 'descending') : 'none'}><button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('distance')}>距关键价 <ArrowUpDown className="size-3" /></button><br /><span className="text-[10px] font-normal">按绝对距离排序</span></th>
                        <th scope="col">较基准涨跌幅差<br /><span className="text-[10px] font-normal">百分点 · 来源昨收口径</span></th>
                        <th scope="col">观察价变动<br /><span className="text-[10px] font-normal">未处理除权/费用</span></th>
                        <th scope="col">行情来源 / 时间</th><th scope="col"><span className="sr-only">操作</span></th>
                    </tr></thead>
                    <tbody>{sortedRows.map((row) => {
                        const market = identifyMarketAndCode(row.symbol).market;
                        const marketTag = MARKETS.find((tab) => tab.id === market)?.label ?? market;
                        const quote = rowQuote(row);
                        const currentQuote = quote;
                        const distance = distanceFor(row);
                        const options = getBenchmarkOptions(row.symbol);
                        const benchmark = options.find((option) => option.symbol === benchmarks[row.symbol]) ?? options[0];
                        const comparison = compareDailyQuotes(row.symbol, currentQuote, benchmark?.symbol ?? '', benchmark ? live[benchmark.symbol] : undefined);
                        const observation = observationPriceChange(row, currentQuote);
                        const isEditing = editing.includes(row.symbol);
                        const editorId = `${id}-editor-${row.symbol.replace(/[^a-zA-Z0-9]/g, '-')}`;
                        return <tr key={row.symbol}>
                                <td className="min-w-[170px] max-w-[240px] align-top">
                                    <Link href={`/stocks/${row.symbol}`} className="font-semibold text-foreground hover:text-brand-ink">{row.name}</Link>
                                    <span className="mono block text-xs text-faint">{row.symbol} · {marketTag}</span>
                                    <details className="mt-2 text-xs text-faint"><summary className="cursor-pointer">财务与加入信息</summary>
                                        <dl className="mt-2 space-y-1"><div><dt className="inline">总市值：</dt><dd className="inline">{row.marketCap != null ? formatNumber(row.marketCap) : '未提供'}</dd></div>
                                            <div><dt className="inline">市盈率：</dt><dd className="inline">{row.peRatio ? row.peRatio.toFixed(2) : '未提供'}</dd></div>
                                            <div><dt className="inline">加入时间：</dt><dd className="inline">{observationTime(row.addedAt)}</dd></div></dl>
                                        <Link href={`/stocks/${row.symbol}`} className="mt-2 inline-block underline">查看图表与财务详情</Link>
                                    </details>
                                </td>
                                <td className="min-w-[220px] max-w-[300px] align-top whitespace-normal">
                                    <div className="flex flex-wrap gap-2 text-xs"><span className="pill">{row.group || '未分组'}</span><span className="pill">{REVIEW_LABELS[row.reviewStatus ?? 'watching']}</span></div>
                                    <p className="mt-2 line-clamp-3 break-words text-xs" title={row.note}>{row.note || '尚未记录观察理由'}</p>
                                    <p className="mt-1 line-clamp-2 break-words text-xs text-faint" title={row.invalidation}>失效：{row.invalidation || '尚未记录'}</p>
                                    <p className="mt-1 text-xs text-faint">关键价：{row.targetPrice != null ? formatPrice(row.targetPrice, row.currency) : '未设置'}</p>
                                    <p className="mt-1 text-xs text-faint">下次复核：{row.nextReviewDate || '未设置'} · 接近 ±{row.proximityPercent ?? 2}%</p>
                                    <p className="mt-2 text-[10px] text-faint">观察更新：{observationTime(row.observationUpdatedAt)}<br />状态标记时间：{observationTime(row.reviewedAt)}</p>
                                    <p className="mt-1 text-[10px] text-faint">记录已验证 / 已失效状态的标记时间；逐次复核请查看历史。</p>
                                </td>
                                <td className="is-num align-top"><PriceFlash value={row.price} className="font-semibold">{row.price > 0 ? formatPrice(row.price, row.currency) : '—'}</PriceFlash>
                                    <div className="mt-2"><ChangePill value={row.price > 0 ? row.changePercent : null} /></div>
                                    {currentQuote?.stale && <p className="mt-1 text-[10px] text-faint">保留上次报价</p>}
                                </td>
                                <td className="min-w-[170px] max-w-[220px] align-top whitespace-normal text-xs">
                                    <p>{distance ? `${distance.signedPercent > 0 ? '+' : ''}${distance.signedPercent.toFixed(2)}% · 绝对 ${distance.absolutePercent.toFixed(2)}%` : '未设置关键价或暂无报价'}</p>
                                    {distance && <p className="mt-1 text-faint">{distance.signedPercent > 0 ? '现价在线上方' : distance.signedPercent < 0 ? '现价在线下方' : '现价在线上'} · 仅报价位置，队列另核新鲜度</p>}
                                </td>
                                <td className="relative min-w-[190px] max-w-[250px] align-top whitespace-normal">
                                    {benchmark ? <><label htmlFor={`${editorId}-benchmark`} className="sr-only">{row.symbol} 比较基准</label>
                                        <select id={`${editorId}-benchmark`} name={`benchmark-${row.symbol}`} value={benchmark.symbol}
                                            onChange={(event) => setBenchmarks((current) => ({ ...current, [row.symbol]: event.target.value }))}
                                            className="max-w-full rounded border border-line bg-background px-1 py-1 text-xs">
                                            {options.map((option) => <option key={option.symbol} value={option.symbol}>{option.label}</option>)}
                                        </select>
                                        <p className="mt-2 text-sm">{comparison.value != null ? `${comparison.value > 0 ? '+' : ''}${comparison.value.toFixed(2)} 个百分点` : '—'}</p>
                                        <p className="mt-1 text-[10px] text-faint">{comparison.value == null ? comparison.reason || '等待可比报价' : `截至 ${observationTime(comparison.asOf)}`}</p>
                                    </> : <p className="text-xs text-faint">暂无可比的同市场基准</p>}
                                </td>
                                <td className="min-w-[170px] max-w-[220px] align-top whitespace-normal">
                                    <p className="text-sm">{observation.value != null ? `${observation.value > 0 ? '+' : ''}${observation.value.toFixed(2)}%` : '—'}</p>
                                    <p className="mt-1 text-[10px] text-faint">{observation.reason || '仅比较成交价，不代表实际收益'}</p>
                                    {row.initialSnapshot && <details className="mt-2 text-[10px] text-faint"><summary className="cursor-pointer">初始观察价来源</summary>
                                        <p>{formatPrice(row.initialSnapshot.price, row.initialSnapshot.currency)} · {row.initialSnapshot.source}</p>
                                        <p>行情：{observationTime(row.initialSnapshot.asOf)}</p><p>获取：{observationTime(row.initialSnapshot.fetchedAt)}</p>
                                        <p>成交价 · 未复权</p>
                                    </details>}
                                </td>
                                <td className="min-w-[170px] max-w-[220px] align-top whitespace-normal text-xs text-faint">
                                    <p>{quote?.source || '来源未提供'}</p><p className="mt-1">行情：{observationTime(quote?.asOf)}</p>
                                    <p className="mt-1">获取：{observationTime(quote?.fetchedAt)}</p>
                                    <p className="mt-1">{currentQuote?.stale ? '更新失败 · 保留旧值' : quote ? (quote.priceBasis === 'previous-close' ? '昨收价' : '来源最新报价') : quotes.loading ? '正在获取行情' : '暂未取得行情来源'}</p>
                                </td>
                                <td className="align-top"><div className="flex flex-wrap items-center justify-end gap-1">
                                    <button type="button" aria-expanded={isEditing} aria-controls={editorId} className="btn text-xs"
                                        onClick={() => isEditing ? setEditing(current => current.filter(symbol => symbol !== row.symbol)) : openPanel(row.symbol, 'editor')}>编辑观察</button>
                                    <button type="button" aria-expanded={journals.includes(row.symbol)} aria-controls={panelId(row.symbol, 'journal')} className="btn text-xs" onClick={() => journals.includes(row.symbol) ? closeJournal(row.symbol) : openPanel(row.symbol, 'journal')}>历史 / 追加复核</button>
                                    {alertsEnabled && getInstrumentCapabilities(row.symbol).alerts ? (
                                        <CreateAlertModal symbol={row.symbol} currentPrice={row.price} currency={row.currency}>
                                            <button type="button" className="icon-btn" title={`为 ${row.symbol} 设置价格预警`} aria-label={`为 ${row.symbol} 设置价格预警`}><Bell /></button>
                                        </CreateAlertModal>
                                    ) : <span className="icon-btn opacity-40" title="价格预警需要受支持的标的及实时部署模式"><Bell /></span>}
                                    <WatchlistButton symbol={row.symbol} company={row.name} isInWatchlist variant="icon" onWatchlistChange={(symbol, added) => {
                                        if (!added) { setBaseRows((current) => current.filter((item) => item.symbol !== symbol)); setEditing((current) => current.filter((item) => item !== symbol)); setJournals(current => current.filter(item => item !== symbol)); }
                                    }} />
                                </div></td>
                            </tr>;
                    })}</tbody>
                </table>
            </div>
            {baseRows.filter((row) => editing.includes(row.symbol)).map((row) => (
                <div key={row.symbol} id={panelId(row.symbol, 'editor')} className="min-w-0 p-3">
                    <ObservationEditor entry={row} currency={row.currency} onSaved={saved} onClose={() => setEditing((current) => current.filter((symbol) => symbol !== row.symbol))} />
                </div>
            ))}
            {baseRows.filter(row => journals.includes(row.symbol)).map(row => <div key={row.symbol} id={panelId(row.symbol, 'journal')} className="min-w-0 p-3">
                <WatchlistJournal entry={row} evidenceReferences={journalEvidence[row.symbol]} onSaved={saved} onClose={() => closeJournal(row.symbol)} />
            </div>)}
        </div>
    );
}
