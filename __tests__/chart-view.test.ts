import { describe, expect, it } from 'vitest';
import type { ChartDataPoint, ChartSeries } from '@/lib/realtime-market';
import {
    anchorChartViewport, chartMovingAverage, chartPointMetrics, chartRSI,
    formatChartVolume, resolveChartViewport, sourcedVwap,
} from '@/lib/market/chart-view';

const point = (date: string, close: number, time = '09:30'): ChartDataPoint => ({ date, time, close });
const series = (points: ChartDataPoint[], overrides: Partial<ChartSeries> = {}): ChartSeries => ({
    symbol: 'TEST', market: 'us', period: '1d', interval: 'minute', volumeUnit: 'shares',
    points, prevClose: 100, periodHigh: 111, periodLow: 100, latestPrice: 111,
    change: 11, changePercent: 11, currency: 'USD', source: 'fixture',
    fetchedAt: '2026-11-06T16:00:00Z', ...overrides,
});

describe('chart returns and metric scope', () => {
    const points = [point('2026-11-06', 100), point('2026-11-06', 110, '09:31'), point('2026-11-06', 111, '09:32')];

    it('reports 11% for 100 → 110 → 111 relative to yesterday close, including after panning', () => {
        const data = series(points);
        expect(chartPointMetrics(data, 2).changePercent).toBe(11);
        for (const range of [[0, 2], [1, 2], [2, 2]] as [number, number][]) {
            const [start, end] = resolveChartViewport(points, anchorChartViewport(points, range));
            const visible = points.slice(start, end + 1);
            expect(chartPointMetrics(data, start + visible.length - 1).changePercent).toBe(11);
        }
    });

    it('uses the prior GLOBAL historical bar when the selected bar is first in the viewport', () => {
        const data = series(points, { period: '1m', interval: 'day', prevClose: 999 });
        for (const range of [[0, 2], [1, 2], [2, 2]] as [number, number][]) {
            const [start, end] = resolveChartViewport(points, anchorChartViewport(points, range));
            const globalIndex = start + (end - start);
            expect(chartPointMetrics(data, globalIndex).reference).toBe(110);
            expect(chartPointMetrics(data, globalIndex).changePercent).toBeCloseTo(1 / 110 * 100);
        }
        expect(chartPointMetrics(data, 0).changePercent).toBeUndefined();
    });

    it('never replaces a missing or invalid reference with open or zero', () => {
        for (const prevClose of [undefined, 0, NaN]) {
            const data = series([{ ...points[0], open: 98 }], { prevClose });
            expect(chartPointMetrics(data, 0).changePercent).toBeUndefined();
        }
    });

    it('uses session totals only when requested, and retains reported zero', () => {
        const data = series([{ ...points[2], open: 110, high: 111, low: 111, volume: 0 }], {
            open: 100, high: 115, low: 99, volume: 12_000,
        });
        expect(chartPointMetrics(data, 0, true)).toMatchObject({ open: 100, high: 115, low: 99, volume: 12_000, amplitude: 16 });
        expect(chartPointMetrics(data, 0)).toMatchObject({ open: 110, volume: 0, amplitude: 0 });
        expect(chartPointMetrics(series(points), 0).volume).toBeUndefined();
    });

    it('does not interpret missing VWAP as the price', () => {
        expect(sourcedVwap(points[2])).toBeUndefined();
        expect(sourcedVwap({ ...points[2], avgPrice: NaN })).toBeUndefined();
        expect(sourcedVwap({ ...points[2], avgPrice: 0 })).toBeUndefined();
        expect(sourcedVwap({ ...points[2], avgPrice: 105 })).toBe(105);
    });
});

describe('date anchored chart viewport', () => {
    const points = [point('2026-11-04', 100), point('2026-11-05', 110), point('2026-11-06', 111)];

    it('preserves selected dates on prepend, append and replacement of bar values', () => {
        const viewport = anchorChartViewport(points, [1, 2]);
        for (const refreshed of [
            [...points, point('2026-11-09', 112)],
            [point('2026-11-03', 99), ...points],
            [point('2026-11-03', 99), ...points.map((p) => ({ ...p, close: p.close + 1 })), point('2026-11-09', 112)],
        ]) {
            const [start, end] = resolveChartViewport(refreshed, viewport);
            expect(refreshed.slice(start, end + 1).map((p) => p.date)).toEqual(['2026-11-05', '2026-11-06']);
        }
    });

    it('distinguishes equal clock times across sessions and minutes within one session', () => {
        const minutePoints = [...points, point('2026-11-06', 112, '09:31')];
        const viewport = anchorChartViewport(minutePoints, [2, 3]);
        expect(resolveChartViewport([point('2026-11-03', 99), ...minutePoints], viewport)).toEqual([3, 4]);
    });

    it('clamps dropped endpoint dates and handles empty or short responses', () => {
        const viewport = anchorChartViewport(points, [1, 2]);
        expect(resolveChartViewport([points[2]], viewport)).toEqual([0, 0]);
        expect(resolveChartViewport([], viewport)).toEqual([0, -1]);
        expect(resolveChartViewport(points, null, 22)).toEqual([0, 2]);
    });

    it('calculates MA60 and RSI24 with warm-up history before displaying the last 22 daily bars', () => {
        const history = Array.from({ length: 142 }, (_, i) => point(`2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`, 100 + i));
        const [start, end] = resolveChartViewport(history, null, 22);
        expect([start, end]).toEqual([120, 141]);
        const ma = chartMovingAverage(history, 60).slice(start, end + 1);
        const rsi = chartRSI(history, 24).slice(start, end + 1);
        expect(ma).toHaveLength(22);
        expect(ma[0]).toBe(190.5);
        expect(rsi.every((value) => value === 100)).toBe(true);
        expect(chartMovingAverage(history.slice(start), 60).every((value) => value === null)).toBe(true);
    });

    it('reports neutral RSI for flat prices rather than an overbought value', () => {
        expect(chartRSI(Array.from({ length: 30 }, () => points[0]), 24).at(-1)).toBe(50);
    });
});

describe('normalized chart volume', () => {
    it('formats shares using each market convention', () => {
        expect(formatChartVolume(1000, 'cn')).toBe('10手');
        expect(formatChartVolume(1000, 'tw')).toBe('1张');
        expect(formatChartVolume(1000, 'hk')).toBe('1,000股');
        expect(formatChartVolume(1000, 'us')).toBe('1,000股');
    });

    it('distinguishes zero, fractional lots and missing data', () => {
        expect(formatChartVolume(0, 'cn')).toBe('0手');
        expect(formatChartVolume(50, 'cn')).toBe('0.5手');
        expect(formatChartVolume(undefined, 'cn')).toBe('—');
        expect(formatChartVolume(NaN, 'hk')).toBe('—');
    });
});
