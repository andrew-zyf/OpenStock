// Markets OpenStock can show for free. Coverage was tested against the free data sources:
//   - Finnhub free: US stocks and crypto only (every other exchange returns 403).
//   - TradingView embeds: US, crypto, forex live; TSX + ASX delayed; BSE + XETRA end-of-day.
//     NSE and TVC indices (NIFTY, FTSE, DAX, N225, HSI) are blocked in embeds; LSE, Tokyo, Hong Kong and
//     others block only the candle chart (see CHART_BLOCKED_EXCHANGES in lib/utils.ts).
//   - Tadawul is blocked in embeds and on Finnhub free, so Saudi tiles and tables are priced from Yahoo Finance (lib/yahoo.ts).
// Adding a market = adding an entry here with symbols from an exchange that renders in embeds.

import { isInternationalSymbol } from "@/lib/utils";

export type MarketId = 'us' | 'cn' | 'hk' | 'tw';

type Hours = { open: number; close: number }; // minutes of the local day

export type Market = {
    id: MarketId;
    name: string;
    short: string;
    timeZone: string;
    hours: Hours | '24/7' | '24/5';
    tradingDays?: number[]; // 0 = Sunday; Monday to Friday when unset
    feed: 'Live' | 'Delayed' | 'End of day';
    // Tiles on the dashboard. `finnhub` set = native tile with our own cached quote; otherwise a TradingView quote.
    pulse: { symbol: string; label: string; finnhub?: string }[];
    // Priced from Yahoo instead of TradingView: tiles, leaders and quotes are our own components
    yahoo?: true;
    // Uses native Level-1 real-time quotes table and movers instead of TradingView widgets
    native?: true;
    groups: { title: string; symbols: [symbol: string, name: string][] }[];
    heatmap?: 'stocks' | 'crypto';
    news: 'stock' | 'crypto' | 'forex';
};

const hm = (h: number, m = 0) => h * 60 + m;

export const MARKETS: Market[] = [
    {
        id: 'us', name: '美股', short: '美股', timeZone: 'America/New_York', hours: { open: hm(9, 30), close: hm(16) }, feed: 'Live', native: true,
        pulse: [
            { symbol: 'AMEX:SPY', label: '标普 500', finnhub: 'SPY' },
            { symbol: 'NASDAQ:QQQ', label: '纳斯达克 100', finnhub: 'QQQ' },
            { symbol: 'AMEX:DIA', label: '道琼斯 30', finnhub: 'DIA' },
            { symbol: 'AMEX:IWM', label: '罗素 2000', finnhub: 'IWM' },
        ],
        groups: [
            { title: '科技先锋', symbols: [['NASDAQ:AAPL', 'Apple'], ['NASDAQ:MSFT', 'Microsoft'], ['NASDAQ:NVDA', 'NVIDIA'], ['NASDAQ:GOOGL', 'Alphabet'], ['NASDAQ:META', 'Meta'], ['NASDAQ:AMD', 'AMD']] },
            { title: '核心金融', symbols: [['NYSE:JPM', 'JPMorgan Chase'], ['NYSE:BAC', 'Bank of America'], ['NYSE:WFC', 'Wells Fargo'], ['NYSE:GS', 'Goldman Sachs'], ['NYSE:MA', 'Mastercard'], ['NYSE:V', 'Visa']] },
            { title: '消费制造', symbols: [['NASDAQ:AMZN', 'Amazon'], ['NASDAQ:TSLA', 'Tesla'], ['NYSE:WMT', 'Walmart'], ['NASDAQ:COST', 'Costco'], ['NYSE:KO', 'Coca-Cola'], ['NASDAQ:NFLX', 'Netflix']] },
        ],
        heatmap: 'stocks', news: 'stock',
    },
    {
        id: 'cn', name: 'A股', short: 'A股', timeZone: 'Asia/Shanghai', hours: { open: hm(9, 30), close: hm(15) }, feed: 'Live', native: true,
        pulse: [
            { symbol: 'SSE:000001', label: '上证指数', finnhub: '000001.SS' },
            { symbol: 'SZSE:399001', label: '深证成指', finnhub: '399001.SZ' },
            { symbol: 'SSE:000300', label: '沪深 300', finnhub: '000300.SS' },
            { symbol: 'SZSE:399006', label: '创业板指', finnhub: '399006.SZ' },
        ],
        groups: [
            { title: '核心蓝筹', symbols: [['SSE:600519', '贵州茅台'], ['SZSE:300750', '宁德时代'], ['SZSE:002594', '比亚迪'], ['SSE:601318', '中国平安'], ['SSE:600036', '招商银行'], ['SSE:600900', '长江电力']] },
            { title: '科技半导体', symbols: [['SSE:688981', '中芯国际'], ['SZSE:002415', '海康威视'], ['SSE:601138', '工业富联'], ['SZSE:002241', '歌尔股份'], ['SZSE:300124', '汇川技术'], ['SZSE:000063', '中兴通讯']] },
            { title: '消费与制造', symbols: [['SZSE:000858', '五粮液'], ['SZSE:000333', '美的集团'], ['SZSE:000651', '格力电器'], ['SSE:600276', '恒瑞医药'], ['SZSE:300760', '迈瑞医疗'], ['SSE:601857', '中国石油']] },
        ],
        news: 'stock',
    },
    {
        id: 'hk', name: '港股', short: '港股', timeZone: 'Asia/Hong_Kong', hours: { open: hm(9, 30), close: hm(16) }, feed: 'Live', native: true,
        pulse: [
            { symbol: 'HKEX:2800', label: '恒生指数 (盈富)', finnhub: '2800.HK' },
            { symbol: 'HKEX:3033', label: '恒生科技 (南方)', finnhub: '3033.HK' },
            { symbol: 'HKEX:0700', label: '腾讯控股', finnhub: '0700.HK' },
            { symbol: 'HKEX:9988', label: '阿里巴巴', finnhub: '9988.HK' },
        ],
        groups: [
            { title: '科技互联网', symbols: [['HKEX:0700', '腾讯控股'], ['HKEX:9988', '阿里巴巴'], ['HKEX:3690', '美团'], ['HKEX:1810', '小米集团'], ['HKEX:9888', '百度集团'], ['HKEX:9618', '京东集团']] },
            { title: '金融与综合', symbols: [['HKEX:0005', '汇丰控股'], ['HKEX:1299', '友邦保险'], ['HKEX:0388', '香港交易所'], ['HKEX:0939', '建设银行'], ['HKEX:1398', '工商银行'], ['HKEX:2318', '中国平安']] },
            { title: '蓝筹与汽车', symbols: [['HKEX:1211', '比亚迪股份'], ['HKEX:2015', '理想汽车'], ['HKEX:0941', '中国移动'], ['HKEX:0883', '中国海洋石油'], ['HKEX:0027', '银河娱乐'], ['HKEX:0016', '新鸿基地产']] },
        ],
        news: 'stock',
    },
    {
        id: 'tw', name: '台股', short: '台股', timeZone: 'Asia/Taipei', hours: { open: hm(9), close: hm(13, 30) }, feed: 'Live', native: true,
        pulse: [
            { symbol: 'TWSE:0050', label: '元大台湾50', finnhub: '0050.TW' },
            { symbol: 'TWSE:2330', label: '台积电', finnhub: '2330.TW' },
            { symbol: 'TWSE:2317', label: '鸿海', finnhub: '2317.TW' },
            { symbol: 'TWSE:2454', label: '联发科', finnhub: '2454.TW' },
        ],
        groups: [
            { title: '半导体电子', symbols: [['TWSE:2330', '台积电'], ['TWSE:2454', '联发科'], ['TWSE:2303', '联电'], ['TWSE:2379', '瑞昱'], ['TWSE:3034', '联咏'], ['TWSE:3711', '日月光投控']] },
            { title: '电脑与代工', symbols: [['TWSE:2317', '鸿海'], ['TWSE:2382', '广达'], ['TWSE:2308', '台达电'], ['TWSE:3231', '纬创'], ['TWSE:2357', '华硕'], ['TWSE:6669', '纬颖']] },
            { title: '金融与航运', symbols: [['TWSE:2881', '富邦金'], ['TWSE:2882', '国泰金'], ['TWSE:2891', '中信金'], ['TWSE:2886', '兆丰金'], ['TWSE:2603', '长荣'], ['TWSE:2609', '阳明']] },
        ],
        news: 'stock',
    },
];

export const DEFAULT_MARKET: MarketId = 'us';
export const MARKET_COOKIE = 'openstock-market';

export const getMarket = (id?: string | null) => MARKETS.find((m) => m.id === id) ?? MARKETS[0];

const COUNTRY_MARKET: Record<string, MarketId> = { CN: 'cn', HK: 'hk', TW: 'tw', US: 'us' };
export const marketForCountry = (country?: string | null): MarketId => COUNTRY_MARKET[country ?? ''] ?? DEFAULT_MARKET;

// Finnhub free can price (and so alert on) US listings and Binance pairs only.
export const hasFinnhubQuotes = (symbol: string) => {
    const upper = symbol.toUpperCase();
    if (upper.startsWith('BINANCE:')) return true;
    return !upper.includes(':') && !isInternationalSymbol(upper);
};

// Is the market trading right now, in its own time zone? Holidays aren't modelled.
export function isMarketOpen(market: Market, date = new Date()) {
    if (market.hours === '24/7') return true;
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: market.timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
            .formatToParts(date).map((p) => [p.type, p.value]),
    );
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    if (market.hours === '24/5') {
        // FX: Sunday 17:00 to Friday 17:00, New York time
        if (day === 6) return false;
        if (day === 0) return minutes >= hm(17);
        if (day === 5) return minutes < hm(17);
        return true;
    }
    return (market.tradingDays ?? [1, 2, 3, 4, 5]).includes(day) && minutes >= market.hours.open && minutes < market.hours.close;
}
