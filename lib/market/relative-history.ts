import type { ChartProvenance, ChartSeries } from '@/lib/realtime-market';
import { getBenchmarkOptions, type BenchmarkOption } from './comparison';
import { identifyMarketAndCode } from './instrument';

export const RELATIVE_HISTORY_POINTS = 20;
export type RelativeHistoryPoint = {
    date: string;
    stockClose: number;
    benchmarkClose: number;
    stockNormalized: number;
    benchmarkNormalized: number;
};
export type RelativeHistoryComparison = { status: 'unavailable'; reason: string } | {
    status: 'available';
    symbol: string;
    benchmark: BenchmarkOption;
    currency: string;
    source: string;
    adjustment: 'forward' | 'unadjusted';
    provenance: { stock: ChartProvenance; benchmark: ChartProvenance };
    fetchedAt: { stock: string; benchmark: string };
    points: RelativeHistoryPoint[];
    startDate: string;
    endDate: string;
    stockChangePercent: number;
    benchmarkChangePercent: number;
    differencePercentagePoints: number;
    partialDates: boolean;
    shortHistory: boolean;
    missingStockDates: string[];
    missingBenchmarkDates: string[];
};

/** Historical-only proxy: Tencent qfqday is available for this ETF, unlike bare index day fallbacks. */
export function getHistoricalBenchmarkOptions(symbol: string): BenchmarkOption[] {
    const options = getBenchmarkOptions(symbol);
    return identifyMarketAndCode(symbol).market === 'cn' && options.length > 0
        ? [{ symbol: '510300.SS', label: '沪深300 ETF 代理（510300）', proxy: true }, ...options]
        : options;
}

/** Avoid requests for unsupported identities or as-yet unverified adjustment sources. */
export function relativeHistoryUnavailableReason(symbol: string, benchmarkSymbol: string, currency?: string): string | undefined {
    const stock = identifyMarketAndCode(symbol);
    const benchmark = identifyMarketAndCode(benchmarkSymbol);
    if (!getHistoricalBenchmarkOptions(symbol).some(option => option.symbol === benchmark.normalizedSymbol)) return '当前标的与所选基准不属于可比较范围';
    if (stock.market !== benchmark.market || stock.currency !== benchmark.currency || (currency !== undefined && currency !== stock.currency)) return '市场或计价币种不同，暂停历史比较';
    if (stock.market === 'us' || stock.market === 'tw') return '当前美股、台股历史源的复权口径未验证，暂不可比';
}

export function verifiedDailyBasis(series: ChartSeries): boolean {
    const { provenance } = series;
    return series.source === 'tencent-kline' && series.interval === 'day'
        && provenance.sourceInterval === 'day' && (series.period === '1m' || series.period === '3m')
        && ((series.adjustment === 'forward' && provenance.actualKey === 'qfqday')
            || (series.adjustment === 'unadjusted' && provenance.actualKey === 'day'));
}

function dailyCloses(series: ChartSeries, today: string): Map<string, number> | null {
    const closes = new Map<string, number>();
    for (const { date, close } of series.points) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
            || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
            || !Number.isFinite(close) || close <= 0 || closes.has(date)) return null;
        // A daily bar for the current exchange date may still be forming.
        if (date < today) closes.set(date, close);
    }
    return closes;
}

/** Price changes from actual common closes; never accumulate quoted daily percentage-point gaps. */
export function compareRelativeHistory(symbol: string, stock: ChartSeries | null, benchmarkSymbol: string, benchmark: ChartSeries | null, currency?: string): RelativeHistoryComparison {
    const unavailable = (reason: string): RelativeHistoryComparison => ({ status: 'unavailable', reason });
    const reason = relativeHistoryUnavailableReason(symbol, benchmarkSymbol, currency);
    if (reason) return unavailable(reason);
    if (!stock || !benchmark) return unavailable('缺少标的或基准历史日线');
    const meta = identifyMarketAndCode(symbol);
    const benchmarkMeta = identifyMarketAndCode(benchmarkSymbol);
    if (identifyMarketAndCode(stock.symbol).normalizedSymbol !== meta.normalizedSymbol
        || identifyMarketAndCode(benchmark.symbol).normalizedSymbol !== benchmarkMeta.normalizedSymbol) return unavailable('历史序列标的身份不匹配');
    if (stock.market !== meta.market || benchmark.market !== meta.market || stock.currency !== meta.currency
        || benchmark.currency !== meta.currency) return unavailable('历史序列市场或计价币种不一致');
    if (!stock.source || stock.source !== benchmark.source) return unavailable('历史来源不同，暂停比较');
    if (!verifiedDailyBasis(stock) || !verifiedDailyBasis(benchmark)) return unavailable('历史日线的实际复权口径尚未验证，暂不可比');
    if (stock.adjustment !== benchmark.adjustment) return unavailable('前复权与不复权日线不能混合比较');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const stockCloses = dailyCloses(stock, today);
    const benchmarkCloses = dailyCloses(benchmark, today);
    if (!stockCloses || !benchmarkCloses) return unavailable('日线包含无效日期、重复日期或非正收盘价');
    const dates = [...stockCloses.keys()].filter(date => benchmarkCloses.has(date)).sort().slice(-RELATIVE_HISTORY_POINTS);
    if (dates.length < 2) return unavailable('少于2个共同交易日收盘点，无法比较');
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    // Include unmatched trailing dates in disclosure: a stale side must not look current.
    const missingStockDates = [...benchmarkCloses.keys()].filter(date => date >= startDate && !stockCloses.has(date)).sort();
    const missingBenchmarkDates = [...stockCloses.keys()].filter(date => date >= startDate && !benchmarkCloses.has(date)).sort();
    const stockBase = stockCloses.get(startDate)!;
    const benchmarkBase = benchmarkCloses.get(startDate)!;
    const points = dates.map(date => ({
        date, stockClose: stockCloses.get(date)!, benchmarkClose: benchmarkCloses.get(date)!,
        stockNormalized: stockCloses.get(date)! / stockBase * 100,
        benchmarkNormalized: benchmarkCloses.get(date)! / benchmarkBase * 100,
    }));
    if (points.some(point => !Number.isFinite(point.stockNormalized) || !Number.isFinite(point.benchmarkNormalized))) return unavailable('价格比例超出有效范围，无法比较');
    const last = points[points.length - 1];
    const stockChangePercent = last.stockNormalized - 100;
    const benchmarkChangePercent = last.benchmarkNormalized - 100;
    return {
        status: 'available', symbol: meta.normalizedSymbol,
        benchmark: getHistoricalBenchmarkOptions(symbol).find(option => option.symbol === benchmarkMeta.normalizedSymbol)!,
        currency: stock.currency, source: stock.source, adjustment: stock.adjustment as 'forward' | 'unadjusted',
        provenance: { stock: stock.provenance, benchmark: benchmark.provenance },
        fetchedAt: { stock: stock.fetchedAt, benchmark: benchmark.fetchedAt },
        points, startDate, endDate, stockChangePercent, benchmarkChangePercent,
        differencePercentagePoints: stockChangePercent - benchmarkChangePercent,
        partialDates: missingStockDates.length > 0 || missingBenchmarkDates.length > 0,
        shortHistory: points.length < RELATIVE_HISTORY_POINTS, missingStockDates, missingBenchmarkDates,
    };
}
