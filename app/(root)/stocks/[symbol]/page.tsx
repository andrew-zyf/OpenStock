import { Suspense } from "react";
import { CandlestickChart } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import StockHeader, { StockHeaderSkeleton } from "@/components/stocks/StockHeader";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import StockChart from "@/components/stocks/StockChart";
import YahooStockChart from "@/components/stocks/YahooStockChart";
import Panel from "@/components/Panel";
import {
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import { getStockMetrics } from '@/lib/actions/finnhub.actions';
import { formatSymbolForTradingView, isChartEmbeddable, tradingViewSymbolUrl } from '@/lib/utils';

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

// Charts come straight from TradingView (live, no quota); only the header waits on Finnhub, and it streams.
export default async function StockDetails({ params }: StockDetailsPageProps) {
    const { symbol: rawSymbol } = await params;
    const symbol = decodeURIComponent(rawSymbol).toUpperCase();
    const tvSymbol = formatSymbolForTradingView(symbol);

    return (
        <>
            <Suspense fallback={<StockHeaderSkeleton />}>
                <StockHeader symbol={symbol} />
            </Suspense>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                <div className="flex min-w-0 flex-col gap-3">
                    <YahooStockChart symbol={symbol} tvSymbol={tvSymbol} />
                    <Panel title="财务数据" sub="利润表、资产负债表与核心财务比率">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}financials.js`}
                            config={COMPANY_FINANCIALS_WIDGET_CONFIG(tvSymbol)}
                            height={500}
                        />
                    </Panel>
                </div>

                <div className="flex min-w-0 flex-col gap-3">
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
                    <Suspense fallback={null}>
                        <Sentiment symbol={symbol} />
                    </Suspense>
                    <Panel title="公司概况" sub="主营业务与基本资料">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}symbol-profile.js`}
                            config={COMPANY_PROFILE_WIDGET_CONFIG(tvSymbol)}
                            height={440}
                        />
                    </Panel>
                </div>
            </div>
        </>
    );
}
