'use client';

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowUpRight, BarChart2, CandlestickChart, Clock, LineChart } from "lucide-react";
import Panel from "@/components/Panel";
import ChangePill from "@/components/ChangePill";
import { getUnifiedChartSeries } from "@/lib/actions/realtime-market.actions";
import { formatPrice } from "@/lib/utils";
import type { ChartDataPoint, ChartPeriod, ChartSeries } from "@/lib/realtime-market";

type Period = '1d' | '5d' | '1m' | '3m' | '1y' | '5y';
type ChartStyle = 'candlestick' | 'line';

const PERIODS: { id: Period; label: string }[] = [
    { id: '1d', label: '分时' },
    { id: '5d', label: '五日' },
    { id: '1m', label: '日K' },
    { id: '3m', label: '季K' },
    { id: '1y', label: '周K' },
    { id: '5y', label: '月K' },
];

function formatVol(vol?: number, market?: string): string {
    if (!vol || vol <= 0) return '—';
    if (market === 'cn' || market === 'hk') {
        if (vol >= 1e8) return `${(vol / 1e8).toFixed(2)}亿手`;
        if (vol >= 1e4) return `${(vol / 1e4).toFixed(2)}万手`;
        return `${Math.round(vol).toLocaleString()}手`;
    }
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
    return Math.round(vol).toLocaleString();
}

function calcMA(points: ChartDataPoint[], window: number): (number | null)[] {
    return points.map((_, idx) => {
        if (idx < window - 1) return null;
        const slice = points.slice(idx - window + 1, idx + 1);
        const sum = slice.reduce((acc, p) => acc + p.close, 0);
        return sum / window;
    });
}

export default function YahooStockChart({ symbol, tvSymbol }: { symbol: string; tvSymbol: string }) {
    const [period, setPeriod] = useState<Period>('1d');
    const [chartStyle, setChartStyle] = useState<ChartStyle>('line');
    const [chartData, setChartData] = useState<ChartSeries | null>(null);
    const [loading, setLoading] = useState(true);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [, startTransition] = useTransition();

    // Default to line for 1d, candlestick for multi-day K-lines
    const handlePeriodChange = (next: Period) => {
        setPeriod(next);
        if (next === '1d') {
            setChartStyle('line');
        } else {
            setChartStyle('candlestick');
        }
        startTransition(() => {});
    };

    useEffect(() => {
        let active = true;
        setLoading(true);
        getUnifiedChartSeries(symbol, period).then((data) => {
            if (active) {
                setChartData(data);
                setHoverIndex(null);
                setLoading(false);
            }
        });
        return () => {
            active = false;
        };
    }, [symbol, period]);

    const points = chartData?.points ?? [];
    const currency = chartData?.currency || 'USD';
    const market = chartData?.market || 'us';

    // Calculate MA lines
    const ma5List = useMemo(() => calcMA(points, 5), [points]);
    const ma10List = useMemo(() => calcMA(points, 10), [points]);
    const ma20List = useMemo(() => calcMA(points, 20), [points]);

    // Active hovered point or latest point
    const activeIdx = hoverIndex != null && points[hoverIndex] ? hoverIndex : points.length ? points.length - 1 : null;
    const activePoint = activeIdx != null ? points[activeIdx] : null;

    // SVG Layout Dimensions
    const svgWidth = 840;
    const svgHeight = 420;
    const paddingX = 16;
    const paddingY = 16;
    const innerW = svgWidth - paddingX * 2;

    const mainH = 260; // Main chart height
    const gap = 24;    // Gap between main chart and volume subchart
    const volH = 80;   // Volume subchart height
    const volBaseY = paddingY + mainH + gap + volH;

    // Price scaling
    const isCandle = chartStyle === 'candlestick' && period !== '1d';
    const highs = points.map((p) => (isCandle && p.high != null ? p.high : p.close));
    const lows = points.map((p) => (isCandle && p.low != null ? p.low : p.close));
    const rawMin = lows.length ? Math.min(...lows) : 0;
    const rawMax = highs.length ? Math.max(...highs) : 100;
    const range = rawMax - rawMin || 1;
    const padding = range * 0.06;
    const yMin = Math.max(0, rawMin - padding);
    const yMax = rawMax + padding;
    const yDiff = yMax - yMin || 1;

    // Volume scaling
    const volumes = points.map((p) => p.volume || 0);
    const maxVol = Math.max(...volumes, 1);

    // Coordinate mapping
    const coords = points.map((p, idx) => {
        const x = paddingX + (idx / Math.max(1, points.length - 1)) * innerW;
        const yClose = paddingY + mainH - ((p.close - yMin) / yDiff) * mainH;
        const yOpen = paddingY + mainH - (((p.open ?? p.close) - yMin) / yDiff) * mainH;
        const yHigh = paddingY + mainH - (((p.high ?? p.close) - yMin) / yDiff) * mainH;
        const yLow = paddingY + mainH - (((p.low ?? p.close) - yMin) / yDiff) * mainH;

        // VWAP avg price y
        const yAvg = p.avgPrice ? paddingY + mainH - ((p.avgPrice - yMin) / yDiff) * mainH : null;

        // Volume bar
        const volVal = p.volume || 0;
        const barH = Math.max(2, (volVal / maxVol) * volH);
        const yVol = volBaseY - barH;

        return { x, yClose, yOpen, yHigh, yLow, yAvg, yVol, barH, point: p, idx };
    });

    const isUp = (chartData?.change ?? 0) >= 0;
    const strokeColor = isUp ? 'var(--up, #ef4444)' : 'var(--down, #10b981)';

    // Path for line mode
    let priceLineD = '';
    let areaD = '';
    let avgLineD = '';
    if (coords.length > 1) {
        priceLineD = coords.reduce((acc, c, i) => (i === 0 ? `M ${c.x} ${c.yClose}` : `${acc} L ${c.x} ${c.yClose}`), '');
        const first = coords[0];
        const last = coords[coords.length - 1];
        areaD = `${priceLineD} L ${last.x} ${paddingY + mainH} L ${first.x} ${paddingY + mainH} Z`;

        // VWAP line
        avgLineD = coords.reduce((acc, c, i) => {
            if (c.yAvg == null) return acc;
            return acc === '' ? `M ${c.x} ${c.yAvg}` : `${acc} L ${c.x} ${c.yAvg}`;
        }, '');
    }

    // Previous close baseline
    const prevCloseY = chartData?.prevClose && chartData.prevClose >= yMin && chartData.prevClose <= yMax
        ? paddingY + mainH - ((chartData.prevClose - yMin) / yDiff) * mainH
        : null;

    // MA Lines paths
    const makeMaPath = (maList: (number | null)[]) => {
        let path = '';
        coords.forEach((c, i) => {
            const v = maList[i];
            if (v == null || v < yMin || v > yMax) return;
            const y = paddingY + mainH - ((v - yMin) / yDiff) * mainH;
            path = path === '' ? `M ${c.x} ${y}` : `${path} L ${c.x} ${y}`;
        });
        return path;
    };

    const ma5Path = isCandle ? makeMaPath(ma5List) : '';
    const ma10Path = isCandle ? makeMaPath(ma10List) : '';
    const ma20Path = isCandle ? makeMaPath(ma20List) : '';

    // Candle width
    const barW = Math.max(2, Math.min(10, (innerW / Math.max(1, points.length)) * 0.7));

    // Conventional Data Metrics for header
    const activePrice = activePoint ? activePoint.close : chartData?.latestPrice;
    const activeOpen = activePoint?.open;
    const activeHigh = activePoint?.high;
    const activeLow = activePoint?.low;
    const activeVolume = activePoint?.volume;
    const activeTime = activePoint ? (period === '1d' ? activePoint.time : activePoint.date) : '';
    const activePrev = activeIdx != null && activeIdx > 0 ? points[activeIdx - 1].close : chartData?.prevClose || activeOpen;
    const activeDiff = activePrice && activePrev ? activePrice - activePrev : 0;
    const activeDiffPct = activePrev ? (activeDiff / activePrev) * 100 : 0;
    const activeAmp = activeHigh && activeLow && activePrev ? ((activeHigh - activeLow) / activePrev) * 100 : 0;

    const activeMa5 = activeIdx != null ? ma5List[activeIdx] : null;
    const activeMa10 = activeIdx != null ? ma10List[activeIdx] : null;
    const activeMa20 = activeIdx != null ? ma20List[activeIdx] : null;

    const action = (
        <div className="flex flex-wrap items-center gap-1.5">
            {/* 周期切换 */}
            <div className="flex items-center rounded-lg bg-page/60 p-0.5 border border-line">
                {PERIODS.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => handlePeriodChange(id)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                            period === id ? 'bg-primary text-primary-foreground shadow-xs' : 'text-faint hover:text-foreground'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* 图表类型切换 (蜡烛K线 / 分时走势) */}
            <div className="flex items-center rounded-lg bg-page/60 p-0.5 border border-line">
                <button
                    type="button"
                    onClick={() => setChartStyle('candlestick')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                        chartStyle === 'candlestick' ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'
                    }`}
                    title="切换为蜡烛K线图"
                >
                    <CandlestickChart className="size-3" />
                    <span>蜡烛</span>
                </button>
                <button
                    type="button"
                    onClick={() => setChartStyle('line')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                        chartStyle === 'line' ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'
                    }`}
                    title="切换为分时/平滑折线"
                >
                    <LineChart className="size-3" />
                    <span>分时</span>
                </button>
            </div>
        </div>
    );

    return (
        <Panel
            title="实时价格走势"
            sub={isCandle ? "经典专业蜡烛线 · 叠加 MA5 / MA10 / MA20 均线与成交量副图" : "原生分时走势 · 白色现价线与黄色分时均价线 (VWAP)"}
            action={action}
        >
            <div className="flex flex-col gap-2 p-4">
                {/* 资深玩家看盘核心常规数据栏 (开高低收、涨跌幅、振幅、成交量、均线) */}
                <div className="flex flex-wrap items-center justify-between gap-y-2 border-b border-line pb-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="num text-3xl font-bold tracking-tight">
                            {activePrice != null ? formatPrice(activePrice, currency) : '—'}
                        </span>
                        <ChangePill value={activeDiffPct} />
                        {activeTime && (
                            <span className="mono flex items-center gap-1 text-xs font-semibold text-brand-ink">
                                <Clock className="size-3" />
                                {activeTime}
                            </span>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span>今开: <strong className="num text-foreground">{activeOpen != null ? formatPrice(activeOpen, currency) : '—'}</strong></span>
                        <span>最高: <strong className="num text-up">{activeHigh != null ? formatPrice(activeHigh, currency) : '—'}</strong></span>
                        <span>最低: <strong className="num text-down">{activeLow != null ? formatPrice(activeLow, currency) : '—'}</strong></span>
                        <span>振幅: <strong className="num text-foreground">{activeAmp ? `${activeAmp.toFixed(2)}%` : '—'}</strong></span>
                        <span>成交量: <strong className="num text-foreground">{formatVol(activeVolume, market)}</strong></span>
                        <span className="mono text-[11px] text-faint">15秒自动刷新</span>
                    </div>
                </div>

                {/* K线指标图例 (MA5/MA10/MA20) 或 分时图例 (白现价/黄均价) */}
                <div className="flex flex-wrap items-center gap-4 text-[11px] font-medium">
                    {isCandle ? (
                        <>
                            <span className="flex items-center gap-1.5 text-amber-500">
                                <span className="inline-block size-2 rounded-full bg-amber-500" />
                                MA5: <strong className="num">{activeMa5 != null ? activeMa5.toFixed(2) : '—'}</strong>
                            </span>
                            <span className="flex items-center gap-1.5 text-purple-400">
                                <span className="inline-block size-2 rounded-full bg-purple-400" />
                                MA10: <strong className="num">{activeMa10 != null ? activeMa10.toFixed(2) : '—'}</strong>
                            </span>
                            <span className="flex items-center gap-1.5 text-sky-400">
                                <span className="inline-block size-2 rounded-full bg-sky-400" />
                                MA20: <strong className="num">{activeMa20 != null ? activeMa20.toFixed(2) : '—'}</strong>
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="flex items-center gap-1.5 text-foreground">
                                <span className="inline-block size-2 rounded-full bg-foreground" />
                                现价线
                            </span>
                            {avgLineD && (
                                <span className="flex items-center gap-1.5 text-amber-400">
                                    <span className="inline-block size-2 rounded-full bg-amber-400" />
                                    分时均价 (VWAP)
                                </span>
                            )}
                            {prevCloseY != null && (
                                <span className="flex items-center gap-1.5 text-faint">
                                    <span className="inline-block h-0.5 w-3 border-t border-dashed border-line-strong" />
                                    昨收参考 ({formatPrice(chartData?.prevClose || 0, currency)})
                                </span>
                            )}
                        </>
                    )}
                    <span className="ml-auto text-faint">
                        VOL 副图成交量: <strong className="num text-foreground">{formatVol(activeVolume, market)}</strong>
                    </span>
                </div>

                {/* SVG 主图与副图区域 */}
                <div className="relative h-[430px] w-full">
                    {loading ? (
                        <div className="flex size-full items-center justify-center text-sm text-faint">
                            正在加载实时蜡烛与行情数据...
                        </div>
                    ) : coords.length > 1 ? (
                        <svg
                            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                            className="size-full overflow-visible select-none"
                            preserveAspectRatio="none"
                            onMouseLeave={() => setHoverIndex(null)}
                        >
                            <defs>
                                <linearGradient id={`chart-grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
                                </linearGradient>
                            </defs>

                            {/* 1. 主图背景网格与昨收线 */}
                            <line x1={paddingX} y1={paddingY} x2={svgWidth - paddingX} y2={paddingY} stroke="var(--line, #333)" strokeWidth="0.5" strokeDasharray="2 2" />
                            <line x1={paddingX} y1={paddingY + mainH / 2} x2={svgWidth - paddingX} y2={paddingY + mainH / 2} stroke="var(--line, #333)" strokeWidth="0.5" strokeDasharray="2 2" />
                            <line x1={paddingX} y1={paddingY + mainH} x2={svgWidth - paddingX} y2={paddingY + mainH} stroke="var(--line, #333)" strokeWidth="1" />

                            {/* 昨收参考线 */}
                            {prevCloseY != null && (
                                <g>
                                    <line
                                        x1={paddingX}
                                        y1={prevCloseY}
                                        x2={svgWidth - paddingX}
                                        y2={prevCloseY}
                                        stroke="var(--line-strong, #666)"
                                        strokeWidth="1"
                                        strokeDasharray="4 4"
                                    />
                                    <text x={svgWidth - paddingX} y={prevCloseY - 4} fill="var(--faint, #888)" fontSize="10" textAnchor="end" className="mono">
                                        昨收 {chartData?.prevClose?.toFixed(2)}
                                    </text>
                                </g>
                            )}

                            {/* 2. 主图内容：蜡烛线模式 vs 分时折线模式 */}
                            {isCandle ? (
                                <g>
                                    {/* 蜡烛线柱与上下影线 */}
                                    {coords.map((c) => {
                                        const p = c.point;
                                        const isCandleUp = p.close >= (p.open ?? p.close);
                                        const candleColor = isCandleUp ? 'var(--up, #ef4444)' : 'var(--down, #10b981)';
                                        const bodyTop = Math.min(c.yOpen, c.yClose);
                                        const bodyH = Math.max(2, Math.abs(c.yClose - c.yOpen));

                                        return (
                                            <g key={`candle-${c.idx}`}>
                                                {/* 上下影线 */}
                                                <line
                                                    x1={c.x}
                                                    y1={c.yHigh}
                                                    x2={c.x}
                                                    y2={c.yLow}
                                                    stroke={candleColor}
                                                    strokeWidth="1.2"
                                                />
                                                {/* 蜡烛实体 */}
                                                <rect
                                                    x={c.x - barW / 2}
                                                    y={bodyTop}
                                                    width={barW}
                                                    height={bodyH}
                                                    fill={candleColor}
                                                    stroke={candleColor}
                                                    rx="0.5"
                                                />
                                            </g>
                                        );
                                    })}

                                    {/* MA 均线叠加 */}
                                    {ma5Path && <path d={ma5Path} fill="none" stroke="#f59e0b" strokeWidth="1.5" />}
                                    {ma10Path && <path d={ma10Path} fill="none" stroke="#a855f7" strokeWidth="1.5" />}
                                    {ma20Path && <path d={ma20Path} fill="none" stroke="#38bdf8" strokeWidth="1.5" />}
                                </g>
                            ) : (
                                <g>
                                    {/* 渐变面积 */}
                                    <path d={areaD} fill={`url(#chart-grad-${symbol})`} />

                                    {/* 现价主折线 */}
                                    <path
                                        d={priceLineD}
                                        fill="none"
                                        stroke={strokeColor}
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />

                                    {/* 分时均价黄线 */}
                                    {avgLineD && (
                                        <path
                                            d={avgLineD}
                                            fill="none"
                                            stroke="#eab308"
                                            strokeWidth="1.5"
                                            strokeDasharray="2 1"
                                        />
                                    )}
                                </g>
                            )}

                            {/* 3. 副图：成交量 (VOL) 柱状图 */}
                            <g>
                                <line x1={paddingX} y1={volBaseY} x2={svgWidth - paddingX} y2={volBaseY} stroke="var(--line, #333)" strokeWidth="1" />
                                <text x={paddingX} y={volBaseY - volH - 4} fill="var(--faint, #888)" fontSize="10" className="mono">
                                    VOL 成交量
                                </text>

                                {coords.map((c) => {
                                    const p = c.point;
                                    const isCandleUp = p.close >= (p.open ?? p.close);
                                    const volColor = isCandleUp ? 'var(--up, #ef4444)' : 'var(--down, #10b981)';

                                    return (
                                        <rect
                                            key={`vol-${c.idx}`}
                                            x={c.x - barW / 2}
                                            y={c.yVol}
                                            width={barW}
                                            height={c.barH}
                                            fill={volColor}
                                            opacity={0.85}
                                        />
                                    );
                                })}
                            </g>

                            {/* 4. 十字准星与悬停吸附 */}
                            {hoverIndex != null && coords[hoverIndex] && (
                                <g>
                                    {/* 垂直十字虚线 */}
                                    <line
                                        x1={coords[hoverIndex].x}
                                        y1={paddingY}
                                        x2={coords[hoverIndex].x}
                                        y2={volBaseY}
                                        stroke="var(--line-strong, #888)"
                                        strokeWidth="1"
                                        strokeDasharray="3 3"
                                    />

                                    {/* 水平十字虚线 (吸附在主图收盘价) */}
                                    <line
                                        x1={paddingX}
                                        y1={coords[hoverIndex].yClose}
                                        x2={svgWidth - paddingX}
                                        y2={coords[hoverIndex].yClose}
                                        stroke="var(--line-strong, #888)"
                                        strokeWidth="1"
                                        strokeDasharray="3 3"
                                    />

                                    {/* 高亮圆点 */}
                                    <circle
                                        cx={coords[hoverIndex].x}
                                        cy={coords[hoverIndex].yClose}
                                        r="4"
                                        fill={coords[hoverIndex].point.close >= (coords[hoverIndex].point.open ?? coords[hoverIndex].point.close) ? 'var(--up, #ef4444)' : 'var(--down, #10b981)'}
                                        stroke="var(--page, #000)"
                                        strokeWidth="2"
                                    />
                                </g>
                            )}

                            {/* 5. 交互悬停透明热区 */}
                            {coords.map((c, i) => {
                                const step = innerW / Math.max(1, coords.length - 1);
                                const rectX = Math.max(0, c.x - step / 2);
                                return (
                                    <rect
                                        key={`hit-${i}`}
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
                            <p>该标的暂无此周期行情数据，请切换至其他时段查看。</p>
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}
