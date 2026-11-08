import type { ChartSeries, ChartDataPoint } from '@/lib/realtime-market';
import { identifyMarketAndCode } from './instrument';
import { verifiedDailyBasis } from './relative-history';

export const DAILY_RESEARCH_LIMIT = 20;
export const PEER_GROUP_LIMIT = 10;
export const VOLUME_BASELINE_DAYS = 20;
export type PeerMember = { symbolId: string; symbol: string };
export type PeerGroup = { id: string; name: string; members: PeerMember[]; membershipSavedAt: string };
export type IntervalReturn = { status: 'unavailable'; reason: string; commonPoints: number; requiredPoints: number } | {
    status: 'available'; intervals: 5 | 20; commonPoints: number; startDate: string; endDate: string;
    stockReturn: number; benchmarkReturn: number; excessPercentagePoints: number;
    stockCloses: number[]; benchmarkCloses: number[]; dates: string[];
};
export type DailyVolume = {
    status: 'available' | 'unavailable'; reason?: string; date?: string; volume?: number; median?: number; ratio?: number;
    sampleDates: string[]; sampleVolumes: (number | null)[]; missingDates: string[]; sampleSize: number; requiredSample: number; volumeUnit: 'shares';
    source?: string; actualKey?: string; fetchedAt?: string;
};
export type DailyComparison = { status: 'unavailable'; reason: string } | {
    status: 'available'; source: string; adjustment: 'forward' | 'unadjusted'; actualKey: string; currency: string;
    fetchedAt: { stock: string; benchmark: string }; five: IntervalReturn; twenty: IntervalReturn;
    missingStockDates: string[]; missingBenchmarkDates: string[]; excludedCurrentDates: string[];
};
export type DailyResearchRow = PeerMember & { comparison: DailyComparison; volume: DailyVolume };
export type DailyResearchResult = {
    scope: 'watched' | 'group'; group?: PeerGroup; benchmarkSymbol: string; fetchedAt: string;
    rows: DailyResearchRow[]; omittedMembers: PeerMember[]; commonDates: string[];
};

/** Exchange and canonical ticker are both retained, including TWSE vs TPEx. */
export function canonicalPeerMember(value: string): PeerMember {
    if (typeof value !== 'string' || value.length > 40) throw new Error('标的代码无效');
    const prefix = value.match(/^(SSE|SZSE|BSE|HKEX|TWSE|TPEX|US):/)?.[1];
    const ticker = prefix ? value.slice(prefix.length + 1) : value;
    const meta = identifyMarketAndCode(prefix === 'US' || /\.(SS|SH|SZ|BJ|HK|TW|TWO)$/i.test(ticker) ? ticker : value);
    if (meta.kind === 'unknown' || !/^[A-Z0-9^][A-Z0-9.^-]{0,24}$/.test(meta.normalizedSymbol)) throw new Error('标的代码无效');
    const symbolId = `${meta.exchangeId}:${meta.normalizedSymbol}`;
    // Explicit exchange prefixes cannot contradict the resolved listing.
    if (prefix && prefix !== meta.exchangeId) throw new Error('标的身份不一致');
    return { symbolId, symbol: meta.normalizedSymbol };
}

export function validatePeerGroupInput(input: { name: string; symbolIds: string[] }): { name: string; members: PeerMember[] } {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 60) throw new Error('组名须为 1–60 字');
    if (!Array.isArray(input.symbolIds) || input.symbolIds.length < 1 || input.symbolIds.length > DAILY_RESEARCH_LIMIT) throw new Error('每组须有 1–20 个标的');
    const members = [...new Map(input.symbolIds.map(value => { const member = canonicalPeerMember(value); return [member.symbolId, member] as const; })).values()];
    return { name: input.name.trim(), members };
}

export function dailySupportReason(symbol: string): string | undefined {
    const meta = identifyMarketAndCode(symbol);
    if (meta.market === 'us' || meta.market === 'tw') return '美股、台股日线实际复权口径未验证，退出比较';
    if (!meta.tencentCode || meta.kind === 'unknown' || meta.exchangeId === 'BSE') return '该标的尚无受支持的完整日线来源';
}

export function completedDailyPoints(series: ChartSeries, now = new Date()): Map<string, ChartDataPoint> | null {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: series.market === 'hk' ? 'Asia/Hong_Kong' : 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const points = new Map<string, ChartDataPoint>();
    const seen = new Set<string>();
    for (const point of series.points) {
        const timestamp = Date.parse(`${point.date}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !Number.isFinite(timestamp)
            || new Date(timestamp).toISOString().slice(0, 10) !== point.date || seen.has(point.date)
            || !Number.isFinite(point.close) || point.close <= 0) return null;
        seen.add(point.date);
        // Deliberate conservative policy: all current exchange-date bars wait until next day.
        if (point.date < today) points.set(point.date, point);
    }
    return new Map([...points].sort(([a], [b]) => a.localeCompare(b)));
}

export function dailySeriesReason(symbol: string, series: ChartSeries | null): string | undefined {
    const reason = dailySupportReason(symbol);
    if (reason) return reason;
    if (!series) return '历史来源暂不可用，未将缺失当作零';
    const meta = identifyMarketAndCode(symbol);
    if (identifyMarketAndCode(series.symbol).normalizedSymbol !== meta.normalizedSymbol || series.market !== meta.market || series.currency !== meta.currency) return '日线身份、市场或币种不一致';
    if (!verifiedDailyBasis(series)) return '日线实际来源或复权口径未验证';
}

export function dailyPairReason(symbol: string, stock: ChartSeries | null, benchmarkSymbol: string, benchmark: ChartSeries | null): string | undefined {
    const stockMeta = identifyMarketAndCode(symbol);
    const benchmarkMeta = identifyMarketAndCode(benchmarkSymbol);
    if (stockMeta.market !== benchmarkMeta.market || stockMeta.currency !== benchmarkMeta.currency) return '市场或计价币种不同，退出比较';
    const reason = dailySeriesReason(symbol, stock) ?? dailySeriesReason(benchmarkSymbol, benchmark);
    if (reason) return reason;
    if (stock!.source !== benchmark!.source || stock!.adjustment !== benchmark!.adjustment || stock!.provenance.actualKey !== benchmark!.provenance.actualKey) return '实际来源或复权口径不同，退出比较';
}

export function compareDailyResearch(symbol: string, stock: ChartSeries | null, benchmarkSymbol: string, benchmark: ChartSeries | null, now = new Date(), sharedDates?: string[]): DailyComparison {
    const reason = dailyPairReason(symbol, stock, benchmarkSymbol, benchmark);
    if (reason) return { status: 'unavailable', reason };
    const stockPoints = completedDailyPoints(stock!, now);
    const benchmarkPoints = completedDailyPoints(benchmark!, now);
    if (!stockPoints || !benchmarkPoints) return { status: 'unavailable', reason: '日线存在无效日期、重复日期或非正收盘价' };
    const dates = [...stockPoints.keys()].filter(date => benchmarkPoints.has(date) && (!sharedDates || sharedDates.includes(date)));
    const interval = (count: 5 | 20): IntervalReturn => {
        if (dates.length < count + 1) return { status: 'unavailable', reason: `需 ${count + 1} 个共同完成日收盘点，当前仅 ${dates.length} 个`, commonPoints: dates.length, requiredPoints: count + 1 };
        const sample = dates.slice(-(count + 1));
        const stockCloses = sample.map(date => stockPoints.get(date)!.close);
        const benchmarkCloses = sample.map(date => benchmarkPoints.get(date)!.close);
        const stockReturn = (stockCloses.at(-1)! / stockCloses[0] - 1) * 100;
        const benchmarkReturn = (benchmarkCloses.at(-1)! / benchmarkCloses[0] - 1) * 100;
        if (![stockReturn, benchmarkReturn, stockReturn - benchmarkReturn].every(Number.isFinite)) return { status: 'unavailable', reason: '价格比例超出有效范围', commonPoints: sample.length, requiredPoints: count + 1 };
        return { status: 'available', intervals: count, commonPoints: sample.length, startDate: sample[0], endDate: sample.at(-1)!, stockReturn, benchmarkReturn, excessPercentagePoints: stockReturn - benchmarkReturn, stockCloses, benchmarkCloses, dates: sample };
    };
    const start = dates.slice(-21)[0] ?? [...stockPoints.keys(), ...benchmarkPoints.keys()].sort()[0] ?? '';
    return {
        status: 'available', source: stock!.source, adjustment: stock!.adjustment as 'forward' | 'unadjusted', actualKey: stock!.provenance.actualKey, currency: stock!.currency,
        fetchedAt: { stock: stock!.fetchedAt, benchmark: benchmark!.fetchedAt }, five: interval(5), twenty: interval(20),
        missingStockDates: [...benchmarkPoints.keys()].filter(date => date >= start && !stockPoints.has(date)),
        missingBenchmarkDates: [...stockPoints.keys()].filter(date => date >= start && !benchmarkPoints.has(date)),
        excludedCurrentDates: [...new Set([...stock!.points, ...benchmark!.points].filter(point => !stockPoints.has(point.date) && !benchmarkPoints.has(point.date)).map(point => point.date))].sort(),
    };
}

export function compareDailyVolume(symbol: string, series: ChartSeries | null, now = new Date()): DailyVolume {
    const result: DailyVolume = { status: 'unavailable', sampleDates: [], sampleVolumes: [], missingDates: [], sampleSize: 0, requiredSample: VOLUME_BASELINE_DAYS, volumeUnit: 'shares' };
    const reason = dailySeriesReason(symbol, series);
    if (reason) return { ...result, reason };
    if (series!.volumeUnit !== 'shares') return { ...result, reason: '成交量单位未统一为股' };
    result.source = series!.source;
    result.actualKey = series!.provenance.actualKey;
    result.fetchedAt = series!.fetchedAt;
    const points = completedDailyPoints(series!, now);
    if (!points || !points.size) return { ...result, reason: '没有有效的完成日日线' };
    const ordered = [...points.values()];
    const latest = ordered.at(-1)!;
    const sample = ordered.slice(-(VOLUME_BASELINE_DAYS + 1), -1);
    const valid = (volume: number | undefined): volume is number => typeof volume === 'number' && Number.isFinite(volume) && volume >= 0;
    result.date = latest.date;
    result.volume = valid(latest.volume) ? latest.volume : undefined;
    result.sampleDates = sample.map(point => point.date);
    result.sampleVolumes = sample.map(point => valid(point.volume) ? point.volume : null);
    result.missingDates = [...sample, latest].filter(point => !valid(point.volume)).map(point => point.date);
    result.sampleSize = sample.filter(point => valid(point.volume)).length;
    if (result.volume === undefined || result.sampleSize < VOLUME_BASELINE_DAYS || sample.length < VOLUME_BASELINE_DAYS) return { ...result, reason: '最近完成日或前 20 个完成日成交量缺失，未填零或向更早日期补样本' };
    const volumes = sample.map(point => point.volume!).sort((a, b) => a - b);
    result.median = volumes[9] / 2 + volumes[10] / 2;
    if (result.median === 0) return { ...result, reason: '历史成交量中位数为 0，无法计算倍数' };
    result.ratio = result.volume / result.median;
    if (!Number.isFinite(result.ratio)) return { ...result, reason: '成交量比例超出有效范围' };
    return { ...result, status: 'available' };
}

/** One process-wide loader instance bounds simultaneous requests, coalesces duplicates and caps cache size. */
export function createDailyHistoryLoader(fetcher: (symbol: string) => Promise<ChartSeries | null>, concurrency = 4, ttlMs = 300_000, maxEntries = 256) {
    const cache = new Map<string, { expires: number; value: ChartSeries | null }>();
    const pending = new Map<string, Promise<ChartSeries | null>>();
    const queue: (() => void)[] = [];
    let running = 0;
    return function load(symbol: string): Promise<ChartSeries | null> {
        const cached = cache.get(symbol);
        if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
        if (pending.has(symbol)) return pending.get(symbol)!;
        // Bound queued work as well as completed cache entries across concurrent user requests.
        if (pending.size >= maxEntries) return Promise.resolve(null);
        const task = (async () => {
            if (running >= concurrency) await new Promise<void>(resolve => queue.push(resolve));
            else running++;
            try {
                const value = await fetcher(symbol).catch(() => null);
                cache.delete(symbol);
                if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
                cache.set(symbol, { value, expires: Date.now() + (value ? ttlMs : Math.min(ttlMs, 30_000)) });
                return value;
            } finally {
                const next = queue.shift();
                if (next) next(); else running--;
            }
        })();
        pending.set(symbol, task);
        void task.finally(() => pending.delete(symbol));
        return task;
    };
}
