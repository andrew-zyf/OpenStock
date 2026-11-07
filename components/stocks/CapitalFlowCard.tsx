'use client';

import React, { useEffect, useState } from "react";
import Panel from "@/components/Panel";
import { getCapitalFlow } from "@/lib/actions/realtime-market.actions";
import type { CapitalFlowData } from "@/lib/realtime-market";

function formatFlowAmount(val: number, currency: string): string {
    if (!val || !Number.isFinite(val)) return '0.00万';
    const sign = val > 0 ? '+' : '';
    const abs = Math.abs(val);
    const unit = currency === 'HKD' ? '港元' : currency === 'TWD' ? '台币' : '元';
    if (abs >= 1e8) return `${sign}${(val / 1e8).toFixed(2)}亿${unit}`;
    if (abs >= 1e4) return `${sign}${(val / 1e4).toFixed(2)}万${unit}`;
    return `${sign}${Math.round(val).toLocaleString()}${unit}`;
}

export default function CapitalFlowCard({ symbol }: { symbol: string }) {
    const [flow, setFlow] = useState<CapitalFlowData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        const load = () => {
            getCapitalFlow(symbol).then((data) => {
                if (active) {
                    setFlow(data);
                    setLoading(false);
                }
            });
        };

        load();
        const timer = setInterval(load, 15000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [symbol]);

    if (!flow) {
        if (loading) {
            return (
                <Panel title="主力与散户资金流向" sub="实时超大单/大单/中单/小单筹码博弈">
                    <div className="flex h-44 items-center justify-center text-xs text-faint">
                        正在加载实时主力资金流向...
                    </div>
                </Panel>
            );
        }
        return null;
    }

    const tiers = [
        { label: '超大单 (机构/封板)', desc: '>100万元', amount: flow.superLargeInflow, ratio: flow.superLargeRatio },
        { label: '大单 (主力大户)', desc: '20-100万元', amount: flow.largeInflow, ratio: flow.largeRatio },
        { label: '中单 (中户博弈)', desc: '4-20万元', amount: flow.mediumInflow, ratio: flow.mediumRatio },
        { label: '小单 (散户游击)', desc: '<4万元', amount: flow.smallInflow, ratio: flow.smallRatio },
    ];

    const maxAbsAmount = Math.max(...tiers.map((t) => Math.abs(t.amount)), 1);
    const isMainIn = flow.mainNetInflow >= 0;

    return (
        <Panel
            title="主力与散户资金流向"
            sub="超大单/大单主力动向 vs 中小单散户博弈"
            action={<span className="mono text-[11px] text-faint">15秒刷新</span>}
        >
            <div className="flex flex-col gap-3 p-3.5 text-xs">
                {/* 主力净流入核心横幅 */}
                <div className="flex items-center justify-between rounded-lg bg-page/50 p-3 border border-line">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] text-faint">今日主力净流入 (超大单+大单)</span>
                        <span className={`mono text-lg font-bold ${isMainIn ? 'text-up' : 'text-down'}`}>
                            {formatFlowAmount(flow.mainNetInflow, flow.currency)}
                        </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[11px] text-faint">主力净占比</span>
                        <span className={`pill mono px-2 py-0.5 text-xs font-bold ${isMainIn ? 'bg-red-500/15 text-up' : 'bg-emerald-500/15 text-down'}`}>
                            {flow.mainNetRatio >= 0 ? `+${flow.mainNetRatio.toFixed(2)}%` : `${flow.mainNetRatio.toFixed(2)}%`}
                        </span>
                    </div>
                </div>

                {/* 四级资金明细条 */}
                <div className="flex flex-col gap-2">
                    {tiers.map((t) => {
                        const isPositive = t.amount >= 0;
                        const barPct = Math.min(100, Math.max(4, Math.round((Math.abs(t.amount) / maxAbsAmount) * 100)));
                        return (
                            <div key={t.label} className="flex flex-col gap-1 rounded-lg bg-page/30 p-2 border border-line/60">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-foreground">{t.label}</span>
                                    <div className="flex items-center gap-2 mono">
                                        <span className={`font-semibold ${isPositive ? 'text-up' : 'text-down'}`}>
                                            {formatFlowAmount(t.amount, flow.currency)}
                                        </span>
                                        <span className="text-[11px] text-faint w-14 text-right">
                                            ({t.ratio >= 0 ? `+${t.ratio.toFixed(2)}%` : `${t.ratio.toFixed(2)}%`})
                                        </span>
                                    </div>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
                                    <div
                                        className={`h-full rounded-full transition-all ${isPositive ? 'bg-red-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${barPct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Panel>
    );
}
