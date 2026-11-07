import { Suspense } from "react";
import StockHeader, { StockHeaderSkeleton } from "@/components/stocks/StockHeader";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import YahooStockChart from "@/components/stocks/YahooStockChart";
import OrderBookCard from "@/components/stocks/OrderBookCard";
import CapitalFlowCard from "@/components/stocks/CapitalFlowCard";
import NativeFinancials from "@/components/stocks/NativeFinancials";
import NativeCompanyProfile from "@/components/stocks/NativeCompanyProfile";
import TradingViewWidget from "@/components/TradingViewWidget";
import Panel from "@/components/Panel";
import {
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import { getStockMetrics } from '@/lib/actions/finnhub.actions';
import { formatSymbolForTradingView, isChartEmbeddable } from '@/lib/utils';
import { identifyMarketAndCode } from "@/lib/realtime-market";

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

async function Sentiment({ symbol }: { symbol: string }) {
    const insight = await getStockSentimentInsights(symbol);
    if (!insight) return null;
    return (
        <Panel title="市场情绪" sub="综合 Reddit、X、新闻与预测市场">
            <StockSentimentCard insight={insight} />
        </Panel>
    );
}

async function DividendYield({ symbol }: { symbol: string }) {
    const dividendYield = await getStockMetrics(symbol);
    return (
        <Panel title="股息率 (Dividend Yield)">
            <p className="text-2xl font-semibold text-white">
                {dividendYield !== null ? `${dividendYield.toFixed(2)}%` : "—"}
            </p>
        </Panel>
    );
}

export default async function StockDetails({ params }: StockDetailsPageProps) {
    const { symbol: rawSymbol } = await params;
    const symbol = decodeURIComponent(rawSymbol).toUpperCase();
    const tvSymbol = formatSymbolForTradingView(symbol);
    const meta = identifyMarketAndCode(symbol);
    const isChineseMarket = meta.market === 'cn' || meta.market === 'hk' || meta.market === 'tw';

    return (
        <>
            <Suspense fallback={<StockHeaderSkeleton />}>
                <StockHeader symbol={symbol} />
            </Suspense>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                {/* 左侧主视窗：走势主图与财务指标 */}
                <div className="flex min-w-0 flex-col gap-3">
                    <YahooStockChart symbol={symbol} tvSymbol={tvSymbol} />

                    {isChineseMarket ? (
                        <Suspense fallback={null}>
                            <NativeFinancials symbol={symbol} />
                        </Suspense>
                    ) : (
                        <Panel title="财务数据" sub="利润表、资产负债表与核心财务比率">
                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}financials.js`}
                                config={COMPANY_FINANCIALS_WIDGET_CONFIG(tvSymbol)}
                                height={500}
                            />
                        </Panel>
                    )}
                </div>

                {/* 右侧边栏：五档买卖盘口+逐笔明细、主力资金流向、情绪与公司档案 */}
                <div className="flex min-w-0 flex-col gap-3">
                    {isChineseMarket ? (
                        <>
                            <OrderBookCard symbol={symbol} />
                            <CapitalFlowCard symbol={symbol} />
                        </>
                    ) : (
                        <>
                            <Panel title="技术分析" sub="震荡指标与移动均线 (1小时周期)">
                                <TradingViewWidget
                                    scriptUrl={`${scriptUrl}technical-analysis.js`}
                                    config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                                    height={400}
                                />
                            </Panel>
                            <Suspense fallback={null}>
                                <DividendYield symbol={symbol} />
                            </Suspense>
                        </>
                    )}

                    <Suspense fallback={null}>
                        <Sentiment symbol={symbol} />
                    </Suspense>

                    {/* 公司概况：A股、港股、台股彻底使用原生真实档案替换 TradingView */}
                    {isChineseMarket ? (
                        <Suspense fallback={null}>
                            <NativeCompanyProfile symbol={symbol} />
                        </Suspense>
                    ) : (
                        <Panel title="公司概况" sub="主营业务与基本资料">
                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}symbol-profile.js`}
                                config={COMPANY_PROFILE_WIDGET_CONFIG(tvSymbol)}
                                height={440}
                            />
                        </Panel>
                    )}
                </div>
            </div>
        </>
    );
}
