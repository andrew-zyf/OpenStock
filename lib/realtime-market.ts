// Unified multi-market real-time quote and historical chart engine
// Covers:
//   - A-Shares (SSE / SZSE): Tencent GTK & Sina Real-Time Level-1
//   - Hong Kong (HKEX): Tencent GTK & Sina Real-Time (r_hk prefix)
//   - Taiwan (TWSE / TPEX): Taiwan Stock Exchange Official MIS API & cnYES
//   - US (Nasdaq / NYSE): Finnhub & Tencent US (us prefix)

export type MarketType = 'cn' | 'hk' | 'tw' | 'us';

export type UnifiedQuote = {
    symbol: string;
    name: string;
    price: number;
    prevClose: number;
    open: number;
    high: number;
    low: number;
    change: number;
    changePercent: number;
    volume: number;
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
    // Finnhub-compatible shorthand for useLiveQuotes
    c: number;
    d: number;
    dp: number;
    h: number;
    l: number;
    o: number;
    pc: number;
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

export type ChartSeries = {
    symbol: string;
    market: MarketType;
    period: ChartPeriod;
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

/**
 * Detect market and return Tencent/TWSE formatted ticker
 */
export function identifyMarketAndCode(rawSymbol: string): {
    market: MarketType;
    normalizedSymbol: string;
    tencentCode?: string;
    twseCode?: string;
    currency: string;
    exchange: string;
} {
    const s = rawSymbol.trim().toUpperCase();

    // Taiwan
    if (s.endsWith('.TW') || s.startsWith('TWSE:') || s.endsWith('.TWO') || s.startsWith('TPEX:')) {
        const num = s.replace(/^(TWSE:|TPEX:)/, '').replace(/\.(TW|TWO)$/, '');
        const isOtc = s.endsWith('.TWO') || s.startsWith('TPEX:');
        return {
            market: 'tw',
            normalizedSymbol: `${num}.TW`,
            twseCode: isOtc ? `otc_${num}.two` : `tse_${num}.tw`,
            currency: 'TWD',
            exchange: isOtc ? '台湾柜买中心' : '台湾证券交易所',
        };
    }

    // Hong Kong
    if (s.endsWith('.HK') || s.startsWith('HKEX:')) {
        const rawNum = s.replace(/^HKEX:/, '').replace(/\.HK$/, '');
        const padded5 = rawNum.padStart(5, '0');
        const padded4 = rawNum.padStart(4, '0');
        return {
            market: 'hk',
            normalizedSymbol: `${padded4}.HK`,
            tencentCode: `r_hk${padded5}`,
            currency: 'HKD',
            exchange: '香港交易所',
        };
    }

    // A-Shares with suffix
    if (s.endsWith('.SS') || s.startsWith('SSE:')) {
        const num = s.replace(/^SSE:/, '').replace(/\.SS$/, '');
        return {
            market: 'cn',
            normalizedSymbol: `${num}.SS`,
            tencentCode: `sh${num}`,
            currency: 'CNY',
            exchange: '上海证券交易所',
        };
    }
    if (s.endsWith('.SZ') || s.startsWith('SZSE:')) {
        const num = s.replace(/^SZSE:/, '').replace(/\.SZ$/, '');
        return {
            market: 'cn',
            normalizedSymbol: `${num}.SZ`,
            tencentCode: `sz${num}`,
            currency: 'CNY',
            exchange: '深圳证券交易所',
        };
    }

    // Pure 6-digit numeric (A-share convention)
    if (/^\d{6}$/.test(s)) {
        const isSh = s.startsWith('6') || s.startsWith('9');
        return {
            market: 'cn',
            normalizedSymbol: isSh ? `${s}.SS` : `${s}.SZ`,
            tencentCode: isSh ? `sh${s}` : `sz${s}`,
            currency: 'CNY',
            exchange: isSh ? '上海证券交易所' : '深圳证券交易所',
        };
    }

    // Pure 4-digit or 5-digit numeric (Hong Kong convention)
    if (/^\d{3,5}$/.test(s)) {
        const padded5 = s.padStart(5, '0');
        const padded4 = s.padStart(4, '0');
        return {
            market: 'hk',
            normalizedSymbol: `${padded4}.HK`,
            tencentCode: `r_hk${padded5}`,
            currency: 'HKD',
            exchange: '香港交易所',
        };
    }

    // Default to US stock
    const usTicker = s.replace(/^(NASDAQ:|NYSE:|AMEX:)/, '');
    return {
        market: 'us',
        normalizedSymbol: usTicker,
        tencentCode: `us${usTicker}`,
        currency: 'USD',
        exchange: '美股市场',
    };
}

/**
 * Fetch real-time quotes for multiple symbols from Tencent GTK & TWSE MIS
 */
export async function fetchRealtimeQuotes(symbols: string[]): Promise<Record<string, UnifiedQuote | null>> {
    const results: Record<string, UnifiedQuote | null> = {};
    if (!symbols.length) return results;

    const tencentQueries: { original: string; tencentCode: string; market: MarketType; currency: string; exchange: string }[] = [];
    const twseQueries: { original: string; twseCode: string }[] = [];

    for (const sym of symbols) {
        results[sym] = null;
        const meta = identifyMarketAndCode(sym);
        if (meta.market === 'tw' && meta.twseCode) {
            twseQueries.push({ original: sym, twseCode: meta.twseCode });
        } else if (meta.tencentCode) {
            tencentQueries.push({
                original: sym,
                tencentCode: meta.tencentCode,
                market: meta.market,
                currency: meta.currency,
                exchange: meta.exchange,
            });
        }
    }

    const tasks: Promise<void>[] = [];

    // 1. Fetch Tencent GTK for CN, HK, and US
    if (tencentQueries.length > 0) {
        tasks.push(
            (async () => {
                try {
                    const queryCodes = tencentQueries.map((q) => q.tencentCode).join(',');
                    const res = await fetch(`http://qt.gtimg.cn/q=${queryCodes}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                        next: { revalidate: 10 },
                    });
                    if (!res.ok) return;

                    const buffer = await res.arrayBuffer();
                    const text = new TextDecoder('gbk').decode(buffer);

                    for (const line of text.split(';')) {
                        if (!line.trim()) continue;
                        const [rawVar, rawVal] = line.split('=');
                        if (!rawVar || !rawVal) continue;
                        const varName = rawVar.trim(); // e.g. v_sh600519 or v_r_hk00700
                        const val = rawVal.replace(/"/g, '').trim();
                        const parts = val.split('~');
                        if (parts.length < 5) continue;

                        const matched = tencentQueries.find((q) => varName.endsWith(q.tencentCode));
                        if (!matched) continue;

                        let name = parts[1] || matched.original;
                        const price = Number(parts[3]) || 0;
                        const prevClose = Number(parts[4]) || 0;
                        const open = Number(parts[5]) || 0;
                        let change = 0;
                        let changePercent = 0;
                        let high = 0;
                        let low = 0;
                        let volume = Number(parts[6]) || 0;

                        if (matched.market === 'us') {
                            change = Number(parts[31]) || 0;
                            changePercent = Number(parts[32]) || 0;
                            high = Number(parts[33]) || 0;
                            low = Number(parts[34]) || 0;
                        } else if (matched.market === 'hk') {
                            change = Number(parts[31]) || (prevClose ? price - prevClose : 0);
                            changePercent = Number(parts[32]) || (prevClose ? (change / prevClose) * 100 : 0);
                            high = Number(parts[33]) || 0;
                            low = Number(parts[34]) || 0;
                        } else {
                            // A-shares
                            change = Number(parts[31]) || (prevClose ? price - prevClose : 0);
                            changePercent = Number(parts[32]) || (prevClose ? (change / prevClose) * 100 : 0);
                            high = Number(parts[33]) || 0;
                            low = Number(parts[34]) || 0;
                        }

                        const outer = Number(parts[7]) || 0;
                        const inner = Number(parts[8]) || 0;
                        const turnoverWan = Number(parts[37]) || 0;
                        const turnoverRate = Number(parts[38]) || 0;
                        const pe = Number(parts[39]) || undefined;
                        const amplitude = Number(parts[43]) || (prevClose ? Number((((high - low) / prevClose) * 100).toFixed(2)) : 0);
                        const pb = Number(parts[46]) || undefined;
                        const limitUp = Number(parts[47]) || undefined;
                        const limitDown = Number(parts[48]) || undefined;
                        const volumeRatio = Number(parts[49]) || undefined;

                        const quote: UnifiedQuote = {
                            symbol: matched.original,
                            name,
                            price,
                            prevClose,
                            open,
                            high: high || price,
                            low: low || price,
                            change: Number(change.toFixed(3)),
                            changePercent: Number(changePercent.toFixed(2)),
                            volume,
                            turnover: turnoverWan ? turnoverWan * 10000 : 0,
                            turnoverRate,
                            amplitude,
                            marketCap: Number(parts[44]) ? Number(parts[44]) * 100000000 : undefined,
                            pe,
                            pb,
                            limitUp,
                            limitDown,
                            outer,
                            inner,
                            currency: matched.currency,
                            exchange: matched.exchange,
                            market: matched.market,
                            updatedAt: new Date().toLocaleTimeString('zh-CN'),
                            c: price,
                            d: change,
                            dp: changePercent,
                            h: high || price,
                            l: low || price,
                            o: open || price,
                            pc: prevClose,
                            t: Math.floor(Date.now() / 1000),
                        };

                        results[matched.original] = quote;
                    }
                } catch (e) {
                    console.error('Tencent quote fetch error', e);
                }
            })(),
        );
    }

    // 2. Fetch Taiwan TWSE MIS
    if (twseQueries.length > 0) {
        tasks.push(
            (async () => {
                try {
                    const exCh = twseQueries.map((q) => q.twseCode).join('|');
                    const res = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0`, {
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                        next: { revalidate: 10 },
                    });
                    if (!res.ok) return;

                    const json = await res.json();
                    const list = json?.msgArray || [];

                    for (const item of list) {
                        const matched = twseQueries.find((q) => q.twseCode.includes(item.c));
                        if (!matched) continue;

                        const price = Number(item.z) || Number(item.y) || 0;
                        const prevClose = Number(item.y) || 0;
                        const change = prevClose ? price - prevClose : 0;
                        const changePercent = prevClose ? (change / prevClose) * 100 : 0;

                        const quote: UnifiedQuote = {
                            symbol: matched.original,
                            name: item.n || item.nf || matched.original,
                            price,
                            prevClose,
                            open: Number(item.o) || price,
                            high: Number(item.h) || price,
                            low: Number(item.l) || price,
                            change: Number(change.toFixed(2)),
                            changePercent: Number(changePercent.toFixed(2)),
                            volume: Number(item.v) || 0,
                            currency: 'TWD',
                            exchange: item.ex === 'otc' ? '台湾柜买中心' : '台湾证券交易所',
                            market: 'tw',
                            updatedAt: item.t || new Date().toLocaleTimeString('zh-CN'),
                            c: price,
                            d: change,
                            dp: changePercent,
                            h: Number(item.h) || price,
                            l: Number(item.l) || price,
                            o: Number(item.o) || price,
                            pc: prevClose,
                            t: Math.floor(Date.now() / 1000),
                        };

                        results[matched.original] = quote;
                    }
                } catch (e) {
                    console.error('TWSE quote fetch error', e);
                }
            })(),
        );
    }

    await Promise.all(tasks);
    return results;
}

/**
 * Fetch unified chart data (1-day intraday minute or multi-day historical candles)
 */
export async function fetchUnifiedChartSeries(
    rawSymbol: string,
    period: ChartPeriod = '1d',
): Promise<ChartSeries | null> {
    const meta = identifyMarketAndCode(rawSymbol);

    try {
        // --- 1. US Equities (Yahoo Finance Real-Time 1-min & Historical) ---
        if (meta.market === 'us') {
            const range = period === '1d' ? '1d' : period === '5d' ? '5d' : period === '1m' ? '1mo' : period === '3m' ? '3mo' : period === '1y' ? '1y' : '5y';
            const interval = period === '1d' ? '1m' : period === '5d' ? '5m' : period === '1y' ? '1wk' : period === '5y' ? '1mo' : '1d';
            const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${meta.normalizedSymbol}?range=${range}&interval=${interval}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: period === '1d' || period === '5d' ? 30 : 3600 },
            });
            if (res.ok) {
                const json = await res.json();
                const result = json?.chart?.result?.[0];
                const timestamps: number[] = result?.timestamp || [];
                const quoteObj = result?.indicators?.quote?.[0];
                const closes: (number | null)[] = quoteObj?.close || [];
                const opens: (number | null)[] = quoteObj?.open || [];
                const highs: (number | null)[] = quoteObj?.high || [];
                const lows: (number | null)[] = quoteObj?.low || [];
                const volumes: (number | null)[] = quoteObj?.volume || [];
                const metaData = result?.meta;
                const prevClose = metaData?.chartPreviousClose || metaData?.previousClose;

                const points: ChartDataPoint[] = [];
                for (let i = 0; i < timestamps.length; i++) {
                    const close = closes[i];
                    if (close == null || !Number.isFinite(close)) continue;
                    const d = new Date(timestamps[i] * 1000);
                    const timeStr = (period === '1d' || period === '5d')
                        ? d.toLocaleTimeString('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
                        : d.toISOString().split('T')[0];
                    const dateStr = d.toISOString().split('T')[0];
                    points.push({
                        time: timeStr,
                        date: dateStr,
                        close: Number(close.toFixed(2)),
                        open: opens[i] != null && Number.isFinite(opens[i]) ? Number(opens[i]!.toFixed(2)) : Number(close.toFixed(2)),
                        high: highs[i] != null && Number.isFinite(highs[i]) ? Number(highs[i]!.toFixed(2)) : Number(close.toFixed(2)),
                        low: lows[i] != null && Number.isFinite(lows[i]) ? Number(lows[i]!.toFixed(2)) : Number(close.toFixed(2)),
                        volume: volumes[i] != null && Number.isFinite(volumes[i]) ? Number(volumes[i]!) : 0,
                    });
                }

                if (points.length > 0) {
                    const validCloses = points.map((p) => p.close);
                    const periodHigh = Math.max(...validCloses);
                    const periodLow = Math.min(...validCloses);
                    const basePrice = prevClose || points[0].close;
                    const latestPrice = points[points.length - 1].close;
                    const change = latestPrice - basePrice;
                    const changePercent = basePrice ? (change / basePrice) * 100 : 0;

                    return {
                        symbol: meta.normalizedSymbol,
                        market: 'us',
                        period,
                        points,
                        periodHigh,
                        periodLow,
                        latestPrice,
                        prevClose,
                        change: Number(change.toFixed(2)),
                        changePercent: Number(changePercent.toFixed(2)),
                        currency: metaData?.currency || 'USD',
                    };
                }
            }
        }

        // --- 2. A-Shares & HK Stocks ---
        if (meta.market === 'cn' || meta.market === 'hk') {
            const queryCode = meta.market === 'hk' ? meta.tencentCode!.replace(/^r_/, '') : meta.tencentCode;
            if (period === '1d') {
                // Fetch Tencent 1-day minute series
                const res = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${queryCode}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    next: { revalidate: 30 },
                });
                if (!res.ok) return null;
                const json = await res.json();
                const rawList: string[] = json?.data?.[queryCode!]?.data?.data || [];
                if (!rawList.length) return null;

                const points: ChartDataPoint[] = [];
                let prevVol = 0;
                for (const item of rawList) {
                    const parts = item.trim().split(' ');
                    if (parts.length < 2) continue;
                    const hhmm = parts[0];
                    const close = Number(parts[1]);
                    if (!close) continue;
                    const cumVol = Number(parts[2]) || 0;
                    const cumAmt = Number(parts[3]) || 0;
                    const minVol = Math.max(0, cumVol - prevVol);
                    prevVol = cumVol;

                    // Calculate VWAP: amount / (volume * 100 for A-shares, volume for HK)
                    const avgPrice = cumVol > 0 ? (meta.market === 'cn' ? cumAmt / (cumVol * 100) : cumAmt / cumVol) : close;
                    const formattedTime = `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
                    points.push({
                        time: formattedTime,
                        date: '今日',
                        close,
                        open: close,
                        high: close,
                        low: close,
                        volume: minVol,
                        avgPrice: Number(avgPrice.toFixed(2)),
                    });
                }

                if (!points.length) return null;
                const closes = points.map((p) => p.close);
                const periodHigh = Math.max(...closes);
                const periodLow = Math.min(...closes);
                const firstPrice = points[0].close;
                const latestPrice = points[points.length - 1].close;
                const change = latestPrice - firstPrice;
                const changePercent = firstPrice ? (change / firstPrice) * 100 : 0;

                return {
                    symbol: meta.normalizedSymbol,
                    market: meta.market,
                    period,
                    points,
                    periodHigh,
                    periodLow,
                    latestPrice,
                    change,
                    changePercent,
                    currency: meta.currency,
                };
            } else {
                // Multi-day K-Line from Tencent
                const daysMap = { '5d': 5, '1m': 22, '3m': 66, '1y': 250, '5y': 1200 };
                const count = daysMap[period] || 66;
                const url = meta.market === 'hk'
                    ? `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?_var=kline&param=${queryCode},day,,,${count},qfq`
                    : `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline&param=${queryCode},day,,,${count},qfq`;

                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    next: { revalidate: 3600 },
                });
                if (!res.ok) return null;
                const text = await res.text();
                const jsonStr = text.replace(/^kline=/, '').trim();
                const json = JSON.parse(jsonStr);
                const rawCandles: (string | object)[][] =
                    json?.data?.[queryCode!]?.qfqday ||
                    json?.data?.[queryCode!]?.day ||
                    [];

                const points: ChartDataPoint[] = [];
                for (const candle of rawCandles) {
                    const date = String(candle[0]);
                    const open = Number(candle[1]);
                    const close = Number(candle[2]);
                    const high = Number(candle[3]);
                    const low = Number(candle[4]);
                    const volume = Number(candle[5]) || 0;
                    if (!close) continue;
                    points.push({ time: date, date, open, close, high, low, volume });
                }

                if (!points.length) return null;
                const closes = points.map((p) => p.close);
                const periodHigh = Math.max(...closes);
                const periodLow = Math.min(...closes);
                const firstPrice = points[0].close;
                const latestPrice = points[points.length - 1].close;
                const change = latestPrice - firstPrice;
                const changePercent = firstPrice ? (change / firstPrice) * 100 : 0;

                return {
                    symbol: meta.normalizedSymbol,
                    market: meta.market,
                    period,
                    points,
                    periodHigh,
                    periodLow,
                    latestPrice,
                    change,
                    changePercent,
                    currency: meta.currency,
                };
            }
        }

        // --- 2. Taiwan Stocks (cnYES API) ---
        if (meta.market === 'tw') {
            const num = meta.normalizedSymbol.replace(/\.TW$/, '');
            const resolution = period === '1d' ? '1' : 'D';
            const url = `https://ws.api.cnyes.com/ws/api/v1/charting/history?symbol=TWS:${num}:STOCK&resolution=${resolution}&quote=1`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: period === '1d' ? 30 : 3600 },
            });
            if (!res.ok) return null;
            const json = await res.json();
            const data = json?.data;
            if (!data?.t || !data?.c) return null;

            const daysCap = period === '1d' ? 300 : period === '1m' ? 22 : period === '3m' ? 66 : period === '1y' ? 250 : 1200;
            const total = data.t.length;
            const startIdx = Math.max(0, total - daysCap);

            const points: ChartDataPoint[] = [];
            for (let i = startIdx; i < total; i++) {
                const ts = data.t[i] * 1000;
                const d = new Date(ts);
                const timeStr = period === '1d'
                    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                    : d.toISOString().split('T')[0];
                const close = Number(data.c[i]);
                if (!close) continue;
                points.push({
                    time: timeStr,
                    date: d.toISOString().split('T')[0],
                    close,
                    open: Number(data.o?.[i]) || close,
                    high: Number(data.h?.[i]) || close,
                    low: Number(data.l?.[i]) || close,
                    volume: Number(data.v?.[i]) || 0,
                    avgPrice: Number(data.vwap?.[i]) || close,
                });
            }

            if (!points.length) return null;
            const closes = points.map((p) => p.close);
            const periodHigh = Math.max(...closes);
            const periodLow = Math.min(...closes);
            const firstPrice = points[0].close;
            const latestPrice = points[points.length - 1].close;
            const change = latestPrice - firstPrice;
            const changePercent = firstPrice ? (change / firstPrice) * 100 : 0;

            return {
                symbol: meta.normalizedSymbol,
                market: meta.market,
                period,
                points,
                periodHigh,
                periodLow,
                latestPrice,
                change,
                changePercent,
                currency: 'TWD',
            };
        }

        return null;
    } catch (e) {
        console.error('fetchUnifiedChartSeries error', e);
        return null;
    }
}
