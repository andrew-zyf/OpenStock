'use client';

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMarketResource } from '@/hooks/useMarketResource';
import Link from "next/link";
import { Flame, TrendingUp } from "lucide-react";
import Panel from "@/components/Panel";
import ChangePill from "@/components/ChangePill";
import { getChinaSectorRankings, type SectorFlowItem } from "@/lib/actions/china-market.actions";
import ChinaSectorMembers, { createSectorMembersLoader } from '@/components/ChinaSectorMembers';
import { canonicalCNsymbol } from '@/lib/market/sector-members';

function formatNetInflow(val?: number): string {
    if (val == null || !Number.isFinite(val)) return '—';
    const sign = val > 0 ? '+' : '';
    const abs = Math.abs(val);
    if (abs >= 1e8) return `${sign}${(val / 1e8).toFixed(2)}亿`;
    if (abs >= 1e4) return `${sign}${(val / 1e4).toFixed(0)}万`;
    return `${sign}${Math.round(val)}`;
}

function SectorList({ items, mode, watchlistSymbols, onWatchlistChange, loadMembers }: {
    items: SectorFlowItem[]; mode: 'gain' | 'inflow'; watchlistSymbols: string[];
    onWatchlistChange: (symbol: string, added: boolean) => void;
    loadMembers: ReturnType<typeof createSectorMembersLoader>;
}) {
    if (!items.length) {
        return <div className="p-4 text-center text-xs text-faint">暂无板块实时排行数据</div>;
    }

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((sec) => {
                const isInflowPos = (sec.mainNetInflow ?? 0) >= 0;
                const isLeaderUp = (sec.leaderChangePercent ?? 0) >= 0;
                const leaderSymbol = canonicalCNsymbol(sec.leaderSymbol);
                return (
                    <div
                        key={`${mode}-${sec.code}`}
                        className="flex flex-col justify-between gap-2 rounded-lg border border-line bg-page/40 p-3 transition-colors hover:bg-hover/40"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-foreground">{sec.name}</span>
                            <ChangePill value={sec.changePercent} />
                        </div>

                        <div className="flex items-center justify-between text-[11px] border-t border-line/50 pt-2">
                            <span className="text-faint">主力净流入:</span>
                            <span className={`mono font-semibold ${isInflowPos ? 'text-up' : 'text-down'}`}>
                                {formatNetInflow(sec.mainNetInflow)} CNY ({sec.mainNetRatio == null ? '—' : `${sec.mainNetRatio > 0 ? '+' : ''}${sec.mainNetRatio.toFixed(1)}%`})
                            </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                            <span className="text-faint">领涨龙头:</span>
                            {leaderSymbol ? <Link
                                href={`/stocks/${encodeURIComponent(leaderSymbol)}`}
                                className="group flex items-center gap-1.5 font-semibold hover:underline"
                            >
                                <span className="text-brand-ink group-hover:text-foreground">{sec.leaderName}</span>
                                <span className={`mono ${isLeaderUp ? 'text-up' : 'text-down'}`}>
                                    {sec.leaderChangePercent == null ? '—' : `${sec.leaderChangePercent > 0 ? '+' : ''}${sec.leaderChangePercent.toFixed(2)}%`}
                                </span>
                            </Link> : <span className="text-faint">—</span>}
                        </div>
                        <ChinaSectorMembers sectorCode={sec.code} watchlistSymbols={watchlistSymbols}
                            onWatchlistChange={onWatchlistChange} loadMembers={loadMembers} />
                    </div>
                );
            })}
        </div>
    );
}

type SectorSnapshot = Awaited<ReturnType<typeof getChinaSectorRankings>> & {
    topGainersFetchedAt?: string; topInflowsFetchedAt?: string;
};

export default function SectorFlowPanel({ initialData, selectedMarket, watchlistSymbols = [] }: {
    initialData: SectorSnapshot; selectedMarket: string; watchlistSymbols?: string[];
}) {
    const [watchlistChanges, setWatchlistChanges] = useState<Record<string, boolean>>({});
    const saved = new Set(watchlistSymbols.flatMap((symbol) => canonicalCNsymbol(symbol) ?? []));
    for (const [symbol, added] of Object.entries(watchlistChanges)) {
        if (added) saved.add(symbol);
        else saved.delete(symbol);
    }
    const memberLoader = useRef<ReturnType<typeof createSectorMembersLoader> | null>(null);
    if (!memberLoader.current) memberLoader.current = createSectorMembersLoader();
    const onWatchlistChange = useCallback((symbol: string, added: boolean) => {
        const canonical = canonicalCNsymbol(symbol);
        if (canonical) setWatchlistChanges((previous) => ({ ...previous, [canonical]: added }));
    }, []);
    const memberProps = { watchlistSymbols: [...saved], onWatchlistChange, loadMembers: memberLoader.current };
    const seed = { ...initialData,
        topGainersFetchedAt: initialData.errors?.topGainers ? undefined : initialData.fetchedAt,
        topInflowsFetchedAt: initialData.errors?.topInflows ? undefined : initialData.fetchedAt };
    const previous = useRef<SectorSnapshot>(seed);
    const resource = useMarketResource<SectorSnapshot>({
        key: 'sectors:cn', initialData: seed, intervalMs: 30_000,
        loader: async () => {
            const next = await getChinaSectorRankings();
            if (next.errors?.topGainers && next.errors?.topInflows) throw new Error('板块排行请求失败');
            return { ...next,
                topGainers: next.errors?.topGainers ? previous.current.topGainers : next.topGainers,
                topInflows: next.errors?.topInflows ? previous.current.topInflows : next.topInflows,
                topGainersFetchedAt: next.errors?.topGainers ? previous.current.topGainersFetchedAt : next.fetchedAt,
                topInflowsFetchedAt: next.errors?.topInflows ? previous.current.topInflowsFetchedAt : next.fetchedAt,
            };
        },
    });
    useEffect(() => { if (resource.data) previous.current = resource.data; }, [resource.data]);
    const data = resource.data ?? seed;
    const { topGainers, topInflows } = data;
    const status = (failed: boolean, fetchedAt?: string) => `东方财富 · 源时间未提供${fetchedAt ? ` · 获取于 ${fetchedAt}` : ''}${failed ? ' · 更新失败，保留上次数据' : ''} · 30秒轮询`;
    const scope = selectedMarket === 'cn' ? 'A股' : 'A股板块（非当前市场）';

    return (
        <div className="grid gap-3 xl:grid-cols-2">
            <Panel
                title={`${scope} · 领涨行业板块风向标`}
                sub={status(resource.stale || Boolean(data.errors?.topGainers), data.topGainersFetchedAt)}
                action={
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-up">
                        <Flame className="size-3.5" /> 热点主线
                    </span>
                }
            >
                <div className="p-3">
                    <SectorList items={topGainers} mode="gain" {...memberProps} />
                </div>
            </Panel>

            <Panel
                title={`${scope} · 主力资金吸筹板块榜`}
                sub={status(resource.stale || Boolean(data.errors?.topInflows), data.topInflowsFetchedAt)}
                action={
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-brand-ink">
                        <TrendingUp className="size-3.5" /> 机构抢筹
                    </span>
                }
            >
                <div className="p-3">
                    <SectorList items={topInflows} mode="inflow" {...memberProps} />
                </div>
            </Panel>
        </div>
    );
}
