// Unified provider adapters. Volumes are shares, monetary values absolute currency.
import { identifyMarketAndCode, type InstrumentIdentity, type MarketType } from './market/instrument';
import { getInstrumentCapabilities } from './market/capabilities';
import { optionalNumber as numeric, type SourceMetadata } from './market/contracts';
export { identifyMarketAndCode } from './market/instrument';
export type { MarketType } from './market/instrument';

export type UnifiedQuote = SourceMetadata & {
    symbol: string;
    name: string;
    price: number;
    priceBasis?: 'last-trade' | 'previous-close';
    prevClose?: number;
    open?: number;
    high?: number;
    low?: number;
    change?: number;
    changePercent?: number;
    volume?: number;
    volumeUnit: 'shares';
    turnover?: number;
    turnoverRate?: number;
    amplitude?: number;
    marketCap?: number;
    pe?: number;
    pb?: number;
    limitUp?: number;
    limitDown?: number;
    outer?: number;
    inner?: number;
    currency: string;
    exchange: string;
    market: MarketType;
    updatedAt: string;
    c: number;
    d?: number;
    dp?: number;
    h?: number;
    l?: number;
    o?: number;
    pc?: number;
    /** Unix source time, or 0 when unknown (Finnhub compatibility). */
    t: number;
};

export type ChartDataPoint = {
    time: string;
    date: string;
    close: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
    avgPrice?: number;
};
export type ChartPeriod = '1d' | '5d' | '1m' | '3m' | '1y' | '5y';
export type ChartSeries = SourceMetadata & {
    symbol: string;
    market: MarketType;
    period: ChartPeriod;
    interval: 'minute' | 'day' | 'week' | 'month';
    volumeUnit: 'shares';
    points: ChartDataPoint[];
    periodHigh: number;
    periodLow: number;
    latestPrice: number;
    prevClose?: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
    turnover?: number;
    turnoverRate?: number;
    amplitude?: number;
    pe?: number;
    change: number;
    changePercent: number;
    currency: string;
};
export type OrderBookTier = { level: number; price: number; volume: number };
export type TickTrade = { time: string; price: number; volume: number; side: 'B' | 'S' | 'N' };
export type Level1OrderBook = SourceMetadata & {
    symbol: string;
    name?: string;
    market: MarketType;
    currency: string;
    latestPrice: number;
    priceBasis?: 'last-trade' | 'previous-close';
    prevClose?: number;
    change?: number;
    changePercent?: number;
    bids: OrderBookTier[];
    asks: OrderBookTier[];
    volumeUnit: 'shares';
    depthAvailable: boolean;
    tickKind: 'snapshot' | 'history';
    totalBidVol?: number;
    totalAskVol?: number;
    orderRatio?: number;
    orderDelta?: number;
    outer?: number;
    inner?: number;
    limitUp?: number;
    limitDown?: number;
    ticks?: TickTrade[];
    updatedAt: string;
};
export type CapitalFlowData = SourceMetadata & {
    symbol: string;
    name: string;
    market: MarketType;
    currency: string;
    mainNetInflow?: number;
    mainNetRatio?: number;
    superLargeInflow?: number;
    superLargeRatio?: number;
    largeInflow?: number;
    largeRatio?: number;
    mediumInflow?: number;
    mediumRatio?: number;
    smallInflow?: number;
    smallRatio?: number;
    updatedAt: string;
};

/** Covers response bodies too; even an upstream ignoring abort cannot block forever. */
async function request<T>(url: string, read: (response: Response) => Promise<T>, revalidate = 10, timeout = 6000): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Market upstream timeout')); }, timeout);
    });
    try {
        return await Promise.race([
            (async () => {
                const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal, next: { revalidate } });
                if (!response.ok) throw new Error(`Market upstream HTTP ${response.status}`);
                return read(response);
            })(),
            expiry,
        ]);
    } finally {
        clearTimeout(timer);
    }
}
const json = (response: Response) => response.json();
const gbk = async (response: Response) => new TextDecoder('gbk').decode(await response.arrayBuffer());
const scale = (value: unknown, factor: number) => { const n = numeric(value); return n === undefined ? undefined : n * factor; };
const round = (value: number) => Number(value.toFixed(3));
const zone = (market: MarketType) => market === 'us' ? 'America/New_York' : market === 'tw' ? 'Asia/Taipei' : 'Asia/Shanghai';
const dayAt = (timestamp: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
const timeAt = (timestamp: number, timeZone: string) => new Date(timestamp).toLocaleTimeString('en-GB', { timeZone, hour12: false });

function sourceTime(value: unknown, market: MarketType): string | undefined {
    if (typeof value !== 'string') return undefined;
    const compact = value.trim().replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6').replace(/\//g, '-');
    const match = compact.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
    if (!match) return undefined;
    const local = Date.parse(`${match[1]}T${match[2]}Z`);
    if (!Number.isFinite(local)) return undefined;
    // Convert the provider's exchange-local clock, including US daylight saving.
    let utc = local;
    for (let i = 0; i < 2; i++) {
        const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: zone(market), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(utc));
        utc += local - Date.parse(`${parts.replace(' ', 'T')}Z`);
    }
    return Number.isFinite(utc) ? new Date(utc).toISOString() : undefined;
}
function metadata(source: string, asOf?: string): SourceMetadata {
    return { source, asOf, fetchedAt: new Date().toISOString() };
}
function twTime(item: Record<string, unknown>): string | undefined {
    const tlong = numeric(item.tlong);
    return tlong !== undefined && tlong > 0 && Number.isFinite(new Date(tlong).getTime()) ? new Date(tlong).toISOString() : undefined;
}
function tencentRows(text: string): Map<string, string[]> {
    const rows = new Map<string, string[]>();
    for (const match of text.matchAll(/v_([\w.\-]+)\s*=\s*"([^"]*)"/g)) rows.set(match[1], match[2].split('~'));
    return rows;
}
function parseTencent(parts: string[], meta: InstrumentIdentity): UnifiedQuote | null {
    const price = numeric(parts[3]);
    if (price === undefined || price <= 0) return null;
    const prevClose = numeric(parts[4]);
    const open = numeric(parts[5]);
    const high = numeric(parts[33]);
    const low = numeric(parts[34]);
    const change = numeric(parts[31]) ?? (prevClose !== undefined && prevClose > 0 ? price - prevClose : undefined);
    const changePercent = numeric(parts[32]) ?? (prevClose !== undefined && prevClose > 0 && change !== undefined ? change / prevClose * 100 : undefined);
    const asOf = sourceTime(parts[30], meta.market);
    const cn = meta.market === 'cn';
    return {
        symbol: meta.normalizedSymbol, name: parts[1] || meta.normalizedSymbol,
        price, priceBasis: 'last-trade', prevClose, open, high, low,
        change: change === undefined ? undefined : round(change), changePercent: changePercent === undefined ? undefined : round(changePercent),
        volume: scale(parts[6], cn ? 100 : 1), volumeUnit: 'shares',
        turnover: scale(parts[37], cn ? 10000 : 1),
        turnoverRate: numeric(parts[meta.market === 'hk' ? 59 : 38]),
        marketCap: scale(parts[45], 100000000), pe: numeric(parts[39]),
        pb: numeric(parts[meta.market === 'hk' ? 58 : 46]), amplitude: numeric(parts[43]),
        limitUp: cn ? numeric(parts[47]) : undefined, limitDown: cn ? numeric(parts[48]) : undefined,
        outer: cn ? scale(parts[7], 100) : undefined, inner: cn ? scale(parts[8], 100) : undefined,
        currency: meta.currency, exchange: meta.exchange, market: meta.market,
        ...metadata('tencent', asOf), updatedAt: asOf ? timeAt(Date.parse(asOf), zone(meta.market)) : '',
        c: price, d: change, dp: changePercent, h: high, l: low, o: open, pc: prevClose, t: asOf ? Date.parse(asOf) / 1000 : 0,
    };
}

/** Provider requests are unique, while every original caller key receives its own quote. */
export async function fetchRealtimeQuotes(symbols: string[]): Promise<Record<string, UnifiedQuote | null>> {
    const results: Record<string, UnifiedQuote | null> = {};
    const identities = new Map(symbols.map(symbol => [symbol, identifyMarketAndCode(symbol)]));
    const tencent = new Map<string, InstrumentIdentity>();
    const taiwan = new Map<string, InstrumentIdentity>();
    for (const [symbol, meta] of identities) {
        results[symbol] = null;
        if (meta.twseCode) taiwan.set(meta.twseCode, meta);
        else if (meta.tencentCode) tencent.set(meta.tencentCode, meta);
    }
    const quotes = new Map<string, UnifiedQuote>();
    await Promise.all([
        (async () => {
            if (!tencent.size) return;
            try {
                const text = await request(`https://qt.gtimg.cn/q=${[...tencent.keys()].join(',')}`, gbk);
                for (const [code, parts] of tencentRows(text)) {
                    const meta = tencent.get(code);
                    const quote = meta ? parseTencent(parts, meta) : null;
                    if (quote) quotes.set(code, quote);
                }
            } catch { /* Each market fails independently. */ }
        })(),
        (async () => {
            if (!taiwan.size) return;
            // These listed-company enrichments are optional, independently parsed and bounded.
            const listed = [...taiwan.values()].some(meta => meta.exchangeId === 'TWSE' && meta.kind === 'equity');
            const optionalRows = (url: string, revalidate: number) => request(url, json, revalidate, 1200)
                .then(data => Array.isArray(data) ? data.filter(row => row && typeof row === 'object') : []).catch(() => []);
            const fundamentals = listed ? Promise.all([
                optionalRows('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', 3600),
                optionalRows('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', 86400),
            ]) : Promise.resolve([[], []]);
            try {
                const data = await request(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${[...taiwan.keys()].join('|')}&json=1&delay=0`, json);
                const [valuations, companies] = await fundamentals;
                if (!Array.isArray(data?.msgArray)) return;
                for (const item of data.msgArray) {
                    if (!item || typeof item !== 'object') continue;
                    const entry = [...taiwan.entries()].find(([code]) => code === `${item.ex}_${item.c}.${item.ex === 'otc' ? 'two' : 'tw'}`);
                    if (!entry) continue;
                    const [code, meta] = entry;
                    const actualPrice = numeric(item.z);
                    const price = actualPrice ?? numeric(item.y);
                    if (price === undefined || price <= 0) continue;
                    const prevClose = numeric(item.y);
                    const open = numeric(item.o);
                    const high = numeric(item.h);
                    const low = numeric(item.l);
                    const volume = scale(item.v, 1000);
                    const change = actualPrice !== undefined && actualPrice > 0 && prevClose !== undefined && prevClose > 0 ? actualPrice - prevClose : undefined;
                    const changePercent = change !== undefined && prevClose !== undefined ? change / prevClose * 100 : undefined;
                    const valuation = meta.exchangeId === 'TWSE' ? valuations.find(row => row.Code === item.c) : undefined;
                    const company = meta.exchangeId === 'TWSE' ? companies.find(row => row['公司代號'] === item.c) : undefined;
                    const shares = numeric(company?.['已發行普通股數或TDR原股發行股數']);
                    const asOf = twTime(item);
                    quotes.set(code, {
                        symbol: meta.normalizedSymbol, name: item.n || item.nf || meta.normalizedSymbol,
                        price, priceBasis: actualPrice === undefined ? 'previous-close' : 'last-trade', prevClose, open, high, low,
                        change: change === undefined ? undefined : round(change), changePercent: changePercent === undefined ? undefined : round(changePercent),
                        volume, volumeUnit: 'shares',
                        // MIS does not supply actual turnover; last-price times volume is not turnover.
                        turnoverRate: shares && shares > 0 && volume !== undefined ? volume / shares * 100 : undefined,
                        amplitude: prevClose !== undefined && prevClose > 0 && high !== undefined && low !== undefined ? (high - low) / prevClose * 100 : undefined,
                        marketCap: shares && shares > 0 ? shares * price : undefined,
                        pe: numeric(valuation?.PEratio), pb: numeric(valuation?.PBratio),
                        limitUp: numeric(item.u), limitDown: numeric(item.w),
                        currency: meta.currency, exchange: meta.exchange, market: 'tw',
                        ...metadata('twse-mis', asOf), updatedAt: asOf ? timeAt(Date.parse(asOf), zone('tw')) : '',
                        c: price, d: change, dp: changePercent, h: high, l: low, o: open, pc: prevClose, t: asOf ? Date.parse(asOf) / 1000 : 0,
                    });
                }
            } catch { /* A valid MIS quote never depends on optional enrichment success. */ }
        })(),
    ]);
    for (const [symbol, meta] of identities) {
        const quote = quotes.get(meta.twseCode ?? meta.tencentCode ?? '');
        if (quote) results[symbol] = { ...quote, symbol };
    }
    return results;
}

function chartSeries(meta: InstrumentIdentity, period: ChartPeriod, points: ChartDataPoint[], source: string, prevClose?: number, asOf?: string, session?: Partial<Pick<UnifiedQuote, 'open' | 'high' | 'low' | 'volume' | 'turnover' | 'turnoverRate' | 'amplitude' | 'pe'>> | null): ChartSeries | null {
    points.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!points.length) return null;
    if (period === '1y' || period === '5y') points = points.slice(period === '1y' ? -172 : -180);
    const latestPrice = points[points.length - 1].close;
    const base = prevClose ?? points[0].close;
    const change = latestPrice - base;
    const stats = period === '1d' ? session : undefined;
    const periodHigh = Math.max(...points.map(point => point.high ?? point.close), ...(stats?.high !== undefined ? [stats.high] : []));
    const periodLow = Math.min(...points.map(point => point.low ?? point.close), ...(stats?.low !== undefined ? [stats.low] : []));
    return {
        symbol: meta.normalizedSymbol, market: meta.market, period,
        interval: period === '1d' || period === '5d' ? 'minute' : period === '1y' ? 'week' : period === '5y' ? 'month' : 'day',
        volumeUnit: 'shares', points,
        periodHigh, periodLow,
        open: stats?.open, high: stats?.high, low: stats?.low, volume: stats?.volume,
        turnover: stats?.turnover, turnoverRate: stats?.turnoverRate, amplitude: stats?.amplitude, pe: stats?.pe,
        latestPrice, prevClose, change: round(change), changePercent: base ? round(change / base * 100) : 0,
        currency: meta.currency, ...metadata(source, asOf),
    };
}

/** 1m includes >=120 daily bars of indicator warmup; 3m retains a longer daily history. */
export async function fetchUnifiedChartSeries(rawSymbol: string, period: ChartPeriod = '1d'): Promise<ChartSeries | null> {
    const meta = identifyMarketAndCode(rawSymbol);
    if (meta.exchangeId === 'BSE' || meta.kind === 'unknown') return null;
    try {
        if (meta.market === 'us') {
            const range = { '1d': '1d', '5d': '5d', '1m': '1y', '3m': '2y', '1y': '5y', '5y': 'max' }[period];
            const interval = { '1d': '1m', '5d': '5m', '1m': '1d', '3m': '1d', '1y': '1wk', '5y': '1mo' }[period];
            const data = await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.normalizedSymbol)}?range=${range}&interval=${interval}`, json, period === '1d' || period === '5d' ? 30 : 3600);
            const result = data?.chart?.result?.[0];
            const candles = result?.indicators?.quote?.[0];
            if (!Array.isArray(result?.timestamp) || !candles) return null;
            const points: ChartDataPoint[] = [];
            let lastTimestamp: number | undefined;
            for (let i = 0; i < result.timestamp.length; i++) {
                const close = numeric(candles.close?.[i]);
                const timestamp = numeric(result.timestamp[i]);
                if (close === undefined || timestamp === undefined) continue;
                const date = dayAt(timestamp * 1000, zone('us'));
                points.push({ time: period === '1d' || period === '5d' ? timeAt(timestamp * 1000, zone('us')).slice(0, 5) : date, date, close,
                    open: numeric(candles.open?.[i]), high: numeric(candles.high?.[i]), low: numeric(candles.low?.[i]), volume: numeric(candles.volume?.[i]) });
                lastTimestamp = Math.max(lastTimestamp ?? timestamp, timestamp);
            }
            return chartSeries(meta, period, points, 'yahoo', numeric(result.meta?.chartPreviousClose) ?? numeric(result.meta?.previousClose), lastTimestamp === undefined ? undefined : new Date(lastTimestamp * 1000).toISOString());
        }
        if (meta.market === 'cn' || meta.market === 'hk') {
            if (!meta.tencentCode) return null;
            const code = meta.tencentCode.replace(/^r_/, '');
            // The current Tencent minute source exposes a single session, not five.
            if (period === '5d') return null;
            if (period === '1d') {
                const data = await request(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`, json, 30);
                const record = data?.data?.[code];
                const raw = record?.data?.data;
                const date = String(record?.data?.date ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
                if (!Array.isArray(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
                const parts = record?.qt?.[code] ?? record?.qt?.[meta.tencentCode];
                const prevClose = Array.isArray(parts) ? numeric(parts[4]) : undefined;
                const rows = raw.filter((row): row is string => typeof row === 'string').sort();
                const points: ChartDataPoint[] = [];
                let previousVolume = 0;
                for (const row of rows) {
                    const [hhmm, rawPrice, rawVolume, rawAmount] = row.trim().split(/\s+/);
                    const close = numeric(rawPrice);
                    if (close === undefined || close <= 0 || !/^\d{4}$/.test(hhmm)) continue;
                    const cumulative = scale(rawVolume, meta.market === 'cn' ? 100 : 1);
                    const amount = numeric(rawAmount);
                    const volume = cumulative === undefined ? undefined : Math.max(0, cumulative - previousVolume);
                    if (cumulative !== undefined) previousVolume = cumulative;
                    points.push({ time: `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`, date, close, volume,
                        avgPrice: cumulative !== undefined && cumulative > 0 && amount !== undefined && amount > 0 ? amount / cumulative : undefined });
                }
                const last = points[points.length - 1];
                const session = Array.isArray(parts) ? {
                    open: numeric(parts[5]), high: numeric(parts[33]), low: numeric(parts[34]),
                    volume: scale(parts[6], meta.market === 'cn' ? 100 : 1), turnover: scale(parts[37], meta.market === 'cn' ? 10000 : 1),
                    turnoverRate: numeric(parts[meta.market === 'hk' ? 59 : 38]), amplitude: numeric(parts[43]), pe: numeric(parts[39]),
                } : undefined;
                return chartSeries(meta, period, points, 'tencent-minute', prevClose, last ? sourceTime(`${last.date} ${last.time}:00`, meta.market) : undefined, session);
            }
            const interval = period === '1y' ? 'week' : period === '5y' ? 'month' : 'day';
            const count = { '1m': 160, '3m': 240, '1y': 172, '5y': 180 }[period];
            const endpoint = meta.market === 'hk' ? 'hkfqkline' : 'fqkline';
            const data = await request(`https://web.ifzq.gtimg.cn/appstock/app/${endpoint}/get?_var=kline&param=${code},${interval},,,${count},qfq`, async response => JSON.parse((await response.text()).replace(/^\s*kline=/, '').replace(/;\s*$/, '')), 3600);
            const record = data?.data?.[code];
            const raw = record?.[`qfq${interval}`] ?? record?.[interval];
            if (!Array.isArray(raw)) return null;
            const points: ChartDataPoint[] = [];
            for (const row of raw) {
                if (!Array.isArray(row)) continue;
                const close = numeric(row[2]);
                const date = String(row[0]);
                if (close === undefined || close <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                points.push({ time: date, date, open: numeric(row[1]), close, high: numeric(row[3]), low: numeric(row[4]), volume: scale(row[5], meta.market === 'cn' ? 100 : 1) });
            }
            return chartSeries(meta, period, points, 'tencent-kline');
        }
        if (meta.market === 'tw') {
            // cnYES TWS is the listed exchange; OTC mapping is not verified.
            if (meta.exchangeId !== 'TWSE' || meta.kind === 'index') return null;
            const code = meta.normalizedSymbol.replace(/\.TW$/, '');
            const intraday = period === '1d' || period === '5d';
            const resolution = intraday ? '1' : period === '1y' ? 'W' : period === '5y' ? 'M' : 'D';
            const bars = period === '1d' ? 400 : period === '5d' ? 2000 : period === '1m' ? 160 : period === '3m' ? 240 : period === '1y' ? 172 : 180;
            const data = await request(`https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWS:${code}:STOCK&resolution=${resolution}&quote=1&countback=${bars}`, json, intraday ? 30 : 3600);
            const candles = data?.data;
            if (!Array.isArray(candles?.t) || !Array.isArray(candles?.c)) return null;
            let points: ChartDataPoint[] = [];
            let lastTimestamp: number | undefined;
            for (let i = 0; i < candles.t.length; i++) {
                const timestamp = numeric(candles.t[i]);
                const close = numeric(candles.c[i]);
                if (timestamp === undefined || close === undefined || close <= 0) continue;
                const date = dayAt(timestamp * 1000, zone('tw'));
                points.push({ time: intraday ? timeAt(timestamp * 1000, zone('tw')).slice(0, 5) : date, date, close,
                    open: numeric(candles.o?.[i]), high: numeric(candles.h?.[i]), low: numeric(candles.l?.[i]), volume: scale(candles.v?.[i], 1000), avgPrice: numeric(candles.vwap?.[i]) });
                lastTimestamp = Math.max(lastTimestamp ?? timestamp, timestamp);
            }
            points.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
            if (intraday) {
                const daysCap = period === '5d' ? 5 : 1;
                const sessions = [...new Set(points.map(point => point.date))].slice(-daysCap);
                if (sessions.length < daysCap) return null;
                points = points.filter(point => sessions.includes(point.date));
                // A provider ignoring minute resolution must not pass off daily bars as 5d intraday.
                if (period === '5d' && sessions.some(session => new Set(points.filter(point => point.date === session).map(point => point.time)).size < 2)) return null;
            } else points = points.slice(-bars);
            // Intraday baseline comes from a source quote, never the first minute.
            const quote = intraday ? (await fetchRealtimeQuotes([rawSymbol]))[rawSymbol] : null;
            return chartSeries(meta, period, points, 'cnyes', quote?.prevClose, lastTimestamp === undefined ? undefined : new Date(lastTimestamp * 1000).toISOString(), quote);
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchEastMoneyTicks(secid: string, volumeFactor = 100): Promise<TickTrade[]> {
    try {
        const data = await request(`https://push2.eastmoney.com/api/qt/stock/details/get?secid=${secid}&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55&pos=-15`, json, 5);
        if (!Array.isArray(data?.data?.details)) return [];
        const ticks: TickTrade[] = [];
        for (const row of data.data.details) {
            if (typeof row !== 'string') continue;
            const [time, rawPrice, rawVolume, , side] = row.split(',');
            const price = numeric(rawPrice);
            const volume = scale(rawVolume, volumeFactor);
            if (price === undefined || volume === undefined || price <= 0 || volume <= 0 || !/^\d{2}:\d{2}:\d{2}$/.test(time)) continue;
            ticks.push({ time, price, volume, side: side === '2' ? 'B' : side === '1' ? 'S' : 'N' });
        }
        return ticks.reverse();
    } catch { return []; }
}
function tiers(prices: unknown[], volumes: unknown[], factor: number): OrderBookTier[] {
    const result: OrderBookTier[] = [];
    for (let i = 0; i < Math.min(prices.length, volumes.length, 5); i++) {
        const price = numeric(prices[i]);
        const volume = scale(volumes[i], factor);
        if (price !== undefined && price > 0 && volume !== undefined && volume >= 0) result.push({ level: i + 1, price, volume });
    }
    return result;
}
export async function fetchLevel1OrderBook(rawSymbol: string): Promise<Level1OrderBook | null> {
    const meta = identifyMarketAndCode(rawSymbol);
    const capabilities = getInstrumentCapabilities(rawSymbol);
    if (!capabilities.depth && !capabilities.ticks) return null;
    try {
        if (meta.market === 'hk' && meta.tencentCode) {
            const [quotes, ticks] = await Promise.all([
                fetchRealtimeQuotes([rawSymbol]),
                fetchEastMoneyTicks(`116.${meta.normalizedSymbol.replace(/\.HK$/, '')}`, 1),
            ]);
            const quote = quotes[rawSymbol];
            if (!quote || !ticks.length) return null;
            return {
                symbol: meta.normalizedSymbol, name: quote.name, market: meta.market, currency: meta.currency,
                latestPrice: quote.price, priceBasis: quote.priceBasis, prevClose: quote.prevClose, change: quote.change, changePercent: quote.changePercent,
                bids: [], asks: [], ticks, depthAvailable: false, tickKind: 'history', volumeUnit: 'shares',
                source: 'tencent+eastmoney', asOf: quote.asOf, fetchedAt: quote.fetchedAt, updatedAt: quote.updatedAt,
            };
        }
        let bids: OrderBookTier[];
        let asks: OrderBookTier[];
        let quote: UnifiedQuote | null;
        let ticks: TickTrade[];
        if (meta.market === 'cn' && meta.tencentCode) {
            const code = meta.normalizedSymbol.replace(/\.(SS|SZ)$/, '');
            const [text, executions] = await Promise.all([
                request(`https://qt.gtimg.cn/q=${meta.tencentCode}`, gbk, 5),
                fetchEastMoneyTicks(`${meta.exchangeId === 'SSE' ? 1 : 0}.${code}`),
            ]);
            const parts = tencentRows(text).get(meta.tencentCode);
            if (!parts) return null;
            quote = parseTencent(parts, meta);
            bids = tiers([9, 11, 13, 15, 17].map(i => parts[i]), [10, 12, 14, 16, 18].map(i => parts[i]), 100);
            asks = tiers([19, 21, 23, 25, 27].map(i => parts[i]), [20, 22, 24, 26, 28].map(i => parts[i]), 100);
            ticks = executions;
        } else if (meta.market === 'tw' && meta.twseCode) {
            const data = await request(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${meta.twseCode}&json=1&delay=0`, json, 5);
            const item = Array.isArray(data?.msgArray) ? data.msgArray.find((row: Record<string, unknown>) => `${row.ex}_${row.c}.${row.ex === 'otc' ? 'two' : 'tw'}` === meta.twseCode) : undefined;
            if (!item) return null;
            const actualPrice = numeric(item.z);
            const price = actualPrice ?? numeric(item.y);
            if (price === undefined || price <= 0) return null;
            const prevClose = numeric(item.y);
            const change = actualPrice !== undefined && actualPrice > 0 && prevClose !== undefined && prevClose > 0 ? actualPrice - prevClose : undefined;
            const changePercent = change !== undefined && prevClose !== undefined ? change / prevClose * 100 : undefined;
            const asOf = twTime(item);
            const split = (value: unknown) => typeof value === 'string' ? value.split('_') : [];
            bids = tiers(split(item.b), split(item.g), 1000);
            asks = tiers(split(item.a), split(item.f), 1000);
            const volume = scale(item.tv, 1000);
            ticks = typeof item.t === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(item.t) && volume !== undefined && volume > 0 && actualPrice !== undefined && actualPrice > 0
                ? [{ time: item.t, price: actualPrice, volume, side: 'N' }] : [];
            quote = {
                symbol: meta.normalizedSymbol, name: item.n || item.nf || meta.normalizedSymbol, market: 'tw', currency: 'TWD', exchange: meta.exchange,
                price, priceBasis: actualPrice === undefined ? 'previous-close' : 'last-trade', prevClose, change, changePercent,
                open: numeric(item.o), high: numeric(item.h), low: numeric(item.l),
                volume: scale(item.v, 1000), volumeUnit: 'shares', limitUp: numeric(item.u), limitDown: numeric(item.w),
                ...metadata('twse-mis', asOf), updatedAt: asOf ? timeAt(Date.parse(asOf), zone('tw')) : '',
                c: price, d: change, dp: changePercent, o: numeric(item.o), h: numeric(item.h), l: numeric(item.l), pc: prevClose, t: asOf ? Date.parse(asOf) / 1000 : 0,
            };
        } else return null;
        if (!quote || (!bids.length && !asks.length && !ticks.length)) return null;
        const depthAvailable = bids.length > 0 || asks.length > 0;
        const totalBidVol = bids.reduce((sum, tier) => sum + tier.volume, 0);
        const totalAskVol = asks.reduce((sum, tier) => sum + tier.volume, 0);
        return {
            symbol: meta.normalizedSymbol, name: quote.name, market: meta.market, currency: meta.currency,
            latestPrice: quote.price, priceBasis: quote.priceBasis, prevClose: quote.prevClose, change: quote.change, changePercent: quote.changePercent,
            bids, asks, totalBidVol: depthAvailable ? totalBidVol : undefined, totalAskVol: depthAvailable ? totalAskVol : undefined,
            orderDelta: depthAvailable ? totalBidVol - totalAskVol : undefined,
            depthAvailable, tickKind: meta.market === 'tw' ? 'snapshot' : 'history', volumeUnit: 'shares',
            orderRatio: totalBidVol + totalAskVol > 0 ? round((totalBidVol - totalAskVol) / (totalBidVol + totalAskVol) * 100) : undefined,
            ticks, outer: quote.outer, inner: quote.inner, limitUp: quote.limitUp, limitDown: quote.limitDown,
            source: quote.source, asOf: quote.asOf, fetchedAt: quote.fetchedAt, updatedAt: quote.updatedAt,
        };
    } catch { return null; }
}

export async function fetchCapitalFlow(rawSymbol: string): Promise<CapitalFlowData | null> {
    const meta = identifyMarketAndCode(rawSymbol);
    if (!getInstrumentCapabilities(rawSymbol).capitalFlow) return null;
    const code = meta.normalizedSymbol.replace(/\.(SS|SZ|HK)$/, '');
    const secid = `${meta.market === 'hk' ? 116 : meta.exchangeId === 'SSE' ? 1 : 0}.${code}`;
    try {
        const data = await request(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secid}&fields=f12,f14,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124`, json, 15);
        const row = data?.data?.diff?.[0];
        if (!row) return null;
        const values = {
            mainNetInflow: numeric(row.f62), mainNetRatio: numeric(row.f184),
            superLargeInflow: numeric(row.f66), superLargeRatio: numeric(row.f69),
            largeInflow: numeric(row.f72), largeRatio: numeric(row.f75),
            mediumInflow: numeric(row.f78), mediumRatio: numeric(row.f81),
            smallInflow: numeric(row.f84), smallRatio: numeric(row.f87),
        };
        if (Object.values(values).every(value => value === undefined)) return null;
        const timestamp = numeric(row.f124);
        const asOf = timestamp !== undefined && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : undefined;
        return { symbol: meta.normalizedSymbol, name: row.f14 || meta.normalizedSymbol, market: meta.market, currency: meta.currency,
            ...values, ...metadata('eastmoney', asOf), updatedAt: asOf ? timeAt(Date.parse(asOf), zone(meta.market)) : '' };
    } catch { return null; }
}
