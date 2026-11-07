// Community links, used across the app, landing page and emails
export const REPO_URL = 'https://github.com/Open-Dev-Society/OpenStock';
// GitHub account that receives sponsorships. Switch to 'Open-Dev-Society' once the org's
// GitHub Sponsors listing is live (github.com/sponsors/Open-Dev-Society); every link follows.
export const SPONSOR_GITHUB_ACCOUNT = 'ravixalgorithm';
export const SPONSOR_URL = `https://github.com/sponsors/${SPONSOR_GITHUB_ACCOUNT}`;
// Opens GitHub's checkout with the amount and frequency already picked
export const sponsorCheckoutUrl = (amount?: number, frequency: 'recurring' | 'one-time' = 'recurring') =>
    `${SPONSOR_URL}/sponsorships?frequency=${frequency}${amount ? `&amount=${amount}` : ''}`;
export const DISCORD_URL = 'https://discord.gg/JkJ8kfxgxB';
export const GOOD_FIRST_ISSUES_URL = `${REPO_URL}/issues?q=is%3Aopen+label%3A%22good+first+issue%22`;

// Sign-up form select options
export const INVESTMENT_GOALS = [
    { value: 'Growth', label: '成长型 (Growth)' },
    { value: 'Income', label: '稳健分红 (Income)' },
    { value: 'Balanced', label: '平衡型 (Balanced)' },
    { value: 'Conservative', label: '保守型 (Conservative)' },
];

export const RISK_TOLERANCE_OPTIONS = [
    { value: 'Low', label: '低风险' },
    { value: 'Medium', label: '中等风险' },
    { value: 'High', label: '高风险' },
];

export const PREFERRED_INDUSTRIES = [
    { value: 'Technology', label: '科技' },
    { value: 'Healthcare', label: '医疗健康' },
    { value: 'Finance', label: '金融' },
    { value: 'Energy', label: '能源' },
    { value: 'Consumer Goods', label: '消费品' },
];

export const ALERT_TYPE_OPTIONS = [
    { value: 'upper', label: '上限 (高于)' },
    { value: 'lower', label: '下限 (低于)' },
];

export const CONDITION_OPTIONS = [
    { value: 'greater', label: '高于 (>)' },
    { value: 'less', label: '低于 (<)' },
];

// TradingView widgets, built per market from lib/markets.ts groups
type SymbolGroup = { title: string; symbols: [symbol: string, name: string][] };

export const marketOverviewConfig = (groups: SymbolGroup[]) => ({
    colorTheme: 'dark',
    dateRange: '12M',
    locale: 'zh_CN',
    largeChartUrl: '',
    isTransparent: true,
    showFloatingTooltip: true,
    plotLineColorGrowing: '#47d9bb', // brand teal (oklch 0.80 0.13 176)
    plotLineColorFalling: '#47d9bb',
    gridLineColor: 'rgba(240, 243, 250, 0)',
    scaleFontColor: '#adaba3', // --muted
    belowLineFillColorGrowing: 'rgba(71, 217, 187, 0.12)',
    belowLineFillColorFalling: 'rgba(71, 217, 187, 0.12)',
    belowLineFillColorGrowingBottom: 'rgba(71, 217, 187, 0)',
    belowLineFillColorFallingBottom: 'rgba(71, 217, 187, 0)',
    symbolActiveColor: 'rgba(71, 217, 187, 0.08)',
    tabs: groups.map(({ title, symbols }) => ({ title, symbols: symbols.map(([s, d]) => ({ s, d })) })),
    support_host: 'https://www.tradingview.com',
    showSymbolLogo: true,
    showChart: true,
});

export const marketQuotesConfig = (groups: SymbolGroup[]) => ({
    locale: 'zh_CN',
    showSymbolLogo: true,
    colorTheme: 'dark',
    isTransparent: true,
    symbolsGroups: groups.map(({ title, symbols }) => ({ name: title, symbols: symbols.map(([name, displayName]) => ({ name, displayName })) })),
});

export const STOCK_HEATMAP_CONFIG = {
    dataSource: 'SPX500',
    blockSize: 'market_cap_basic',
    blockColor: 'change',
    grouping: 'sector',
    isTransparent: true,
    locale: 'zh_CN',
    symbolUrl: '',
    colorTheme: 'dark',
    exchanges: [],
    hasTopBar: false,
    isDataSetEnabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
};

export const CRYPTO_HEATMAP_CONFIG = {
    dataSource: 'Crypto',
    blockSize: 'market_cap_calc',
    blockColor: 'change',
    locale: 'zh_CN',
    symbolUrl: '',
    colorTheme: 'dark',
    hasTopBar: false,
    isDataSetEnabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    isTransparent: true,
};

export const timelineConfig = (market: 'stock' | 'crypto' | 'forex') => ({
    displayMode: 'regular',
    feedMode: 'market',
    colorTheme: 'dark',
    isTransparent: true,
    locale: 'zh_CN',
    market,
});

export const symbolInfoConfig = (symbol: string) => ({
    symbol,
    colorTheme: 'dark',
    isTransparent: true,
    locale: 'zh_CN',
    width: '100%',
});

export const singleQuoteConfig = (symbol: string) => ({
    symbol,
    colorTheme: 'dark',
    isTransparent: true,
    locale: 'zh_CN',
});

export const CANDLE_CHART_WIDGET_CONFIG = (symbol: string) => ({
    allow_symbol_change: false,
    calendar: false,
    details: true,
    hide_side_toolbar: false, // drawing tools (trend lines, Fibonacci, text); drawings last until reload
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    hotlist: false,
    interval: 'D',
    locale: 'zh_CN',
    save_image: false,
    style: 1,
    symbol: symbol.toUpperCase(),
    theme: 'dark',
    timezone: 'exchange',
    backgroundColor: '#1f1e1a', // --card
    gridColor: 'rgba(255, 255, 255, 0.04)',
    watchlist: [],
    withdateranges: false,
    compareSymbols: [],
    studies: [],
    width: '100%',
    height: 600,
});

export const TECHNICAL_ANALYSIS_WIDGET_CONFIG = (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    colorTheme: 'dark',
    isTransparent: true,
    locale: 'zh_CN',
    width: '100%',
    height: 400,
    interval: '1h',
    largeChartUrl: '',
});

// embed-widget-company-profile.js was retired by TradingView (403); symbol-profile.js takes the same config
export const COMPANY_PROFILE_WIDGET_CONFIG = (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    colorTheme: 'dark',
    isTransparent: true,
    locale: 'zh_CN',
    width: '100%',
    height: 440,
});

export const COMPANY_FINANCIALS_WIDGET_CONFIG = (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    colorTheme: 'dark',
    isTransparent: true,
    locale: 'zh_CN',
    width: '100%',
    height: 464,
    displayMode: 'regular',
    largeChartUrl: '',
});

// Default list in the search palette (static on purpose, see searchStocks)
export const POPULAR_STOCKS = [
    { symbol: '600519.SS', name: '贵州茅台 (Kweichow Moutai)', exchange: '上海证券交易所' },
    { symbol: '300750.SZ', name: '宁德时代 (CATL)', exchange: '深圳证券交易所' },
    { symbol: '0700.HK', name: '腾讯控股 (Tencent)', exchange: '香港交易所' },
    { symbol: '9988.HK', name: '阿里巴巴 (Alibaba)', exchange: '香港交易所' },
    { symbol: '2330.TW', name: '台积电 (TSMC)', exchange: '台湾证券交易所' },
    { symbol: 'NVDA', name: '英伟达 (NVIDIA Corp)', exchange: 'NASDAQ' },
    { symbol: 'AAPL', name: '苹果 (Apple Inc)', exchange: 'NASDAQ' },
    { symbol: 'TSLA', name: '特斯拉 (Tesla Inc)', exchange: 'NASDAQ' },
    { symbol: 'MSFT', name: '微软 (Microsoft Corp)', exchange: 'NASDAQ' },
    { symbol: 'AMZN', name: '亚马逊 (Amazon.com Inc)', exchange: 'NASDAQ' },
];

export const NO_MARKET_NEWS =
    '<p class="mobile-text" style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#4b5563;">今日暂无市场资讯，请稍后再试。</p>';

export const WATCHLIST_TABLE_HEADER = [
    '公司',
    '代码',
    '最新价',
    '涨跌幅',
    '市值',
    '市盈率',
    '预警',
    '操作',
];

export const PASSWORD_RULES = [
    { label: '至少 8 个字符', test: (pw: string) => pw.length >= 8 },
    { label: '包含至少 1 个大写字母', test: (pw: string) => /[A-Z]/.test(pw) },
    { label: '包含至少 1 个小写字母', test: (pw: string) => /[a-z]/.test(pw) },
    { label: '包含至少 1 个数字', test: (pw: string) => /[0-9]/.test(pw) },
] as const;

export const PASSWORD_VALIDATION = {
    required: '密码不能为空',
    minLength: { value: 8, message: '密码长度至少为 8 位' },
    pattern: {
        value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
        message: '密码必须包含大写字母、小写字母和数字',
    },
};
