import { Suspense } from "react";
import { cookies } from "next/headers";
import Panel from "@/components/Panel";
import IndexPulse, { PulseSkeleton } from "@/components/IndexPulse";
import DataFreshness from "@/components/DataFreshness";
import MarketSwitcher from "@/components/MarketSwitcher";
import CrossMarketBar from "@/components/CrossMarketBar";
import ChinaMarketMacroBar from "@/components/ChinaMarketMacroBar";
import ChineseNewsFlash from "@/components/ChineseNewsFlash";
import { NativeMarketQuotesTable, NativeMarketMovers } from "@/components/NativeMarketQuotes";
import { MARKETS, MARKET_COOKIE, getMarket, isMarketOpen, marketForCountry } from "@/lib/markets";
import { getSession } from "@/lib/better-auth/auth";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
    const { market: requested } = await searchParams;
    const saved = (await cookies()).get(MARKET_COOKIE)?.value;
    const market = getMarket(requested ?? saved ?? marketForCountry((await getSession())?.user.country));
    const open = isMarketOpen(market);

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">市场概览</h1>
                    <p className="page-sub">
                        {market.name} · {open ? '开市交易中' : '已休市'} · 毫秒级原生实时行情
                    </p>
                </div>
            </header>

            {/* 市场切换 (美股 · A股 · 港股 · 台股) */}
            <MarketSwitcher active={market.id} openIds={MARKETS.filter((m) => isMarketOpen(m)).map((m) => m.id)} />

            {/* 雪球式四地市场核心联动速览 (点击直达各市场或本地详情) */}
            <Suspense fallback={null}>
                <CrossMarketBar activeMarketId={market.id} />
            </Suspense>

            {/* 大中华市场宏观风向标 (两市成交额、汇率与四地监控) */}
            {(market.id === 'cn' || market.id === 'hk' || market.id === 'tw') && (
                <Suspense fallback={null}>
                    <ChinaMarketMacroBar />
                </Suspense>
            )}

            {/* 核心指数行情 */}
            <section className="hatch">
                <div className="section-head">
                    <div>
                        <h2 className="section-title">核心指数</h2>
                        <p className="section-sub">原生 Level-1 直连实时行情 (15秒自动刷新 · 点击查看本地分时)</p>
                    </div>
                    <DataFreshness />
                </div>
                <Suspense key={market.id} fallback={<PulseSkeleton />}>
                    <IndexPulse market={market} />
                </Suspense>
            </section>

            {/* 核心资产与异动排行 (雪球式布局，全本地原生渲染，点击即看分时) */}
            <div key={market.id} className="flex flex-col gap-3">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <Panel title="异动领跑" sub={`${market.name}今日核心资产振幅排行 (点击进详情)`}>
                        <NativeMarketMovers market={market} />
                    </Panel>
                    <Panel title="精选报价" sub={`${market.name}核心蓝筹龙头报价 (点击进详情)`}>
                        <NativeMarketQuotesTable market={market} />
                    </Panel>
                </div>

                <div className="grid gap-3">
                    <ChineseNewsFlash />
                </div>
            </div>
        </>
    );
}
