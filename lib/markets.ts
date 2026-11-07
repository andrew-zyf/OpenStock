import { isInternationalSymbol } from "@/lib/utils";
import { identifyMarketAndCode } from "@/lib/market/instrument";

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
    pulse: { symbol: string; label: string; finnhub?: string }[];
    yahoo?: true;
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
            { symbol: 'SPY', label: '标普 500 ETF', finnhub: 'SPY' },
            { symbol: 'QQQ', label: '纳斯达克 100 ETF', finnhub: 'QQQ' },
            { symbol: 'DIA', label: '道琼斯 30 ETF', finnhub: 'DIA' },
            { symbol: 'IWM', label: '罗素 2000 ETF', finnhub: 'IWM' },
        ],
        groups: [
            { title: '科技先锋', symbols: [['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['GOOGL', 'Alphabet'], ['META', 'Meta'], ['AMD', 'AMD']] },
            { title: '核心金融', symbols: [['JPM', 'JPMorgan Chase'], ['BAC', 'Bank of America'], ['WFC', 'Wells Fargo'], ['GS', 'Goldman Sachs'], ['MA', 'Mastercard'], ['V', 'Visa']] },
            { title: '消费制造', symbols: [['AMZN', 'Amazon'], ['TSLA', 'Tesla'], ['WMT', 'Walmart'], ['COST', 'Costco'], ['KO', 'Coca-Cola'], ['NFLX', 'Netflix']] },
        ],
        heatmap: 'stocks', news: 'stock',
    },
    {
        id: 'cn', name: 'A股', short: 'A股', timeZone: 'Asia/Shanghai', hours: { open: hm(9, 30), close: hm(15) }, feed: 'Live', native: true,
        pulse: [
            { symbol: '000001.SS', label: '上证指数', finnhub: '000001.SS' },
            { symbol: '399001.SZ', label: '深证成指', finnhub: '399001.SZ' },
            { symbol: '000300.SS', label: '沪深 300', finnhub: '000300.SS' },
            { symbol: '399006.SZ', label: '创业板指', finnhub: '399006.SZ' },
        ],
        groups: [
            { title: '核心蓝筹', symbols: [['600519.SS', '贵州茅台'], ['300750.SZ', '宁德时代'], ['002594.SZ', '比亚迪'], ['601318.SS', '中国平安'], ['600036.SS', '招商银行'], ['600900.SS', '长江电力']] },
            { title: '科技半导体', symbols: [['688981.SS', '中芯国际'], ['002415.SZ', '海康威视'], ['601138.SS', '工业富联'], ['002241.SZ', '歌尔股份'], ['300124.SZ', '汇川技术'], ['000063.SZ', '中兴通讯']] },
            { title: '消费与制造', symbols: [['000858.SZ', '五粮液'], ['000333.SZ', '美的集团'], ['000651.SZ', '格力电器'], ['600276.SS', '恒瑞医药'], ['300760.SZ', '迈瑞医疗'], ['601857.SS', '中国石油']] },
        ],
        news: 'stock',
    },
    {
        id: 'hk', name: '港股', short: '港股', timeZone: 'Asia/Hong_Kong', hours: { open: hm(9, 30), close: hm(16) }, feed: 'Live', native: true,
        pulse: [
            { symbol: '02800.HK', label: '盈富基金（恒生指数 ETF）', finnhub: '02800.HK' },
            { symbol: '03033.HK', label: '南方恒生科技 ETF', finnhub: '03033.HK' },
            { symbol: '00700.HK', label: '腾讯控股', finnhub: '00700.HK' },
            { symbol: '09988.HK', label: '阿里巴巴', finnhub: '09988.HK' },
        ],
        groups: [
            { title: '科技互联网', symbols: [['00700.HK', '腾讯控股'], ['09988.HK', '阿里巴巴'], ['03690.HK', '美团'], ['01810.HK', '小米集团'], ['09888.HK', '百度集团'], ['09618.HK', '京东集团']] },
            { title: '金融与综合', symbols: [['00005.HK', '汇丰控股'], ['01299.HK', '友邦保险'], ['00388.HK', '香港交易所'], ['00939.HK', '建设银行'], ['01398.HK', '工商银行'], ['02318.HK', '中国平安']] },
            { title: '蓝筹与汽车', symbols: [['01211.HK', '比亚迪股份'], ['02015.HK', '理想汽车'], ['00941.HK', '中国移动'], ['00883.HK', '中国海洋石油'], ['00027.HK', '银河娱乐'], ['00016.HK', '新鸿基地产']] },
        ],
        news: 'stock',
    },
    {
        id: 'tw', name: '台股', short: '台股', timeZone: 'Asia/Taipei', hours: { open: hm(9), close: hm(13, 30) }, feed: 'Live', native: true,
        pulse: [
            { symbol: '0050.TW', label: '元大台湾50', finnhub: '0050.TW' },
            { symbol: '2330.TW', label: '台积电', finnhub: '2330.TW' },
            { symbol: '2317.TW', label: '鸿海', finnhub: '2317.TW' },
            { symbol: '2454.TW', label: '联发科', finnhub: '2454.TW' },
        ],
        groups: [
            { title: '半导体电子', symbols: [['2330.TW', '台积电'], ['2454.TW', '联发科'], ['2303.TW', '联电'], ['2379.TW', '瑞昱'], ['3034.TW', '联咏'], ['3711.TW', '日月光投控']] },
            { title: '电脑与代工', symbols: [['2317.TW', '鸿海'], ['2382.TW', '广达'], ['2308.TW', '台达电'], ['3231.TW', '纬创'], ['2357.TW', '华硕'], ['6669.TW', '纬颖']] },
            { title: '金融与航运', symbols: [['2881.TW', '富邦金'], ['2882.TW', '国泰金'], ['2891.TW', '中信金'], ['2886.TW', '兆丰金'], ['2603.TW', '长荣'], ['2609.TW', '阳明']] },
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
    const upper = symbol.trim().toUpperCase();
    if (upper.startsWith('BINANCE:')) return true;
    const meta = identifyMarketAndCode(upper);
    return !upper.includes(':') && meta.market === 'us' && !isInternationalSymbol(meta.normalizedSymbol);
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
        if (day === 6) return false;
        if (day === 0) return minutes >= hm(17);
        if (day === 5) return minutes < hm(17);
        return true;
    }
    return (market.tradingDays ?? [1, 2, 3, 4, 5]).includes(day) && minutes >= market.hours.open && minutes < market.hours.close;
}
