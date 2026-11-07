import React from "react";
import { Activity, DollarSign, Flame } from "lucide-react";
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

    const up = macro.upCount ?? 0;
    const down = macro.downCount ?? 0;
    const flat = macro.flatCount ?? 0;
    const totalBreadth = up + down + flat;
    const upRatio = totalBreadth > 0 ? Math.round((up / totalBreadth) * 100) : 50;
    const downRatio = totalBreadth > 0 ? Math.round((down / totalBreadth) * 100) : 50;

    let moodLabel = '分化震荡';
    let moodClass = 'text-amber-400 bg-amber-500/15';
    if (upRatio >= 65) {
        moodLabel = '普涨逼空';
        moodClass = 'text-up bg-red-500/15';
    } else if (upRatio >= 50) {
        moodLabel = '多头占优';
        moodClass = 'text-up bg-red-500/10';
    } else if (upRatio < 30) {
        moodLabel = '普跌防御';
        moodClass = 'text-down bg-emerald-500/15';
    }

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {/* 1. 两市成交额 */}
            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] text-faint">
                        <Activity className="size-3.5 text-brand-ink" />
                        <span>沪深两市总成交额</span>
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

            {/* 2. 两市涨跌分布与赚钱效应温度计 */}
            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[12px] text-faint">
                        <span className="flex items-center gap-1.5">
                            <Flame className="size-3.5 text-brand-ink" />
                            <span>涨跌分布与赚钱效应</span>
                        </span>
                        <span className={`pill px-1.5 py-0.5 text-[10px] font-semibold ${moodClass}`}>
                            {moodLabel} ({upRatio}%)
                        </span>
                    </div>

                    {totalBreadth > 0 ? (
                        <>
                            <div className="mt-1.5 flex items-center justify-between text-xs font-bold mono">
                                <span className="text-up">涨 {up.toLocaleString()} 家</span>
                                <span className="text-faint text-[11px]">平 {flat.toLocaleString()}</span>
                                <span className="text-down">跌 {down.toLocaleString()} 家</span>
                            </div>
                            <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-hover">
                                <div className="h-full bg-red-500 transition-all" style={{ width: `${upRatio}%` }} />
                                <div className="h-full bg-zinc-500/50 transition-all" style={{ width: `${Math.max(1, 100 - upRatio - downRatio)}%` }} />
                                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${downRatio}%` }} />
                            </div>
                        </>
                    ) : (
                        <p className="mt-1 text-sm font-semibold text-foreground">A股 · 港股 · 台股 实时联动</p>
                    )}
                </div>
            </div>

            {/* 3. 离岸人民币 USD/CNH */}
            <div className="card flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-[12px] text-faint">
                        <span className="flex items-center gap-1.5">
                            <DollarSign className="size-3.5 text-brand-ink" />
                            <span>离岸人民币 (USD/CNH)</span>
                        </span>
                        <span className="mono text-[10px] text-faint">{macro.updateTime} 更新</span>
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
                        外资风向标 · 联动北向资金与港股流动性
                    </p>
                </div>
            </div>
        </div>
    );
}
