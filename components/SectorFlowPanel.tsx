import React from "react";
import Link from "next/link";
import { Flame, TrendingUp } from "lucide-react";
import Panel from "@/components/Panel";
import ChangePill from "@/components/ChangePill";
import { getChinaSectorRankings, type SectorFlowItem } from "@/lib/actions/china-market.actions";

function formatNetInflow(val: number): string {
    if (!val || !Number.isFinite(val)) return '—';
    const sign = val > 0 ? '+' : '';
    const abs = Math.abs(val);
    if (abs >= 1e8) return `${sign}${(val / 1e8).toFixed(2)}亿`;
    if (abs >= 1e4) return `${sign}${(val / 1e4).toFixed(0)}万`;
    return `${sign}${Math.round(val)}`;
}

function SectorList({ items, mode }: { items: SectorFlowItem[]; mode: 'gain' | 'inflow' }) {
    if (!items.length) {
        return <div className="p-4 text-center text-xs text-faint">暂无板块实时排行数据</div>;
    }

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((sec) => {
                const isInflowPos = sec.mainNetInflow >= 0;
                const isLeaderUp = sec.leaderChangePercent >= 0;
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
                                {formatNetInflow(sec.mainNetInflow)} ({sec.mainNetRatio >= 0 ? `+${sec.mainNetRatio.toFixed(1)}%` : `${sec.mainNetRatio.toFixed(1)}%`})
                            </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                            <span className="text-faint">领涨龙头:</span>
                            <Link
                                href={`/stocks/${sec.leaderSymbol}`}
                                className="group flex items-center gap-1.5 font-semibold hover:underline"
                            >
                                <span className="text-brand-ink group-hover:text-foreground">{sec.leaderName}</span>
                                <span className={`mono ${isLeaderUp ? 'text-up' : 'text-down'}`}>
                                    {sec.leaderChangePercent >= 0 ? `+${sec.leaderChangePercent.toFixed(2)}%` : `${sec.leaderChangePercent.toFixed(2)}%`}
                                </span>
                            </Link>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default async function SectorFlowPanel() {
    const { topGainers, topInflows } = await getChinaSectorRankings();
    if (!topGainers.length && !topInflows.length) return null;

    return (
        <div className="grid gap-3 xl:grid-cols-2">
            <Panel
                title="领涨行业板块风向标"
                sub="实时涨幅居前主线板块 · 点击领涨龙头直达个股 K 线与盘口"
                action={
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-up">
                        <Flame className="size-3.5" /> 热点主线
                    </span>
                }
            >
                <div className="p-3">
                    <SectorList items={topGainers} mode="gain" />
                </div>
            </Panel>

            <Panel
                title="主力资金吸筹板块榜"
                sub="按超大单+大单今日主力净流入排序 · 洞察机构抱团方向"
                action={
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-brand-ink">
                        <TrendingUp className="size-3.5" /> 机构抢筹
                    </span>
                }
            >
                <div className="p-3">
                    <SectorList items={topInflows} mode="inflow" />
                </div>
            </Panel>
        </div>
    );
}
