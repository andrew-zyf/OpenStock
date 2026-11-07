import React from "react";
import { Activity, DollarSign, Layers } from "lucide-react";
import { getChinaMarketMacro } from "@/lib/actions/china-market.actions";
import ChangePill from "@/components/ChangePill";

export default async function ChinaMarketMacroBar() {
    const macro = await getChinaMarketMacro();
    if (!macro) return null;

    let liquidityLabel = '存量博弈';
    let liquidityPillClass = 'text-faint bg-white/5';
    if (macro.totalTurnoverYi >= 15000) {
        liquidityLabel = '充沛巨量';
        liquidityPillClass = 'text-up bg-up-soft/40';
    } else if (macro.totalTurnoverYi >= 10000) {
        liquidityLabel = '活跃放量';
        liquidityPillClass = 'text-brand-ink bg-brand-soft/50';
    } else if (macro.totalTurnoverYi >= 8000) {
        liquidityLabel = '常规成交';
        liquidityPillClass = 'text-muted-foreground bg-white/5';
    }

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {/* 两市成交额 */}
            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-faint">
                        <Activity className="size-3.5 text-brand-ink" />
                        <span>两市总成交额</span>
                        <span className={`pill ml-1 px-1.5 py-0.5 text-[10px] font-semibold ${liquidityPillClass}`}>
                            {liquidityLabel}
                        </span>
                    </div>
                    <p className="num mt-1 truncate text-lg font-bold tracking-tight text-foreground">
                        {macro.totalTurnoverText}
                    </p>
                    <p className="mt-0.5 text-[11px] text-faint">
                        沪市 {macro.shTurnoverText} · 深市 {macro.szTurnoverText}
                    </p>
                </div>
            </div>

            {/* 离岸人民币 USD/CNH */}
            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-faint">
                        <DollarSign className="size-3.5 text-brand-ink" />
                        <span>离岸人民币 (USD/CNH)</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className="num text-lg font-bold tracking-tight text-foreground">
                            {macro.usdcnhRate ? macro.usdcnhRate.toFixed(4) : '—'}
                        </span>
                        {macro.usdcnhChangePercent != null && (
                            <ChangePill value={macro.usdcnhChangePercent} />
                        )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-faint">
                        汇率波动联动北向资金与 A/H 溢价
                    </p>
                </div>
            </div>

            {/* 市场流动性洞察 */}
            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-faint">
                        <Layers className="size-3.5 text-brand-ink" />
                        <span>大中华市场监控</span>
                    </div>
                    <p className="mt-1 truncate text-[14px] font-semibold text-foreground">
                        A股 · 港股 · 台股 联动
                    </p>
                    <p className="mt-0.5 text-[11px] text-faint">
                        更新时间: {macro.updateTime} (1分钟轮询)
                    </p>
                </div>
            </div>
        </div>
    );
}
