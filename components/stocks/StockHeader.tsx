import { Bell, CalendarClock, Gauge, Landmark, MoveVertical } from "lucide-react";
import WatchlistButton from "@/components/WatchlistButton";
import CreateAlertModal from "@/components/watchlist/CreateAlertModal";
import StockLivePrice from "@/components/stocks/StockLivePrice";
import { isStockInWatchlist } from "@/lib/actions/watchlist.actions";
import { getCompanyProfile, getLiveQuotes } from "@/lib/actions/finnhub.actions";
import { formatNumber, formatPrice, formatSymbolForTradingView } from "@/lib/utils";
import { hasFinnhubQuotes } from "@/lib/markets";
import { getRealtimeQuote } from "@/lib/actions/realtime-market.actions";

// Non-US symbols or TradingView-restricted exchanges (A股, 港股, 台股等) use direct real-time data sources
async function RealtimeMarketHeader({ symbol }: { symbol: string }) {
    const [isInWatchlist, rt] = await Promise.all([
        isStockInWatchlist(symbol),
        getRealtimeQuote(symbol),
    ]);

    const company = rt?.name || symbol;
    const currency = rt?.currency || 'USD';
    const money = (value?: number) => (value != null && Number.isFinite(value) && value > 0 ? formatPrice(value, currency) : '—');

    const formatVolUnit = (vol?: number) => {
        if (!vol || vol <= 0) return '—';
        if (rt?.market === 'cn' || rt?.market === 'hk') {
            if (vol >= 1e8) return `${(vol / 1e8).toFixed(2)}亿手`;
            if (vol >= 1e4) return `${(vol / 1e4).toFixed(2)}万手`;
            return `${Math.round(vol).toLocaleString()}手`;
        }
        if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
        if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
        if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
        return Math.round(vol).toLocaleString();
    };

    const formatAmount = (amt?: number) => {
        if (!amt || amt <= 0) return '—';
        if (amt >= 1e8) return `${(amt / 1e8).toFixed(2)}亿元`;
        if (amt >= 1e4) return `${(amt / 1e4).toFixed(2)}万元`;
        return `${Math.round(amt).toLocaleString()}`;
    };

    const stats = [
        { label: '今开', icon: CalendarClock, value: money(rt?.open), hint: '今日开盘价' },
        { label: '昨收', icon: Gauge, value: money(rt?.prevClose), hint: '上一交易日收盘价' },
        { label: '最高', icon: MoveVertical, value: money(rt?.high), hint: '今日最高价', valueClass: 'text-up' },
        { label: '最低', icon: MoveVertical, value: money(rt?.low), hint: '今日最低价', valueClass: 'text-down' },
        { label: '成交量', icon: Landmark, value: formatVolUnit(rt?.volume), hint: '今日累计成交量' },
        { label: '成交额', icon: Landmark, value: formatAmount(rt?.turnover), hint: '今日累计成交金额' },
        { label: '换手率', icon: Gauge, value: rt?.turnoverRate ? `${rt.turnoverRate.toFixed(2)}%` : '—', hint: '筹码换手活跃度' },
        { label: '振幅', icon: MoveVertical, value: rt?.amplitude ? `${rt.amplitude.toFixed(2)}%` : '—', hint: '日内最高与最低波动幅度' },
        { label: '总市值', icon: Landmark, value: rt?.marketCap ? formatNumber(rt.marketCap) : '—', hint: `计价货币: ${currency}` },
        { label: '市盈率(TTM)', icon: Gauge, value: rt?.pe ? rt.pe.toFixed(2) : '—', hint: '动态市盈率 PE-TTM' },
    ];

    const sourceLabel = rt?.market === 'cn'
        ? 'A股实时行情 (毫秒级直连)'
        : rt?.market === 'hk'
            ? '港股实时行情 (官方合作源)'
            : rt?.market === 'tw'
                ? '台股实时行情 (台湾证交所官方)'
                : '实时行情数据源';

    return (
        <section className="hatch">
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-4 p-4">
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                    <span className="logo-well is-empty size-11">{symbol[0]}</span>
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold tracking-[-0.03em]">{company}</h1>
                        <p className="mono truncate text-[12.5px] text-faint">
                            {[symbol, rt?.exchange, sourceLabel].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                </div>

                {rt ? (
                    <StockLivePrice symbol={symbol} initial={rt} currency={currency} />
                ) : null}

                <div className="flex items-center gap-2">
                    <WatchlistButton symbol={symbol} company={company} isInWatchlist={isInWatchlist} />
                    <span className="pill h-9 px-3" title="价格预警功能需支持高频轮询的行情数据源">
                        <Bell /> 预警支持美股与加密货币
                    </span>
                </div>
            </div>

            <div className="card mt-[3px] grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
                {stats.map(({ label, icon: Icon, value, hint, valueClass }) => (
                    <div key={label} className="flex flex-col gap-1 rounded-[10px] bg-page/50 p-2.5" title={hint}>
                        <span className="flex items-center gap-1.5 text-[12px] text-faint">
                            <Icon className="size-3.5 text-muted-foreground" /> {label}
                        </span>
                        <span className={`num truncate text-[15px] font-semibold ${valueClass || 'text-foreground'}`}>{value}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

export default async function StockHeader({ symbol }: { symbol: string }) {
    if (!hasFinnhubQuotes(symbol)) return <RealtimeMarketHeader symbol={symbol} />;

    const [isInWatchlist, quotes, profile] = await Promise.all([
        isStockInWatchlist(symbol),
        getLiveQuotes([symbol]),
        getCompanyProfile(symbol),
    ]);
    const quote = quotes[symbol];

    const currency = profile?.currency || 'USD';
    const company = profile?.name || symbol;
    const money = (value?: number) => (value ? formatPrice(value, currency) : '—');

    const amp = quote?.h && quote?.l && quote?.pc ? ((quote.h - quote.l) / quote.pc) * 100 : 0;

    const stats = [
        { label: '今开', icon: CalendarClock, value: money(quote?.o), hint: '今日开盘价' },
        { label: '昨收', icon: Gauge, value: money(quote?.pc), hint: '上一交易日收盘价' },
        { label: '最高', icon: MoveVertical, value: money(quote?.h), hint: '今日最高价', valueClass: 'text-up' },
        { label: '最低', icon: MoveVertical, value: money(quote?.l), hint: '今日最低价', valueClass: 'text-down' },
        { label: '日内振幅', icon: MoveVertical, value: amp ? `${amp.toFixed(2)}%` : '—', hint: '最高与最低振幅' },
        { label: '总市值', icon: Landmark, value: profile?.marketCapitalization ? formatNumber(profile.marketCapitalization) : '—', hint: `计价货币: ${currency}` },
    ];

    return (
        <section className="hatch">
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-4 p-4">
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                    {profile?.logo ? (
                        <span className="logo-well size-11"><img src={profile.logo} alt="" className="size-full object-contain p-1.5" /></span>
                    ) : (
                        <span className="logo-well is-empty size-11">{symbol[0]}</span>
                    )}
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold tracking-[-0.03em]">{company}</h1>
                        <p className="mono truncate text-[12.5px] text-faint">
                            {[symbol, profile?.exchange, profile?.finnhubIndustry].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                </div>

                <StockLivePrice symbol={symbol} initial={quote} currency={currency} />

                <div className="flex items-center gap-2">
                    <WatchlistButton symbol={symbol} company={company} isInWatchlist={isInWatchlist} />
                    <CreateAlertModal symbol={symbol} currentPrice={quote?.c} currency={currency}>
                        <button type="button" className="btn btn-primary"><Bell /> 设置预警</button>
                    </CreateAlertModal>
                </div>
            </div>

            <div className="bento mt-[3px]">
                {stats.map(({ label, icon: Icon, value, hint }) => (
                    <div key={label} className="bento-tile gap-2.5">
                        <div className="bento-head"><span className="bento-ico"><Icon /></span>{label}</div>
                        <p className="num truncate text-[17px] font-bold tracking-[-0.02em]">{value}</p>
                        <p className="text-[12px] text-faint">{hint}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}

export function StockHeaderSkeleton() {
    return (
        <section className="hatch" aria-busy="true">
            <div className="card flex items-center gap-3 p-4">
                <span className="size-11 animate-pulse rounded-full bg-hover" />
                <span className="flex flex-col gap-2">
                    <span className="h-5 w-48 animate-pulse rounded-md bg-hover" />
                    <span className="h-3 w-32 animate-pulse rounded-md bg-hover" />
                </span>
                <span className="ml-auto h-8 w-36 animate-pulse rounded-md bg-hover" />
            </div>
            <div className="bento mt-[3px]">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="bento-tile h-[104px]"><span className="h-full animate-pulse rounded-lg bg-hover/60" /></div>
                ))}
            </div>
        </section>
    );
}
