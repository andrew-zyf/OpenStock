'use client';

import React, { useId, useState } from 'react';
import Panel from '@/components/Panel';
import { useMarketResource } from '@/hooks/useMarketResource';
import { getRelativeHistoryComparison } from '@/lib/actions/relative-history.actions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { getHistoricalBenchmarkOptions, RELATIVE_HISTORY_POINTS, relativeHistoryUnavailableReason } from '@/lib/market/relative-history';

const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;

export default function RelativeHistoryComparison({ symbol, currency }: { symbol: string; currency?: string }) {
    const id = useId();
    const identity = identifyMarketAndCode(symbol).normalizedSymbol;
    const options = getHistoricalBenchmarkOptions(identity);
    const [selection, setSelection] = useState({ identity, benchmark: options[0]?.symbol ?? '' });
    const benchmark = selection.identity === identity && options.some(option => option.symbol === selection.benchmark)
        ? selection.benchmark : options[0]?.symbol ?? '';
    const reason = relativeHistoryUnavailableReason(identity, benchmark, currency);
    const { data, loading, error, stale } = useMarketResource({
        key: `relative-history:${identity}:${benchmark}:${currency ?? 'native'}:${RELATIVE_HISTORY_POINTS}`,
        enabled: !reason,
        intervalMs: 3_600_000,
        loader: () => getRelativeHistoryComparison(identity, benchmark, currency),
    });
    const result = data?.status === 'available' ? data : undefined;

    return (
        <Panel title="历史区间 · 标的与基准" sub="最近20个共同交易日收盘点 · 可见时每小时检查">
            <div className="min-w-0 space-y-4 p-4 text-sm">
                {options.length > 0 && (
                    <fieldset className="min-w-0">
                        <legend className="text-xs text-muted-foreground">选择同市场基准</legend>
                        <div className="flex flex-wrap gap-x-4">
                            {options.map(option => (
                                <label key={option.symbol} htmlFor={`${id}-${option.symbol}`} className="flex min-h-12 cursor-pointer items-center gap-2">
                                    <input id={`${id}-${option.symbol}`} name={`${id}-benchmark`} type="radio" value={option.symbol}
                                        checked={benchmark === option.symbol} onChange={() => setSelection({ identity, benchmark: option.symbol })}
                                        className="accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}
                {reason ? <p role="status" className="text-muted-foreground">{reason}</p>
                    : loading ? <p role="status" className="text-muted-foreground">正在读取标的与基准历史日线…</p>
                    : error && !result ? <p role="status" className="text-muted-foreground">历史来源获取失败或超时，稍后自动重试。</p>
                    : data?.status === 'unavailable' ? <p role="status" className="text-muted-foreground">{data.reason}</p>
                    : result && (
                        <>
                            {stale && <p role="status" className="text-muted-foreground">刷新失败，以下为上次成功获取的历史比较；区间截至 {result.endDate}。</p>}
                            <p>{result.startDate} 至 {result.endDate}，共 {result.points.length} 个共同收盘点。{result.symbol} 区间变化 <strong>{signed(result.stockChangePercent)}%</strong>，
                                {result.benchmark.label} 区间变化 <strong>{signed(result.benchmarkChangePercent)}%</strong>，
                                标的减基准 <strong>{signed(result.differencePercentagePoints)} 个百分点</strong>。</p>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                {result.currency} · 来源：腾讯行情（{result.source}） · {result.adjustment === 'forward' ? '双方同为前复权' : '双方同为不复权；区间变化可能受除权除息影响'}。
                                实际来源字段：标的 {result.provenance.stock.actualKey} / 基准 {result.provenance.benchmark.actualKey}。
                            </p>
                            {result.shortHistory && <p role="status" className="text-xs text-muted-foreground">历史不足20个共同收盘点，仅比较以上 {result.points.length} 点的实际区间。</p>}
                            {result.partialDates && (
                                <p role="status" className="break-words text-xs leading-relaxed text-muted-foreground">
                                    日期不齐，仅按共同日期比较，缺失日不补值。
                                    {result.missingStockDates.length > 0 && ` 标的缺失日期：${result.missingStockDates.join('、')}。`}
                                    {result.missingBenchmarkDates.length > 0 && ` 基准缺失日期：${result.missingBenchmarkDates.join('、')}。`}
                                    可比区间截至 {result.endDate}，其后的非共同日期未纳入。
                                </p>
                            )}
                            <div className="max-w-full overflow-x-auto rounded-lg border border-line focus-visible:outline-2 focus-visible:outline-primary" role="region" aria-label="共同日期价格明细" tabIndex={0}>
                                <table className="w-full text-right text-xs tabular-nums">
                                    <caption className="p-3 text-left text-muted-foreground">共同起点归一为100；标的 / 基准列按文字区分，收盘价单位为 {result.currency}。</caption>
                                    <thead className="bg-page text-muted-foreground">
                                        <tr>
                                            <th scope="col" className="whitespace-nowrap p-3 text-left">交易日</th>
                                            <th scope="col" className="p-3">标的收盘</th>
                                            <th scope="col" className="p-3">基准收盘</th>
                                            <th scope="col" className="p-3">标的归一值</th>
                                            <th scope="col" className="p-3">基准归一值</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {result.points.map(point => (
                                            <tr key={point.date}>
                                                <th scope="row" className="whitespace-nowrap p-3 text-left font-normal">{point.date}</th>
                                                <td className="p-3">{point.stockClose.toFixed(3)}</td>
                                                <td className="p-3">{point.benchmarkClose.toFixed(3)}</td>
                                                <td className="p-3">{point.stockNormalized.toFixed(2)}</td>
                                                <td className="p-3">{point.benchmarkNormalized.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                <p className="text-xs leading-relaxed text-muted-foreground">仅使用交易所当地今日之前的日K；当天日K不参与。区间为共同日期收盘价之比，未计股息再投资、费用或汇率变动，不代表投资组合收益。</p>
            </div>
        </Panel>
    );
}
