import type { ChartDataPoint, ChartPeriod, ChartSeries } from '@/lib/realtime-market';

export type ChartViewport = { start: string; end: string };

/** Describe the actual source basis separately for every selected period. */
export function chartProvenanceLabel(series: ChartSeries): string {
    const adjustment = series.adjustment === 'forward' ? '前复权'
        : series.adjustment === 'unadjusted' ? '不复权' : '复权口径未知';
    const fallback = series.adjustment === 'unadjusted' && series.provenance.requestedAdjustment === 'forward'
        ? '（前复权请求回退）' : '';
    const source = ({ 'tencent-kline': '腾讯行情', 'tencent-minute': '腾讯分时', yahoo: 'Yahoo Finance', cnyes: 'cnYES 鉅亨網' } as Record<string, string>)[series.source] ?? series.source;
    const interval = { minute: '分钟K', day: '日K', week: '周K', month: '月K' }[series.provenance.sourceInterval];
    return `${adjustment}${fallback} · 来源: ${source} · 来源周期: ${interval}`;
}

/** Provider dates/times identify a bar independently of its position in the response. */
export function chartBarKey(point: ChartDataPoint): string {
    return `${point.date}T${point.time}`;
}

export function anchorChartViewport(points: ChartDataPoint[], range: [number, number]): ChartViewport | null {
    const start = points[range[0]];
    const end = points[range[1]];
    return start && end ? { start: chartBarKey(start), end: chartBarKey(end) } : null;
}

export function resolveChartViewport(
    points: ChartDataPoint[],
    viewport: ChartViewport | null,
    defaultBars = points.length,
): [number, number] {
    if (!points.length) return [0, -1];
    if (!viewport) return [Math.max(0, points.length - defaultBars), points.length - 1];
    // If a provider drops an endpoint, retain the nearest surviving dates inside the window.
    const start = points.findIndex((point) => chartBarKey(point) >= viewport.start);
    let end = points.length - 1;
    while (end > 0 && chartBarKey(points[end]) > viewport.end) end--;
    const boundedStart = start < 0 ? points.length - 1 : start;
    return [boundedStart, Math.max(boundedStart, end)];
}

function finite(value: number | undefined): number | undefined {
    return value != null && Number.isFinite(value) ? value : undefined;
}

export function chartReferenceClose(
    points: ChartDataPoint[], index: number, period: ChartPeriod, prevClose?: number,
): number | undefined {
    return period === '1d' ? finite(prevClose) : finite(points[index - 1]?.close);
}

/** Missing VWAP must stay missing, even when a price is available. */
export function sourcedVwap(point: ChartDataPoint): number | undefined {
    const value = finite(point.avgPrice);
    return value != null && value > 0 ? value : undefined;
}

export function chartPointMetrics(series: ChartSeries, index: number, sessionSummary = false) {
    const point = series.points[index];
    const price = finite(point?.close);
    const reference = chartReferenceClose(series.points, index, series.period, series.prevClose);
    const session = sessionSummary && series.period === '1d';
    const open = finite(session ? series.open : point?.open);
    const high = finite(session ? series.high : point?.high);
    const low = finite(session ? series.low : point?.low);
    const volume = finite(session ? series.volume : point?.volume);
    const change = price != null && reference != null && reference > 0 ? price - reference : undefined;
    const changePercent = change != null && reference != null ? change / reference * 100 : undefined;
    const amplitude = high != null && low != null && reference != null && reference > 0
        ? (high - low) / reference * 100 : undefined;
    return { price, reference, open, high, low, volume, change, changePercent, amplitude };
}

/** All chart volume inputs are shares, not provider-specific lots. */
export function formatChartVolume(shares?: number, market?: string): string {
    if (shares == null || !Number.isFinite(shares) || shares < 0) return '—';
    const divisor = market === 'cn' ? 100 : market === 'tw' ? 1000 : 1;
    const unit = market === 'cn' ? '手' : market === 'tw' ? '张' : '股';
    const value = shares / divisor;
    if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿${unit}`;
    if (value >= 1e4) return `${(value / 1e4).toFixed(2)}万${unit}`;
    return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit}`;
}

export function chartMovingAverage(points: ChartDataPoint[], window: number): (number | null)[] {
    return points.map((_, index) => {
        if (index < window - 1) return null;
        let sum = 0;
        for (let i = index - window + 1; i <= index; i++) sum += points[i].close;
        return sum / window;
    });
}

export function chartRSI(points: ChartDataPoint[], period: number): (number | null)[] {
    if (!points.length) return [];
    const result: (number | null)[] = [null];
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i < points.length; i++) {
        const diff = points[i].close - points[i - 1].close;
        const gain = Math.max(0, diff);
        const loss = Math.max(0, -diff);
        if (i <= period) {
            avgGain += gain / period;
            avgLoss += loss / period;
            if (i < period) {
                result.push(null);
                continue;
            }
        } else {
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        result.push(avgGain === 0 && avgLoss === 0 ? 50 : avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
    return result;
}
