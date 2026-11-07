export type MarketType = 'cn' | 'hk' | 'tw' | 'us';
export type InstrumentKind = 'index' | 'equity' | 'etf' | 'unknown';
export type ExchangeId = 'SSE' | 'SZSE' | 'BSE' | 'HKEX' | 'TWSE' | 'TPEX' | 'US';

export type InstrumentIdentity = {
    market: MarketType;
    normalizedSymbol: string;
    tencentCode?: string;
    twseCode?: string;
    currency: string;
    exchange: string;
    exchangeId: ExchangeId;
    kind: InstrumentKind;
};

const US_INDICES = new Set(['^GSPC', '^DJI', '^IXIC', '^NDX', '^RUT', '^VIX']);
const US_ETFS = new Set(['SPY', 'QQQ', 'DIA', 'IWM', 'VOO', 'VTI', 'IVV', 'ARKK', 'TLT', 'GLD']);
const HK_ETFS = new Set(['02800', '02828', '03033', '03067', '03188']);

/** Shared identity only: recognizing an exchange does not promise provider coverage. */
export function identifyMarketAndCode(rawSymbol: string): InstrumentIdentity {
    const s = rawSymbol.trim().toUpperCase();
    if (/\.(TW|TWO)$/.test(s) || /^(TWSE|TPEX):/.test(s) || s === '^TWII') {
        const code = s === '^TWII' ? 'TAIEX' : s.replace(/^(TWSE:|TPEX:)/, '').replace(/\.(TW|TWO)$/, '');
        const otc = s.endsWith('.TWO') || s.startsWith('TPEX:');
        const index = ['TAIEX', 'T00', 'OTC', 'O00'].includes(code);
        return {
            market: 'tw', normalizedSymbol: `${code}.${otc ? 'TWO' : 'TW'}`,
            twseCode: index ? (otc ? 'otc_o00.tw' : 'tse_t00.tw') : `${otc ? 'otc' : 'tse'}_${code}.${otc ? 'two' : 'tw'}`,
            currency: 'TWD', exchange: otc ? '台湾柜买中心' : '台湾证券交易所',
            exchangeId: otc ? 'TPEX' : 'TWSE', kind: index ? 'index' : /^00\d/.test(code) ? 'etf' : /^\d{4,6}$/.test(code) ? 'equity' : 'unknown',
        };
    }
    if (/\.HK$/.test(s) || s.startsWith('HKEX:') || /^\d{3,5}$/.test(s)) {
        const code = s.replace(/^HKEX:/, '').replace(/\.HK$/, '');
        const index = ['HSI', 'HSCEI', 'HSTECH'].includes(code);
        const padded = /^\d+$/.test(code) ? code.padStart(5, '0') : code;
        return {
            market: 'hk', normalizedSymbol: `${padded}.HK`, tencentCode: index ? `r_hk${code}` : /^\d{5}$/.test(padded) ? `r_hk${padded}` : undefined,
            currency: 'HKD', exchange: '香港交易所', exchangeId: 'HKEX',
            kind: index ? 'index' : HK_ETFS.has(padded) ? 'etf' : /^\d{5}$/.test(padded) ? 'equity' : 'unknown',
        };
    }
    if (/\.(SS|SH|SZ|BJ)$/.test(s) || /^(SSE|SZSE|BSE):/.test(s) || /^\d{6}$/.test(s)) {
        const code = s.replace(/^(SSE|SZSE|BSE):/, '').replace(/\.(SS|SH|SZ|BJ)$/, '');
        const explicit = /\.(SS|SH)$/.test(s) || s.startsWith('SSE:') ? 'SSE'
            : s.endsWith('.SZ') || s.startsWith('SZSE:') ? 'SZSE'
                : s.endsWith('.BJ') || s.startsWith('BSE:') ? 'BSE' : undefined;
        const exchangeId = explicit ?? (/^(8|4|920)/.test(code) ? 'BSE' : /^(6|9|5)/.test(code) ? 'SSE' : 'SZSE');
        const suffix = exchangeId === 'SSE' ? 'SS' : exchangeId === 'SZSE' ? 'SZ' : 'BJ';
        const index = (exchangeId === 'SSE' && /^000\d{3}$/.test(code)) || (exchangeId === 'SZSE' && /^399\d{3}$/.test(code));
        return {
            market: 'cn', normalizedSymbol: `${code}.${suffix}`,
            // BSE coverage has not been verified for these upstream endpoints.
            tencentCode: exchangeId === 'BSE' || !/^\d{6}$/.test(code) ? undefined : `${exchangeId === 'SSE' ? 'sh' : 'sz'}${code}`,
            currency: 'CNY', exchange: exchangeId === 'SSE' ? '上海证券交易所' : exchangeId === 'SZSE' ? '深圳证券交易所' : '北京证券交易所',
            exchangeId, kind: index ? 'index' : /^\d{6}$/.test(code) ? (/^(5|15|16)/.test(code) ? 'etf' : 'equity') : 'unknown',
        };
    }
    const code = s.replace(/^(NASDAQ:|NYSE:|AMEX:)/, '');
    return {
        market: 'us', normalizedSymbol: code,
        tencentCode: /^[A-Z][A-Z0-9.-]*$/.test(code) ? `us${code}` : undefined,
        currency: 'USD', exchange: '美股市场', exchangeId: 'US',
        kind: US_INDICES.has(code) ? 'index' : US_ETFS.has(code) ? 'etf' : /^[A-Z][A-Z0-9.-]*$/.test(code) ? 'equity' : 'unknown',
    };
}
