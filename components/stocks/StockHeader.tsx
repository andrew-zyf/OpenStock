import { Bell, CalendarClock, Gauge, Landmark, MoveVertical } from "lucide-react";
import WatchlistButton from "@/components/WatchlistButton";
import CreateAlertModal from "@/components/watchlist/CreateAlertModal";
import StockLivePrice from "@/components/stocks/StockLivePrice";
import { isStockInWatchlist } from "@/lib/actions/watchlist.actions";
import { getCompanyProfile, getLiveQuotes } from "@/lib/actions/finnhub.actions";
import { formatNumber, formatPrice, formatSymbolForTradingView, isChartEmbeddable } from "@/lib/utils";
import { hasFinnhubQuotes } from "@/lib/markets";
import { symbolInfoConfig } from "@/lib/constants";
import TradingViewWidget from "@/components/TradingViewWidget";
import ChangePill from "@/components/ChangePill";
import { getYahooDailyQuotes } from "@/lib/actions/yahoo.actions";

// Symbols Finnhub's free plan can't price (most non-US listings) use Yahoo Finance or TradingView.
// Exchanges whose free embeds are blocked by TradingView (HKEX, TWSE, Tadawul, etc.) use native Yahoo quotes to avoid "此商品仅适用于 Trading View".
async function TradingViewHeader({ symbol }: { symbol: string }) {
    const tvSymbol = formatSymbolForTradingView(symbol);
    const exchange = tvSymbol.split(':')[0];
    const isEmbedBlocked = !isChartEmbeddable(tvSymbol);

    const [isInWatchlist, yahoo] = await Promise.all([
        isStockInWatchlist(symbol),
        getYahooDailyQuotes([symbol]),
    ]);
    const quote = yahoo?.[symbol];
    const company = quote?.name || symbol;
    const currency = quote?.currency || 'USD';
    const money = (value?: number) => (value != null && Number.isFinite(value) ? formatPrice(value, currency) : '—');

    const stats = [
        { label: '今开', icon: CalendarClock, value: money(quote?.open), hint: '今日开盘价' },
        { label: '日内区间', icon: MoveVertical, value: quote?.dayLow && quote?.dayHigh ? `${money(quote.dayLow)} – ${money(quote.dayHigh)}` : '—', hint: '最低至最高' },
        { label: '昨收', icon: Gauge, value: money(quote?.prevClose), hint: '上一交易日收盘价' },
        { label: '52周区间', icon: Landmark, value: quote?.fiftyTwoWeekLow && quote?.fiftyTwoWeekHigh ? `${money(quote.fiftyTwoWeekLow)} – ${money(quote.fiftyTwoWeekHigh)}` : '—', hint: '52周最低与最高' },
    ];

    return (
        <section className="hatch">
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-4 p-4">
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                    <span className="logo-well is-empty size-11">{symbol[0]}</span>
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold tracking-[-0.03em]">{company}</h1>
                        <p className="mono truncate text-[12.5px] text-faint">
                            {[symbol, exchange, quote ? '行情源自 Yahoo Finance' : '行情源自 TradingView'].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                </div>

                {quote ? (
                    <div className="flex items-center gap-3">
                        <p className="num text-2xl font-bold tracking-[-0.03em]">{formatPrice(quote.price, currency)}</p>
                        <ChangePill value={quote.changePercent} />
                    </div>
                ) : null}

                <div className="flex items-center gap-2">
                    <WatchlistButton symbol={symbol} company={company} isInWatchlist={isInWatchlist} />
                    <span className="pill h-9 px-3" title="价格预警功能需支持高频轮询的行情数据源">
                        <Bell /> 预警支持美股与加密货币
                    </span>
                </div>
            </div>

            {quote ? (
                <div className="card mt-[3px] grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                    {stats.map(({ label, icon: Icon, value, hint }) => (
                        <div key={label} className="flex flex-col gap-1 rounded-[10px] bg-page/50 p-2.5" title={hint}>
                            <span className="flex items-center gap-1.5 text-[12px] text-faint">
                                <Icon className="size-3.5 text-muted-foreground" /> {label}
                            </span>
                            <span className="num truncate text-[15px] font-semibold text-foreground">{value}</span>
                        </div>
                    ))}
                </div>
            ) : !isEmbedBlocked ? (
                <div className="card mt-[3px] p-1">
                    <TradingViewWidget scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js" config={symbolInfoConfig(tvSymbol)} height={180} />
                </div>
            ) : null}
        </section>
    );
}

export default async function StockHeader({ symbol }: { symbol: string }) {
    if (!hasFinnhubQuotes(symbol)) return <TradingViewHeader symbol={symbol} />;

    const [isInWatchlist, quotes, profile] = await Promise.all([
        isStockInWatchlist(symbol),
        getLiveQuotes([symbol]),
        getCompanyProfile(symbol),
    ]);
    const quote = quotes[symbol];

    const currency = profile?.currency || 'USD';
    const company = profile?.name || symbol;
    const money = (value?: number) => (value ? formatPrice(value, currency) : '—');

    const stats = [
        { label: '今开', icon: CalendarClock, value: money(quote?.o), hint: '今日开盘价' },
        { label: '日内区间', icon: MoveVertical, value: quote?.l && quote?.h ? `${money(quote.l)} – ${money(quote.h)}` : '—', hint: '最低至最高' },
        { label: '昨收', icon: Gauge, value: money(quote?.pc), hint: '上一交易日收盘价' },
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
