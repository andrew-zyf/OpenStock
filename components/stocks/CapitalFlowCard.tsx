'use client';

import React from "react";
import { useMarketResource } from '@/hooks/useMarketResource';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import Panel from "@/components/Panel";
import { getCapitalFlow } from "@/lib/actions/realtime-market.actions";
import type { CapitalFlowData } from "@/lib/realtime-market";

function formatFlowAmount(val: number | undefined, currency: string): string {
    if (val == null || !Number.isFinite(val)) return '—';
    const sign = val > 0 ? '+' : '';
    const abs = Math.abs(val);
    const unit = currency === 'HKD' ? '港元' : currency === 'TWD' ? '台币' : '元';
    if (abs >= 1e8) return `${sign}${(val / 1e8).toFixed(2)}亿${unit}`;
    if (abs >= 1e4) return `${sign}${(val / 1e4).toFixed(2)}万${unit}`;
    return `${sign}${Math.round(val).toLocaleString()}${unit}`;
}

export default function CapitalFlowCard({ symbol }: { symbol: string }) {
    const supported = getInstrumentCapabilities(symbol).capitalFlow;
    const resource = useMarketResource<CapitalFlowData | null>({
        key: `flow:${symbol}`, enabled: supported, intervalMs: 15_000,
        loader: async () => {
            const data = await getCapitalFlow(symbol);
            if (!data) throw new Error('资金流向暂不可用');
            return data;
        },
    });
    const flow = resource.data;
    if (!flow) return (
        <Panel title="主力与散户资金流向" sub="按数据源订单分类展示">
            <div className="flex h-44 items-center justify-center text-xs text-faint" role="status">
                {!supported ? '当前标的暂不支持资金流向' : resource.loading ? '正在加载资金流向...' : resource.error && resource.error.message !== '资金流向暂不可用' ? '资金流向请求失败，稍后自动重试' : '暂无资金流向数据，稍后自动重试'}
            </div>
        </Panel>
    );
    const ratio = (value?: number) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

    const tiers = [
        { label: '超大单 (机构/封板)', desc: '>100万元', amount: flow.superLargeInflow, ratio: flow.superLargeRatio },
        { label: '大单 (主力大户)', desc: '20-100万元', amount: flow.largeInflow, ratio: flow.largeRatio },
        { label: '中单 (中户博弈)', desc: '4-20万元', amount: flow.mediumInflow, ratio: flow.mediumRatio },
        { label: '小单 (散户游击)', desc: '<4万元', amount: flow.smallInflow, ratio: flow.smallRatio },
    ];

    const maxAbsAmount = Math.max(...tiers.map((t) => Math.abs(t.amount ?? 0)), 1);
    const isMainIn = (flow.mainNetInflow ?? 0) >= 0;

    return (
        <Panel
            title="主力与散户资金流向"
            sub={`${flow.source} · ${flow.asOf ? `截至 ${flow.asOf}` : '源时间未提供'} · ${flow.currency}`}
            action={<span className="mono text-[11px] text-faint">15秒刷新</span>}
        >
            <div className="flex flex-col gap-3 p-3.5 text-xs">
                {resource.stale && <p className="text-faint" role="status">更新失败，保留上次数据</p>}
                {[flow.mainNetInflow, flow.superLargeInflow, flow.largeInflow, flow.mediumInflow, flow.smallInflow].every((value) => value == null) && <p className="text-faint">数据源未提供资金流金额</p>}
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
                            {ratio(flow.mainNetRatio)}
                        </span>
                    </div>
                </div>

                {/* 四级资金明细条 */}
                <div className="flex flex-col gap-2">
                    {tiers.map((t) => {
                        const isPositive = (t.amount ?? 0) >= 0;
                        const barPct = Math.min(100, Math.round((Math.abs(t.amount ?? 0) / maxAbsAmount) * 100));
                        return (
                            <div key={t.label} className="flex flex-col gap-1 rounded-lg bg-page/30 p-2 border border-line/60">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium text-foreground">{t.label}</span>
                                    <div className="flex items-center gap-2 mono">
                                        <span className={`font-semibold ${isPositive ? 'text-up' : 'text-down'}`}>
                                            {formatFlowAmount(t.amount, flow.currency)}
                                        </span>
                                        <span className="text-[11px] text-faint w-14 text-right">
                                            ({ratio(t.ratio)})
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
