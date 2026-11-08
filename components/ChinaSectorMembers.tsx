'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ChangePill from '@/components/ChangePill';
import WatchlistButton from '@/components/WatchlistButton';
import { getChinaSectorMembers } from '@/lib/actions/sector-members.actions';
import { canonicalCNsymbol, isChinaIndustryCode, type ChinaSectorMember, type SectorMembersData } from '@/lib/market/sector-members';

type MembersLoader = (code: string) => Promise<SectorMembersData>;

/** Share duplicate cards, cache for five minutes, and bound simultaneous expanded sectors to two. */
export function createSectorMembersLoader(fetcher: MembersLoader = getChinaSectorMembers): MembersLoader {
    const cache = new Map<string, { promise: Promise<SectorMembersData>; expires: number }>();
    const queue: (() => void)[] = [];
    let active = 0;
    return (code) => {
        const cached = cache.get(code);
        if (cached && cached.expires > Date.now()) return cached.promise;
        // The panel has at most twelve cards; discard expired responses between checks.
        for (const [key, value] of cache) if (value.expires <= Date.now()) cache.delete(key);
        const promise = new Promise<SectorMembersData>((resolve, reject) => {
            const run = () => {
                active++;
                Promise.resolve().then(() => fetcher(code)).then((result) => {
                    if (result.status === 'error') cache.delete(code);
                    resolve(result);
                }, (error) => { cache.delete(code); reject(error); }).finally(() => {
                    active--;
                    queue.shift()?.();
                });
            };
            if (active < 2) run();
            else queue.push(run);
        });
        cache.set(code, { promise, expires: Date.now() + 300_000 });
        return promise;
    };
}

function MemberList({ members, watchlistSymbols, onWatchlistChange }: {
    members: ChinaSectorMember[]; watchlistSymbols: string[]; onWatchlistChange: (symbol: string, added: boolean) => void;
}) {
    const saved = new Set(watchlistSymbols.flatMap((symbol) => canonicalCNsymbol(symbol) ?? []));
    return <ul className="grid gap-2">
        {members.map((member) => <li key={member.symbol} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-2">
            <Link href={`/stocks/${encodeURIComponent(member.symbol)}`} className="min-w-0 flex-1 hover:underline">
                <span className="break-words text-foreground">{member.name}</span>
                <span className="ml-1 text-faint">{member.symbol}</span>
                {saved.has(member.symbol) && <span className="ml-1 text-brand-ink">已自选</span>}
                <span className="mt-1 block text-faint">来源价 {member.price === undefined ? '—' : `${member.price.toFixed(2)} CNY`} · {member.asOf ?? '来源未提供行情时间'}</span>
                {member.changePercent === undefined && <span className="text-faint">涨跌幅未纳入统计</span>}
            </Link>
            <ChangePill value={member.changePercent} />
            <WatchlistButton key={`${member.symbol}:${saved.has(member.symbol)}`} symbol={member.symbol} company={member.name}
                variant="icon" isInWatchlist={saved.has(member.symbol)} onWatchlistChange={onWatchlistChange} />
        </li>)}
    </ul>;
}

export function SectorMembersContent({ data, watchlistSymbols, onWatchlistChange }: {
    data: SectorMembersData; watchlistSymbols: string[]; onWatchlistChange: (symbol: string, added: boolean) => void;
}) {
    if (data.status === 'unsupported') return <p role="status">该板块不支持 A股行业成员下钻。</p>;
    if (data.status === 'error') return <p role="status">行业成员来源暂不可用。</p>;
    const sorted = [...data.members].filter((member) => member.changePercent !== undefined).sort((a, b) => b.changePercent! - a.changePercent!);
    const gainers = sorted.filter((member) => member.changePercent! > 0).slice(0, 5);
    const laggards = sorted.filter((member) => member.changePercent! < 0).reverse().slice(0, 5);
    const listProps = { watchlistSymbols, onWatchlistChange };
    return <div className="grid min-w-0 gap-3">
        <p className="text-faint">{data.coverage}</p>
        {data.status === 'partial' && <p className="text-amber-500">样本或行情覆盖不完整，仅代表可用成员。</p>}
        <p>来源日期：{data.date ?? '未提供'} · 最新成员时间：{data.asOf ?? '未提供'} · 获取于 {data.fetchedAt}</p>
        {data.status === 'empty' ? <p role="status">来源当前返回空成员清单。</p> : <>
            <p>样本上涨 {data.breadth.up} · 下跌 {data.breadth.down} · 平盘 {data.breadth.flat} · 缺失或不同日 {data.breadth.missing}</p>
            <p>有效样本等权涨跌幅均值：{data.averageChangePercent === undefined ? '—' : `${data.averageChangePercent > 0 ? '+' : ''}${data.averageChangePercent.toFixed(2)}%`}</p>
            <section aria-label="样本上涨成员">
                <h3 className="mb-2 font-semibold">样本上涨 · 前 5 只</h3>
                {gainers.length ? <MemberList members={gainers} {...listProps} /> : <p className="text-faint">暂无可纳入的上涨成员。</p>}
            </section>
            <section aria-label="样本落后成员">
                <h3 className="mb-2 font-semibold">样本落后 · 跌幅前 5 只</h3>
                {laggards.length ? <MemberList members={laggards} {...listProps} /> : <p className="text-faint">暂无可纳入的下跌成员。</p>}
            </section>
            <details>
                <summary className="cursor-pointer font-semibold">全部已取成员（{data.members.length} 只，含平盘与缺失）</summary>
                <div className="mt-3 max-h-80 overflow-y-auto"><MemberList members={data.members} {...listProps} /></div>
            </details>
        </>}
        {data.notes.map((note) => <p key={note} className="text-faint">{note}</p>)}
        <p className="text-faint">来源：<a href={data.sourceUrl} target="_blank" rel="noreferrer" className="underline">{data.source}</a> · 按需读取，缓存 5 分钟</p>
    </div>;
}

export default function ChinaSectorMembers({ sectorCode, watchlistSymbols = [], onWatchlistChange, loadMembers, market = 'cn' }: {
    sectorCode: string; watchlistSymbols?: string[]; onWatchlistChange: (symbol: string, added: boolean) => void;
    loadMembers: MembersLoader; market?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const [data, setData] = useState<SectorMembersData>();
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const supported = market === 'cn' && isChinaIndustryCode(sectorCode);
    useEffect(() => {
        if (!expanded || !supported) return;
        let cancelled = false;
        setLoading(true);
        setFailed(false);
        loadMembers(sectorCode).then((result) => {
            if (cancelled) return;
            if (result.status === 'error') {
                setFailed(true);
                setData((previous) => previous?.members.length ? previous : result);
            } else setData(result);
        }, () => { if (!cancelled) setFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [expanded, supported, sectorCode, loadMembers, attempt]);
    if (!supported) return <p className="text-[11px] text-faint">该板块不支持 A股行业成员下钻。</p>;
    return <details className="border-t border-line/50 pt-2 text-[11px]" onToggle={(event) => {
        if (event.target === event.currentTarget) setExpanded(event.currentTarget.open);
    }}>
        <summary className="cursor-pointer font-semibold text-brand-ink">展开行业成员</summary>
        <div className="mt-3 grid gap-3" aria-busy={loading}>
            {loading && <p role="status">正在读取行业成员…</p>}
            {failed && <p role="status">{data?.members.length ? '更新失败，保留上次成员样本。' : '行业成员请求失败，请重试。'}</p>}
            {data && <SectorMembersContent data={data} watchlistSymbols={watchlistSymbols} onWatchlistChange={onWatchlistChange} />}
            {(failed || data?.status === 'error') && <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>重试成员来源</button>}
        </div>
    </details>;
}
