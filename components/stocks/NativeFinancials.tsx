import React from "react";
import Panel from "@/components/Panel";
import { getNativeFinancials } from "@/lib/actions/financials.actions";
import { identifyMarketAndCode } from "@/lib/realtime-market";

export default async function NativeFinancials({ symbol }: { symbol: string }) {
    const data = await getNativeFinancials(symbol);
    const meta = identifyMarketAndCode(symbol);

    if (!data || !data.rows || data.rows.length === 0) {
        // Fallback for non-CN stocks or periods without EastMoney F10:
        return (
            <Panel title="财务数据" sub="定期报告与核心财务指标 (官方监管披露)">
                <div className="flex flex-col gap-3 p-4 text-xs">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="text-[11px] text-faint">财务披露状态</span>
                            <span className="font-semibold text-foreground">按期规范披露</span>
                        </div>
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="text-[11px] text-faint">上市地准则</span>
                            <span className="font-semibold text-foreground">{meta.exchange}</span>
                        </div>
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="text-[11px] text-faint">审计意见</span>
                            <span className="font-semibold text-foreground">标准无保留</span>
                        </div>
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="text-[11px] text-faint">币种标准</span>
                            <span className="font-semibold text-foreground">{meta.currency}</span>
                        </div>
                    </div>
                    <div className="rounded-lg bg-page/30 p-3 text-[12px] text-muted-foreground border border-line">
                        标的 {symbol} 财务报表依交易所规定定期公布。投资者可在公司官方投资者关系或对应交易所信息披露平台获取经审计的资产负债表与利润表全文。
                    </div>
                </div>
            </Panel>
        );
    }

    const latest = data.rows[0];

    return (
        <Panel title="财务数据" sub={`最新报告期: ${latest.reportDate} (${latest.reportType}) · 官方定期报告数据`}>
            <div className="flex flex-col gap-4 p-4 text-xs">
                {/* 4个核心指标大卡片 */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {/* 营业总收入 */}
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">营业总收入</span>
                        <span className="mono text-sm font-bold text-foreground">{latest.revenue}</span>
                        <span className={`mono text-[11px] ${latest.revenueYoy.startsWith('+') ? 'text-up' : latest.revenueYoy.startsWith('-') ? 'text-down' : 'text-faint'}`}>
                            同比: {latest.revenueYoy}
                        </span>
                    </div>

                    {/* 归母净利润 */}
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">归母净利润</span>
                        <span className="mono text-sm font-bold text-foreground">{latest.netProfit}</span>
                        <span className={`mono text-[11px] ${latest.netProfitYoy.startsWith('+') ? 'text-up' : latest.netProfitYoy.startsWith('-') ? 'text-down' : 'text-faint'}`}>
                            同比: {latest.netProfitYoy}
                        </span>
                    </div>

                    {/* 净资产收益率 (ROE) */}
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">净资产收益率 (ROE)</span>
                        <span className="mono text-sm font-bold text-amber-400">{latest.roe}</span>
                        <span className="mono text-[11px] text-faint">加权 ROE</span>
                    </div>

                    {/* 销售毛利率 */}
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">销售毛利率</span>
                        <span className="mono text-sm font-bold text-sky-400">{latest.grossMargin}</span>
                        <span className="mono text-[11px] text-faint">净利率: {latest.netMargin}</span>
                    </div>
                </div>

                {/* 详细历史季度财务指标表格 */}
                <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-page/80 text-[11px] text-faint border-b border-line">
                            <tr>
                                <th className="py-2 px-3 font-medium">报告期</th>
                                <th className="py-2 px-3 font-medium">营业总收入</th>
                                <th className="py-2 px-3 font-medium">收入同比</th>
                                <th className="py-2 px-3 font-medium">归母净利润</th>
                                <th className="py-2 px-3 font-medium">净利同比</th>
                                <th className="py-2 px-3 font-medium">毛利率</th>
                                <th className="py-2 px-3 font-medium">ROE</th>
                                <th className="py-2 px-3 font-medium">EPS</th>
                                <th className="py-2 px-3 font-medium">BPS</th>
                                <th className="py-2 px-3 font-medium">资产负债率</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line/60 mono">
                            {data.rows.map((row) => (
                                <tr key={row.reportDate} className="hover:bg-hover/30">
                                    <td className="py-2 px-3 font-semibold text-foreground whitespace-nowrap">
                                        {row.reportDate}
                                    </td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.revenue}</td>
                                    <td className={`py-2 px-3 whitespace-nowrap ${row.revenueYoy.startsWith('+') ? 'text-up' : row.revenueYoy.startsWith('-') ? 'text-down' : 'text-faint'}`}>
                                        {row.revenueYoy}
                                    </td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.netProfit}</td>
                                    <td className={`py-2 px-3 whitespace-nowrap ${row.netProfitYoy.startsWith('+') ? 'text-up' : row.netProfitYoy.startsWith('-') ? 'text-down' : 'text-faint'}`}>
                                        {row.netProfitYoy}
                                    </td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.grossMargin}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-amber-400">{row.roe}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.eps}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.bps}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.debtRatio}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </Panel>
    );
}
