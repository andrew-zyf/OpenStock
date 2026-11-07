import React from 'react';
import Panel from '@/components/Panel';
import { getNativeFinancials } from '@/lib/actions/financials.actions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';

const changeColor = (value?: string) => value?.startsWith('+') ? 'text-up' : value?.startsWith('-') ? 'text-down' : 'text-faint';

export default async function NativeFinancials({ symbol }: { symbol: string }) {
    const data = await getNativeFinancials(symbol);
    const meta = identifyMarketAndCode(symbol);

    if (!data?.rows.length) {
        return (
            <Panel title="财务数据" sub="定期报告与核心财务指标">
                <div className="flex flex-col gap-3 p-4 text-xs">
                    <div className="rounded-lg bg-page/30 p-3 text-[12px] text-muted-foreground border border-line">
                        {meta.normalizedSymbol} · {meta.exchange}：
                        {getInstrumentCapabilities(symbol).financials
                            ? '暂未取得可用财务数据。'
                            : '当前标的不支持公司财务报表查询。'}
                    </div>
                </div>
            </Panel>
        );
    }

    const latest = data.rows[0];
    return (
        <Panel title="财务数据" sub={`最新报告期: ${latest.reportDate} (${latest.reportType}) · ${data.source}`}>
            <div className="flex flex-col gap-4 p-4 text-xs">
                <p className="text-[11px] text-faint">
                    期间口径：{latest.periodBasis ?? '数据源未提供'} · 报表币种：{latest.currency ?? '数据源未提供'} · 缺失指标以 — 表示
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">营业总收入</span>
                        <span className="mono text-sm font-bold text-foreground">{latest.revenue ?? '—'}</span>
                        <span className={`mono text-[11px] ${changeColor(latest.revenueYoy)}`}>同比: {latest.revenueYoy ?? '—'}</span>
                    </div>
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">{latest.profitLabel ?? '净利润'}</span>
                        <span className="mono text-sm font-bold text-foreground">{latest.netProfit ?? '—'}</span>
                        <span className={`mono text-[11px] ${changeColor(latest.netProfitYoy)}`}>同比: {latest.netProfitYoy ?? '—'}</span>
                    </div>
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">净资产收益率 (ROE)</span>
                        <span className="mono text-sm font-bold text-amber-400">{latest.roe ?? '—'}</span>
                    </div>
                    <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5 border border-line">
                        <span className="text-[11px] text-faint">销售毛利率</span>
                        <span className="mono text-sm font-bold text-sky-400">{latest.grossMargin ?? '—'}</span>
                        <span className="mono text-[11px] text-faint">净利率: {latest.netMargin ?? '—'}</span>
                    </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-page/80 text-[11px] text-faint border-b border-line">
                            <tr>
                                {['报告期 / 利润口径', '营业总收入', '收入同比', '净利润', '净利同比', '毛利率', 'ROE', 'EPS', 'BPS', '资产负债率'].map((label) => (
                                    <th key={label} className="py-2 px-3 font-medium">{label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line/60 mono">
                            {data.rows.map((row) => (
                                <tr key={`${row.reportDate}-${row.reportType}`} className="hover:bg-hover/30">
                                    <td className="py-2 px-3 font-semibold text-foreground whitespace-nowrap">
                                        {row.reportDate}
                                        <div className="text-[11px] text-faint">{row.profitLabel ?? '净利润'} · {row.currency ?? '币种未提供'}</div>
                                        <div className="text-[11px] text-faint">{row.periodBasis ?? '期间口径未提供'}</div>
                                    </td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.revenue ?? '—'}</td>
                                    <td className={`py-2 px-3 whitespace-nowrap ${changeColor(row.revenueYoy)}`}>{row.revenueYoy ?? '—'}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.netProfit ?? '—'}</td>
                                    <td className={`py-2 px-3 whitespace-nowrap ${changeColor(row.netProfitYoy)}`}>{row.netProfitYoy ?? '—'}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.grossMargin ?? '—'}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-amber-400">{row.roe ?? '—'}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.eps ?? '—'}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.bps ?? '—'}</td>
                                    <td className="py-2 px-3 whitespace-nowrap text-foreground">{row.debtRatio ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </Panel>
    );
}
