'use client';

import { createContext, useContext, type ReactNode } from 'react';
import ChangePill from "@/components/ChangePill";
import DataFreshness from "@/components/DataFreshness";
import PriceFlash from "@/components/PriceFlash";
import { useLiveQuoteResource, type LiveQuote } from "@/hooks/useLiveQuotes";
import { formatPrice } from "@/lib/utils";

type StockQuoteState = { quote: LiveQuote | null | undefined; currency: string; stale: boolean; loading: boolean };
const StockQuoteContext = createContext<StockQuoteState | null>(null);

// One observation drives the price and every quote statistic in this header.
export function StockQuoteProvider({ symbol, initial, currency, children }: {
    symbol: string; initial: LiveQuote | null; currency: string; children: ReactNode;
}) {
    const resource = useLiveQuoteResource([symbol], undefined, initial ? { [symbol]: initial } : undefined);
    const quote = resource.data?.[symbol];
    return <StockQuoteContext.Provider value={{ quote, currency: quote?.currency || currency, stale: resource.stale, loading: resource.loading }}>
        {children}
    </StockQuoteContext.Provider>;
}

export function useStockQuote() {
    const state = useContext(StockQuoteContext);
    if (!state) throw new Error('Stock quote components require StockQuoteProvider');
    return state;
}

const StockLivePrice = () => {
    const { quote, currency, stale, loading } = useStockQuote();

    return (
        <div className="flex items-end gap-3">
            <PriceFlash value={quote?.c} className="bento-value px-1 text-[32px]">
                {quote?.c != null ? formatPrice(quote.c, currency) : '行情暂不可用'}
            </PriceFlash>
            <div className="flex flex-col items-start gap-1 pb-0.5">
                {quote?.priceBasis === 'previous-close' && <span className="text-[12px] text-faint">昨收参考价（暂无最新成交）</span>}
                <span className="flex items-center gap-2">
                    <ChangePill value={quote?.dp} />
                    <span className="num text-[12px] text-faint">
                        {quote?.d != null ? `${quote.d > 0 ? '+' : ''}${quote.d.toFixed(2)}` : '—'}
                    </span>
                </span>
                <DataFreshness tradeTime={quote?.t} asOf={quote?.asOf} source={quote?.source} fetchedAt={quote?.fetchedAt} stale={stale} loading={loading} />
            </div>
        </div>
    );
};

export default StockLivePrice;
