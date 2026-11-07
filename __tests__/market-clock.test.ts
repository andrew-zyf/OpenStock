import { describe, expect, it } from 'vitest';
import { formatSpan, sessionOf } from '@/lib/market-session';

const at = (h: number, m = 0) => h * 60 + m;

describe('NYSE session', () => {
    it('knows each weekday phase', () => {
        expect(sessionOf(2, at(3)).phase).toBe('closed');
        expect(sessionOf(2, at(4)).phase).toBe('pre');
        expect(sessionOf(2, at(9, 30)).phase).toBe('open');
        expect(sessionOf(2, at(15, 59)).phase).toBe('open');
        expect(sessionOf(2, at(16)).phase).toBe('after');
        expect(sessionOf(2, at(20)).phase).toBe('closed');
    });

    it('counts down to the right open', () => {
        expect(sessionOf(2, at(9)).line).toBe('盘前交易 · 距开市还有 30分钟');
        expect(sessionOf(2, at(14)).line).toBe('开市交易中 · 距收市还有 2小时 00分');
        // Friday night and Saturday wait for Monday 9:30
        expect(sessionOf(5, at(21)).line).toBe('休市中 · 距开市还有 2天 12小时');
        expect(sessionOf(6, at(12)).line).toBe('休市中 · 距开市还有 1天 21小时');
    });

    it('formats spans', () => {
        expect(formatSpan(45)).toBe('45分钟');
        expect(formatSpan(125)).toBe('2小时 05分');
    });
});

import { getMarket, hasFinnhubQuotes, isMarketOpen } from '@/lib/markets';

describe('markets', () => {
    it('knows which symbols Finnhub free can price', () => {
        expect(hasFinnhubQuotes('AAPL')).toBe(true);
        expect(hasFinnhubQuotes('BRK.B')).toBe(true);
        expect(hasFinnhubQuotes('BINANCE:BTCUSDT')).toBe(true);
        expect(hasFinnhubQuotes('RELIANCE.NS')).toBe(false);
        expect(hasFinnhubQuotes('BARC.L')).toBe(false);
        expect(hasFinnhubQuotes('7203.T')).toBe(false);
        expect(hasFinnhubQuotes('2222.SR')).toBe(false);
        expect(hasFinnhubQuotes('FX:EURUSD')).toBe(false);
    });

    it('opens each market in its own time zone', () => {
        // Wed 2026-09-23 10:00 in Shanghai/HK/Taipei (UTC+8) = 02:00 UTC
        expect(isMarketOpen(getMarket('cn'), new Date('2026-09-23T02:00:00Z'))).toBe(true);
        expect(isMarketOpen(getMarket('hk'), new Date('2026-09-23T02:00:00Z'))).toBe(true);
        expect(isMarketOpen(getMarket('tw'), new Date('2026-09-23T02:00:00Z'))).toBe(true);
        expect(isMarketOpen(getMarket('us'), new Date('2026-09-23T02:00:00Z'))).toBe(false);
        // Wed 2026-09-23 14:00 UTC = 10:00 in New York (EDT)
        expect(isMarketOpen(getMarket('us'), new Date('2026-09-23T14:00:00Z'))).toBe(true);
        // Saturday: stocks closed
        expect(isMarketOpen(getMarket('cn'), new Date('2026-09-26T10:00:00Z'))).toBe(false);
        expect(isMarketOpen(getMarket('hk'), new Date('2026-09-26T10:00:00Z'))).toBe(false);
        expect(isMarketOpen(getMarket('tw'), new Date('2026-09-26T10:00:00Z'))).toBe(false);
        expect(isMarketOpen(getMarket('us'), new Date('2026-09-26T14:00:00Z'))).toBe(false);
    });
});
