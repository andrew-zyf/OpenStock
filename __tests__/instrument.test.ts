import { describe, expect, it } from 'vitest';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { identifyMarketAndCode as legacyIdentity } from '@/lib/realtime-market';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import { optionalNumber } from '@/lib/market/contracts';

describe('shared instrument identity', () => {
    it('preserves the legacy export and canonicalizes HK to five digits', () => {
        expect(legacyIdentity).toBe(identifyMarketAndCode);
        for (const raw of ['700', '0700.HK', '00700.HK', 'hkex:700']) {
            expect(identifyMarketAndCode(raw)).toMatchObject({ normalizedSymbol: '00700.HK', tencentCode: 'r_hk00700', kind: 'equity', exchangeId: 'HKEX' });
        }
    });
    it('keeps Taiwan OTC distinct from listed equities', () => {
        expect(identifyMarketAndCode('TPEX:6488')).toMatchObject({ normalizedSymbol: '6488.TWO', twseCode: 'otc_6488.two', exchangeId: 'TPEX' });
        expect(identifyMarketAndCode('6488.TWO')).toEqual(identifyMarketAndCode('TPEX:6488'));
        expect(identifyMarketAndCode('TWSE:2330')).toMatchObject({ normalizedSymbol: '2330.TW', twseCode: 'tse_2330.tw' });
    });
    it.each(['830799', '430047', '920001', '830799.BJ', 'BSE:430047'])('recognizes BSE without inventing upstream support: %s', raw => {
        const meta = identifyMarketAndCode(raw);
        expect(meta).toMatchObject({ market: 'cn', exchangeId: 'BSE', exchange: '北京证券交易所', kind: 'equity' });
        expect(meta.normalizedSymbol).toMatch(/\.BJ$/);
        expect(meta.tencentCode).toBeUndefined();
        expect(Object.values(getInstrumentCapabilities(raw))).toEqual([false, false, false, false, false, false]);
    });
    it.each(['000001.SS', 'SSE:000300', '399001.SZ', 'HKEX:HSI', '^GSPC', '^TWII'])('separates known indices from companies: %s', raw => {
        expect(identifyMarketAndCode(raw).kind).toBe('index');
        expect(getInstrumentCapabilities(raw)).toMatchObject({ profile: false, financials: false, alerts: false, depth: false });
    });
    it.each(['SPY', '02800.HK', '0050.TW', '510300.SS'])('recognizes common ETFs: %s', raw => {
        expect(identifyMarketAndCode(raw).kind).toBe('etf');
        expect(getInstrumentCapabilities(raw)).toMatchObject({ profile: false, financials: false });
    });
    it('matches native backend capabilities rather than promising every exchange feature', () => {
        expect(getInstrumentCapabilities('AAPL')).toEqual({ profile: false, financials: false, alerts: true, depth: false, ticks: false, capitalFlow: false });
        expect(getInstrumentCapabilities('00700.HK')).toEqual({ profile: true, financials: true, alerts: false, depth: false, ticks: true, capitalFlow: true });
        expect(getInstrumentCapabilities('2330.TW')).toEqual({ profile: true, financials: true, alerts: false, depth: true, ticks: true, capitalFlow: false });
        expect(getInstrumentCapabilities('6488.TWO')).toMatchObject({ profile: false, financials: false, alerts: false, depth: true, ticks: true, capitalFlow: false });
        expect(getInstrumentCapabilities('600519.SS')).toMatchObject({ profile: true, financials: true, alerts: false, depth: true, ticks: true, capitalFlow: true });
        expect(getInstrumentCapabilities('???')).toEqual({ profile: false, financials: false, alerts: false, depth: false, ticks: false, capitalFlow: false });
    });
    it('distinguishes numeric absence from actual zero', () => {
        for (const value of ['', ' ', '-', '--', null, undefined, NaN, Infinity, false, [], {}]) expect(optionalNumber(value)).toBeUndefined();
        expect(optionalNumber('0')).toBe(0);
        expect(optionalNumber(0)).toBe(0);
        expect(optionalNumber('-12.4')).toBe(-12.4);
    });
});
