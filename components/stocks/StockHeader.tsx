import { Bell, Gauge, Landmark } from "lucide-react";
import WatchlistButton from "@/components/WatchlistButton";
import CreateAlertModal from "@/components/watchlist/CreateAlertModal";
import StockLivePrice, { StockQuoteProvider } from "@/components/stocks/StockLivePrice";
import StockQuoteStats from "@/components/stocks/StockQuoteStats";
import { isStockInWatchlist } from "@/lib/actions/watchlist.actions";
import { getCompanyProfile, getLiveQuotes } from "@/lib/actions/finnhub.actions";
import { formatNumber } from "@/lib/utils";
import { hasFinnhubQuotes } from "@/lib/markets";
import { alertsEnabled } from '@/lib/market-data';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import { identifyMarketAndCode } from '@/lib/market/instrument';

// Non-US symbols or TradingView-restricted exchanges (A股, 港股, 台股等) use direct real-time data sources
async function RealtimeMarketHeader({ symbol }: { symbol: string }) {
    const [isInWatchlist, quotes] = await Promise.all([
        isStockInWatchlist(symbol),
        getLiveQuotes([symbol]),
    ]);
    const rt = quotes[symbol];
    const company = rt?.name || symbol;
    const meta = identifyMarketAndCode(symbol);
    const currency = rt?.currency || meta.currency;
    const canAlert = alertsEnabled && getInstrumentCapabilities(symbol).alerts;
    const formatAmount = (amt?: number) => amt == null ? '—' : `${amt === 0 ? '0' : formatNumber(amt)} ${currency}`;

    // Company/valuation references are separate from the live quote observation.
    const referenceStats = [
        { label: '总市值', icon: Landmark, value: rt?.marketCap != null ? formatAmount(rt.marketCap) : '—', hint: `计价货币: ${currency}` },
        {
            label: '市盈(PE) / 市净(PB)',
            icon: Gauge,
            value: `${rt?.pe != null ? rt.pe.toFixed(1) : '—'} / ${rt?.pb != null ? rt.pb.toFixed(2) : '—'}`,
            hint: '动态市盈率 PE-TTM 与市净率 PB',
        },
    ];

    return (
        <StockQuoteProvider symbol={symbol} initial={rt} currency={currency}>
        <section className="hatch">
            <div className="card flex flex-wrap items-center gap-x-6 gap-y-4 p-4">
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                    <span className="logo-well is-empty size-11">{symbol[0]}</span>
                    <div className="min-w-0">
                        <h1 className="truncate text-xl font-bold tracking-[-0.03em]">{company}</h1>
                        <p className="mono truncate text-[12.5px] text-faint">
                            {[symbol, rt?.exchange].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                </div>

                <StockLivePrice />

                <div className="flex items-center gap-2">
                    <WatchlistButton symbol={symbol} company={company} isInWatchlist={isInWatchlist} />
                    {canAlert && <CreateAlertModal symbol={symbol} currentPrice={rt?.price} currency={currency}>
                        <button type="button" className="btn btn-primary"><Bell /> 设置预警</button>
                    </CreateAlertModal>}
                </div>
            </div>

            <StockQuoteStats symbol={symbol} layout="native">
                {referenceStats.map(({ label, icon: Icon, value, hint }) => (
                    <div key={label} className="flex flex-col gap-1 rounded-[10px] bg-page/50 p-2.5" title={hint}>
                        <span className="flex items-center gap-1.5 text-[12px] text-faint">
                            <Icon className="size-3.5 text-muted-foreground" /> {label}
                        </span>
                        <span className={`num truncate text-[15px] font-semibold ${value === '—' ? 'text-faint' : 'text-foreground'}`}>{value}</span>
                        <span className="text-[12px] text-faint">独立参考 · 加载时资料</span>
                    </div>
                ))}
            </StockQuoteStats>
        </section>
        </StockQuoteProvider>
    );
}

export default async function StockHeader({ symbol }: { symbol: string }) {
    if (!hasFinnhubQuotes(symbol)) return <RealtimeMarketHeader symbol={symbol} />;

    const meta = identifyMarketAndCode(symbol);
    const canAlert = alertsEnabled && getInstrumentCapabilities(symbol).alerts;
    const [isInWatchlist, quotes, profile] = await Promise.all([
        isStockInWatchlist(symbol),
        getLiveQuotes([symbol]),
        meta.kind === 'equity' ? getCompanyProfile(symbol) : Promise.resolve(null),
    ]);
    const quote = quotes[symbol];

    const currency = profile?.currency || 'USD';
    const company = profile?.name || symbol;
    return (
        <StockQuoteProvider symbol={symbol} initial={quote} currency={currency}>
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

                <StockLivePrice />

                <div className="flex items-center gap-2">
                    <WatchlistButton symbol={symbol} company={company} isInWatchlist={isInWatchlist} />
                    {canAlert && <CreateAlertModal symbol={symbol} currentPrice={quote?.c} currency={currency}>
                        <button type="button" className="btn btn-primary"><Bell /> 设置预警</button>
                    </CreateAlertModal>}
                </div>
            </div>

            <StockQuoteStats symbol={symbol} layout="us">
                <div className="bento-tile gap-2.5">
                    <div className="bento-head"><span className="bento-ico"><Landmark /></span>总市值</div>
                    <p className="num truncate text-[17px] font-bold tracking-[-0.02em]">{profile?.marketCapitalization != null ? `${profile.marketCapitalization === 0 ? '0' : formatNumber(profile.marketCapitalization)} ${currency}` : '—'}</p>
                    <p className="text-[12px] text-faint">公司资料独立参考 · 加载时资料（{currency}）</p>
                </div>
            </StockQuoteStats>
        </section>
        </StockQuoteProvider>
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
