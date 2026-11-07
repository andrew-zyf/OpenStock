import { Suspense } from "react";
import { cookies } from "next/headers";
import IndexPulse, { PulseSkeleton } from "@/components/IndexPulse";
import DataFreshness from "@/components/DataFreshness";
import MarketSwitcher from "@/components/MarketSwitcher";
import CrossMarketBar from "@/components/CrossMarketBar";
import ChinaMarketMacroBar from "@/components/ChinaMarketMacroBar";
import SectorFlowPanel from "@/components/SectorFlowPanel";
import ChineseNewsFlash from "@/components/ChineseNewsFlash";
import { NativeMarketPanels } from "@/components/NativeMarketQuotes";
import { getLiveQuotes } from '@/lib/actions/finnhub.actions';
import { getChinaSectorRankings } from '@/lib/actions/china-market.actions';
import { tvToAppSymbol } from '@/lib/utils';
import type { Market } from '@/lib/markets';
import { MARKETS, MARKET_COOKIE, getMarket, isMarketOpen, marketForCountry } from "@/lib/markets";
import { getSession } from "@/lib/better-auth/auth";

async function MarketQuotes({ market }: { market: Market }) {
    const symbols = [...new Set(market.groups.flatMap((group) => group.symbols.map(([symbol]) => tvToAppSymbol(symbol))))];
    const initialData = await getLiveQuotes(symbols);
    return <NativeMarketPanels key={market.id} market={market} initialData={initialData} />;
}

async function SectorFlow({ selectedMarket }: { selectedMarket: string }) {
    const initialData = await getChinaSectorRankings();
    return <SectorFlowPanel initialData={initialData} selectedMarket={selectedMarket} />;
}

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
                        {market.name} · {open ? '常规交易时段' : '常规交易时段外'} · 行情时间以数据源为准
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
                        <p className="section-sub">指数快照 · 点击查看本地分时 · 源时间以各标的为准</p>
                    </div>
                    <DataFreshness />
                </div>
                <Suspense key={market.id} fallback={<PulseSkeleton />}>
                    <IndexPulse market={market} />
                </Suspense>
            </section>

            {/* 核心资产与异动排行 (雪球式布局，全本地原生渲染，点击即看分时) */}
            <div key={market.id} className="flex flex-col gap-3">
                {/* 行业板块风向标：领涨板块 vs 主力吸筹板块 */}
                {(market.id === 'cn' || market.id === 'hk' || market.id === 'tw') && (
                    <Suspense fallback={null}>
                        <SectorFlow selectedMarket={market.id} />
                    </Suspense>
                )}

                <Suspense key={market.id} fallback={<p className="text-xs text-faint">正在加载精选行情...</p>}>
                    <MarketQuotes market={market} />
                </Suspense>

                <div className="grid gap-3">
                    <ChineseNewsFlash />
                </div>
            </div>
        </>
    );
}
