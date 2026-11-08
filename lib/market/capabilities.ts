import { identifyMarketAndCode } from './instrument';
import { isInternationalSymbol } from '@/lib/utils';

export type InstrumentCapabilities = {
    profile: boolean;
    financials: boolean;
    alerts: boolean;
    depth: boolean;
    ticks: boolean;
    capitalFlow: boolean;
};

/** Backend coverage, not a guarantee that a particular upstream response has data. */
export function getInstrumentCapabilities(rawSymbol: string): InstrumentCapabilities {
    const meta = identifyMarketAndCode(rawSymbol);
    const supported = meta.exchangeId !== 'BSE' && meta.kind !== 'unknown';
    const equity = supported && meta.kind === 'equity';
    const traded = supported && (meta.kind === 'equity' || meta.kind === 'etf');
    const mainland = meta.exchangeId === 'SSE' || meta.exchangeId === 'SZSE';
    return {
        profile: equity && (mainland || meta.market === 'hk' || meta.exchangeId === 'TWSE'),
        financials: equity && (mainland || meta.market === 'hk' || meta.exchangeId === 'TWSE'),
        alerts: traded && (mainland || meta.market === 'hk' || meta.market === 'tw'
            || (meta.market === 'us' && !isInternationalSymbol(meta.normalizedSymbol))),
        depth: traded && (mainland || meta.market === 'tw'),
        ticks: traded && (mainland || meta.market === 'tw' || meta.market === 'hk'),
        capitalFlow: traded && (mainland || meta.market === 'hk'),
    };
}
