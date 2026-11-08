import React from "react";
import { Activity, DollarSign, Flame } from "lucide-react";
import { getChinaMarketMacro, type MarketResourceMetadata } from "@/lib/actions/china-market.actions";
import ChangePill from "@/components/ChangePill";

function SourceNote({ metadata }: { metadata: MarketResourceMetadata }) {
    return <p className="mt-1 text-[11px] text-faint break-words">
        {metadata.source} · {metadata.asOf ? <>来源时间 <time dateTime={metadata.asOf}>{metadata.asOf}</time></> : '来源时间未提供'}
        {' · 获取于 '}<time dateTime={metadata.fetchedAt}>{metadata.fetchedAt}</time>
        {metadata.error ? ' · 来源暂不可用' : ''}
        <br />{metadata.coverage}
    </p>;
}

export default async function ChinaMarketMacroBar() {
    const macro = await getChinaMarketMacro();
    const { upCount: up, downCount: down, flatCount: flat } = macro;
    const totalBreadth = up != null && down != null && flat != null ? up + down + flat : undefined;
    const upRatio = totalBreadth != null && totalBreadth > 0 && up != null ? (up / totalBreadth) * 100 : undefined;
    const count = (value?: number) => value == null ? '—' : value.toLocaleString('zh-CN');

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-faint">
                        <Activity aria-hidden="true" className="size-3.5 text-brand-ink" />
                        <span>A股（沪深）成交额</span>
                    </div>
                    <p className="num mt-1 text-lg font-bold tracking-tight text-foreground">
                        {macro.totalTurnoverText}
                    </p>
                    <p className="mt-0.5 text-[11px] text-faint">
                        沪市 {macro.shTurnoverText} · 深市 {macro.szTurnoverText}
                        {macro.totalTurnoverYi == null ? ' · 缺少完整两市合计' : ''}
                    </p>
                    <SourceNote metadata={macro.sources.turnover} />
                </div>
            </div>

            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-faint">
                        <Flame aria-hidden="true" className="size-3.5 text-brand-ink" />
                        <span>A股（沪深）样本涨跌分布</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                        样本上涨占比 {upRatio == null ? '—' : `${upRatio.toFixed(1)}%`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-xs font-bold mono">
                        <span className="text-up">涨 {count(up)} 家</span>
                        <span className="text-faint">平 {count(flat)} 家</span>
                        <span className="text-down">跌 {count(down)} 家</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-faint">样本合计 {count(totalBreadth)} 家；缺字段时不计算占比</p>
                    <SourceNote metadata={macro.sources.breadth} />
                </div>
            </div>

            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-faint">
                        <DollarSign aria-hidden="true" className="size-3.5 text-brand-ink" />
                        <span>离岸人民币 (USD/CNH)</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className="num text-lg font-bold tracking-tight text-foreground">
                            {macro.usdcnhRate == null ? '—' : macro.usdcnhRate.toFixed(4)}
                        </span>
                        {macro.usdcnhChangePercent != null && <ChangePill value={macro.usdcnhChangePercent} />}
                    </div>
                    <SourceNote metadata={macro.sources.fx} />
                </div>
            </div>
        </div>
    );
}
