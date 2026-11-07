'use client';

import React, { useEffect, useState, useTransition } from "react";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import Panel from "@/components/Panel";
import ChangePill from "@/components/ChangePill";
import { getYahooHistoricalChart, type YahooHistoricalChartData } from "@/lib/actions/yahoo.actions";
import { formatPrice, tradingViewSymbolUrl } from "@/lib/utils";

type Range = '1mo' | '3mo' | '1y' | '5y';

const RANGES: { id: Range; label: string }[] = [
    { id: '1mo', label: '1个月' },
    { id: '3mo', label: '3个月' },
    { id: '1y', label: '1年' },
    { id: '5y', label: '5年' },
];

export default function YahooStockChart({ symbol, tvSymbol }: { symbol: string; tvSymbol: string }) {
    const [range, setRange] = useState<Range>('3mo');
    const [chartData, setChartData] = useState<YahooHistoricalChartData | null>(null);
    const [loading, setLoading] = useState(true);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [, startTransition] = useTransition();

    useEffect(() => {
        let active = true;
        setLoading(true);
        getYahooHistoricalChart(symbol, range).then((data) => {
            if (active) {
                setChartData(data);
                setHoverIndex(null);
                setLoading(false);
            }
        });
        return () => {
            active = false;
        };
    }, [symbol, range]);

    const handleRangeChange = (next: Range) => {
        setRange(next);
        startTransition(() => {});
    };

    const points = chartData?.points ?? [];
    const currency = chartData?.currency || 'USD';

    // Min and max for SVG scaling
    const prices = points.map((p) => p.close);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 100;
    const priceRange = maxPrice - minPrice || 1;
    const padding = priceRange * 0.08;
    const yMin = Math.max(0, minPrice - padding);
    const yMax = maxPrice + padding;
    const yDiff = yMax - yMin || 1;

    // SVG coordinates (width 800, height 360)
    const svgWidth = 800;
    const svgHeight = 360;
    const paddingX = 20;
    const paddingY = 20;
    const innerW = svgWidth - paddingX * 2;
    const innerH = svgHeight - paddingY * 2;

    const coords = points.map((p, idx) => {
        const x = paddingX + (idx / Math.max(1, points.length - 1)) * innerW;
        const y = paddingY + innerH - ((p.close - yMin) / yDiff) * innerH;
        return { x, y, point: p };
    });

    const isUp = (chartData?.change ?? 0) >= 0;
    const strokeColor = isUp ? 'var(--up, #10b981)' : 'var(--down, #ef4444)';
    const fillColor = isUp ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';

    let pathD = '';
    let areaD = '';
    if (coords.length > 1) {
        pathD = coords.reduce((acc, c, i) => (i === 0 ? `M ${c.x} ${c.y}` : `${acc} L ${c.x} ${c.y}`), '');
        const first = coords[0];
        const last = coords[coords.length - 1];
        areaD = `${pathD} L ${last.x} ${svgHeight} L ${first.x} ${svgHeight} Z`;
    }

    const activePoint = hoverIndex != null && coords[hoverIndex] ? coords[hoverIndex].point : null;
    const activePrice = activePoint ? activePoint.close : chartData?.currentPrice;
    const activeDate = activePoint ? activePoint.date : null;

    const action = (
        <div className="flex items-center gap-1.5">
            {RANGES.map(({ id, label }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => handleRangeChange(id)}
                    className={`btn h-7 px-2 text-[12px] ${range === id ? 'btn-primary font-semibold' : 'btn-ghost text-faint'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );

    return (
        <Panel
            title="价格走势图表"
            sub="行情源自 Yahoo Finance · 每日收盘数据"
            action={action}
        >
            <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-3">
                    <div className="flex items-center gap-3">
                        <p className="num text-3xl font-bold tracking-[-0.03em]">
                            {activePrice != null ? formatPrice(activePrice, currency) : '—'}
                        </p>
                        {chartData && (
                            <ChangePill value={chartData.changePercent} />
                        )}
                        {activeDate && (
                            <span className="mono text-xs text-faint">{activeDate}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-faint">
                        <span>周期最低: <strong className="num text-foreground">{formatPrice(minPrice, currency)}</strong></span>
                        <span>周期最高: <strong className="num text-foreground">{formatPrice(maxPrice, currency)}</strong></span>
                        <a
                            href={tradingViewSymbolUrl(tvSymbol)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost h-7 px-2 text-xs"
                            title="在 TradingView 官方页面查看完整技术指标与交互图表"
                        >
                            在 TradingView 查看 <ArrowUpRight className="size-3" />
                        </a>
                    </div>
                </div>

                <div className="relative h-[380px] w-full">
                    {loading ? (
                        <div className="flex size-full items-center justify-center text-sm text-faint">
                            正在加载历史走势图...
                        </div>
                    ) : coords.length > 1 ? (
                        <svg
                            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                            className="size-full overflow-visible"
                            preserveAspectRatio="none"
                            onMouseLeave={() => setHoverIndex(null)}
                        >
                            <defs>
                                <linearGradient id={`chart-grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
                                </linearGradient>
                            </defs>

                            {/* Area fill */}
                            <path d={areaD} fill={`url(#chart-grad-${symbol})`} />

                            {/* Main price line */}
                            <path
                                d={pathD}
                                fill="none"
                                stroke={strokeColor}
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />

                            {/* Hover crosshair and point */}
                            {hoverIndex != null && coords[hoverIndex] && (
                                <g>
                                    <line
                                        x1={coords[hoverIndex].x}
                                        y1={paddingY}
                                        x2={coords[hoverIndex].x}
                                        y2={svgHeight - paddingY}
                                        stroke="var(--line-strong, #666)"
                                        strokeWidth="1"
                                        strokeDasharray="3 3"
                                    />
                                    <circle
                                        cx={coords[hoverIndex].x}
                                        cy={coords[hoverIndex].y}
                                        r="5"
                                        fill={strokeColor}
                                        stroke="var(--page, #000)"
                                        strokeWidth="2"
                                    />
                                </g>
                            )}

                            {/* Invisible hover overlay rects */}
                            {coords.map((c, i) => {
                                const step = innerW / Math.max(1, coords.length - 1);
                                const rectX = Math.max(0, c.x - step / 2);
                                return (
                                    <rect
                                        key={c.point.date + i}
                                        x={rectX}
                                        y={0}
                                        width={step}
                                        height={svgHeight}
                                        fill="transparent"
                                        className="cursor-crosshair"
                                        onMouseEnter={() => setHoverIndex(i)}
                                    />
                                );
                            })}
                        </svg>
                    ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-faint">
                            <p>该股票暂无历史 K 线内嵌数据</p>
                            <a
                                href={tradingViewSymbolUrl(tvSymbol)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-ghost btn-sm"
                            >
                                前往 TradingView 查看图表 <ArrowUpRight className="size-3.5" />
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}
