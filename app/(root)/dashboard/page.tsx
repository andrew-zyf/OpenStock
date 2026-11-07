import { Suspense } from "react";
import { cookies } from "next/headers";
import TradingViewWidget from "@/components/TradingViewWidget";
import Panel from "@/components/Panel";
import IndexPulse, { PulseSkeleton } from "@/components/IndexPulse";
import DataFreshness from "@/components/DataFreshness";
import MarketSwitcher from "@/components/MarketSwitcher";
import SaudiQuotesTable, { SaudiMovers } from "@/components/SaudiQuotes";
import ChinaMarketMacroBar from "@/components/ChinaMarketMacroBar";
import ChineseNewsFlash from "@/components/ChineseNewsFlash";
import {
    CRYPTO_HEATMAP_CONFIG,
    STOCK_HEATMAP_CONFIG,
    marketOverviewConfig,
    marketQuotesConfig,
    timelineConfig,
} from "@/lib/constants";
import { MARKETS, MARKET_COOKIE, getMarket, isMarketOpen, marketForCountry } from "@/lib/markets";
import { getSession } from "@/lib/better-auth/auth";

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

// Widgets come from TradingView (live, no Finnhub quota) and render immediately; the tiles stream in.
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
    const { market: requested } = await searchParams;
    // Explicit choice, then the remembered one, then the market of the user's country
    const saved = (await cookies()).get(MARKET_COOKIE)?.value;
    const market = getMarket(requested ?? saved ?? marketForCountry((await getSession())?.user.country));
    const open = isMarketOpen(market);
    const native = market.pulse.some((p) => p.finnhub);
    const feedText = market.feed === 'Live' ? '实时' : market.feed === 'Delayed' ? '延时' : '盘后';
    const pulseSub = native ? '基于 Finnhub 共享实时行情' : market.yahoo ? '基于 Yahoo Finance 延时行情' : `${feedText}行情 (源自 TradingView)`;
    const heatmap = market.heatmap === 'stocks'
        ? { script: 'stock-heatmap.js', config: STOCK_HEATMAP_CONFIG, title: '标普 500 热力图' }
        : market.heatmap === 'crypto'
            ? { script: 'crypto-coins-heatmap.js', config: CRYPTO_HEATMAP_CONFIG, title: '加密货币热力图' }
            : null;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">市场概览</h1>
                    <p className="page-sub">{market.name} · {open ? '开市交易中' : '已休市'} · {feedText}数据</p>
                </div>
            </header>

            <MarketSwitcher active={market.id} openIds={MARKETS.filter((m) => isMarketOpen(m)).map((m) => m.id)} />

            {market.id === 'cn' && (
                <Suspense fallback={null}>
                    <ChinaMarketMacroBar />
                </Suspense>
            )}

            <section className="hatch">
                <div className="section-head">
                    <div>
                        <h2 className="section-title">核心指数</h2>
                        <p className="section-sub">{pulseSub}</p>
                    </div>
                    {native && <DataFreshness />}
                </div>
                {/* Keyed so switching markets swaps the tiles instead of reusing old widgets */}
                <Suspense key={market.id} fallback={<PulseSkeleton />}>
                    <IndexPulse market={market} />
                </Suspense>
            </section>

            <div key={market.id} className="flex flex-col gap-3">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    {market.yahoo ? (
                        <Panel title="异动领跑" sub="今日最大涨跌幅">
                            <SaudiMovers market={market} />
                        </Panel>
                    ) : (
                        <Panel title="热门走势" sub="板块 12 个月趋势">
                            <TradingViewWidget scriptUrl={`${scriptUrl}market-overview.js`} config={marketOverviewConfig(market.groups)} height={560} />
                        </Panel>
                    )}
                    {heatmap ? (
                        <Panel title={heatmap.title} sub="方块大小代表市值，颜色代表今日涨跌">
                            <TradingViewWidget scriptUrl={`${scriptUrl}${heatmap.script}`} config={heatmap.config} height={560} allowExpand />
                        </Panel>
                    ) : (
                        <Panel title="精选报价" sub={`${market.name} 各行业核心资产`}>
                            {market.yahoo
                                ? <SaudiQuotesTable market={market} />
                                : <TradingViewWidget scriptUrl={`${scriptUrl}market-quotes.js`} config={marketQuotesConfig(market.groups)} height={560} />}
                        </Panel>
                    )}
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    {heatmap && (
                        <Panel title="精选报价" sub={`${market.name} 各行业核心资产`}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}market-quotes.js`} config={marketQuotesConfig(market.groups)} height={560} />
                        </Panel>
                    )}
                    {market.id === 'cn' || market.id === 'hk' || market.id === 'tw' ? (
                        <div className={heatmap ? '' : 'xl:col-span-2'}>
                            <ChineseNewsFlash />
                        </div>
                    ) : (
                        <Panel title="市场要闻" sub="最新资讯" className={heatmap ? '' : 'xl:col-span-2'}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}timeline.js`} config={timelineConfig(market.news)} height={560} />
                        </Panel>
                    )}
                </div>
            </div>
        </>
    );
}
