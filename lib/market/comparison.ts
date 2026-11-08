import { identifyMarketAndCode } from './instrument';

export type BenchmarkOption = { symbol: string; label: string; proxy: boolean };
export type ComparisonQuote = {
    c?: number;
    pc?: number;
    dp?: number;
    currency?: string;
    source?: string;
    asOf?: string;
    t?: number;
    priceBasis?: 'last-trade' | 'previous-close';
    stale?: boolean;
};
export type DailyComparison = {
    value?: number;
    reason?: string;
    asOf?: string;
    basis: 'source-prev-close';
    unit: 'percentage-points';
};

/** Benchmarks are explicit choices; an ETF remains a proxy rather than an index. */
export function getBenchmarkOptions(symbol: string): BenchmarkOption[] {
    const meta = identifyMarketAndCode(symbol);
    if (meta.kind === 'unknown' || meta.exchangeId === 'BSE' || meta.exchangeId === 'TPEX') return [];
    if (meta.market === 'cn') return [
        { symbol: '000001.SS', label: '上证指数', proxy: false },
        { symbol: '399' + '001.SZ', label: '深证成指', proxy: false },
        { symbol: '399006.SZ', label: '创业板指', proxy: false },
    ];
    if (meta.market === 'hk') return [
        { symbol: '02800.HK', label: '盈富基金（恒指 ETF 代理）', proxy: true },
        { symbol: '03033.HK', label: '南方恒生科技 ETF 代理', proxy: true },
    ];
    if (meta.market === 'tw') return [
        { symbol: '0050.TW', label: '元大台湾50 ETF 代理', proxy: true },
    ];
    return [
        { symbol: 'SPY', label: 'SPY（标普500 ETF 代理）', proxy: true },
        { symbol: 'QQQ', label: 'QQQ（纳指100 ETF 代理）', proxy: true },
    ];
}

function sourceTimestamp(quote: ComparisonQuote): number | undefined {
    const time = quote.asOf ? Date.parse(quote.asOf) : quote.t != null && quote.t > 0 ? quote.t * 1000 : NaN;
    return Number.isFinite(time) ? time : undefined;
}

/** A difference of same-session quoted returns, not adjusted historical or portfolio performance. */
export function compareDailyQuotes(
    symbol: string,
    quote: ComparisonQuote | null | undefined,
    benchmarkSymbol: string,
    benchmarkQuote: ComparisonQuote | null | undefined,
): DailyComparison {
    const result: DailyComparison = { basis: 'source-prev-close', unit: 'percentage-points' };
    const missing = (reason: string) => ({ ...result, reason });
    const canonicalBenchmark = identifyMarketAndCode(benchmarkSymbol).normalizedSymbol;
    if (!getBenchmarkOptions(symbol).some((option) => option.symbol === canonicalBenchmark)) return missing('当前标的与所选基准不属于可比较范围');
    if (!quote || !benchmarkQuote) return missing('等待标的与基准报价');
    if (quote.stale || benchmarkQuote.stale) return missing('报价更新失败，暂停比较');
    if ([quote, benchmarkQuote].some((item) => item.priceBasis === 'previous-close')) return missing('昨收参考价不参与盘中比较');
    if ([quote, benchmarkQuote].some((item) => item.c == null || !Number.isFinite(item.c) || item.c <= 0
        || item.pc == null || !Number.isFinite(item.pc) || item.pc <= 0
        || item.dp == null || !Number.isFinite(item.dp))) return missing('缺少有效现价、昨收或涨跌幅');
    const meta = identifyMarketAndCode(symbol);
    const benchmarkMeta = identifyMarketAndCode(benchmarkSymbol);
    if (meta.market !== benchmarkMeta.market || !quote.currency || quote.currency !== benchmarkQuote.currency) return missing('市场或计价币种不同');
    if (!quote.source || quote.source !== benchmarkQuote.source) return missing('报价来源不同，暂停比较');
    const time = sourceTimestamp(quote);
    const benchmarkTime = sourceTimestamp(benchmarkQuote);
    if (time === undefined || benchmarkTime === undefined) return missing('源时间未提供');
    const timeZone = meta.market === 'us' ? 'America/New_York' : meta.market === 'tw' ? 'Asia/Taipei' : 'Asia/Shanghai';
    const sessionDate = (timestamp: number) => new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(timestamp));
    if (sessionDate(time) !== sessionDate(benchmarkTime)) return missing('标的与基准不是同一交易日');
    if (Math.abs(time - benchmarkTime) > 120_000) return missing('报价时点相差超过2分钟');
    return { ...result, value: quote.dp! - benchmarkQuote.dp!, asOf: new Date(Math.min(time, benchmarkTime)).toISOString() };
}
