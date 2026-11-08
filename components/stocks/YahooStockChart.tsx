'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CandlestickChart, Clock, LineChart, ZoomIn, ZoomOut, RotateCcw, MoveHorizontal } from "lucide-react";
import Panel from "@/components/Panel";
import ChangePill from "@/components/ChangePill";
import { getUnifiedChartSeries } from "@/lib/actions/realtime-market.actions";
import { formatPrice } from "@/lib/utils";
import type { ChartDataPoint } from "@/lib/realtime-market";
import { useMarketResource } from "@/hooks/useMarketResource";
import { identifyMarketAndCode } from "@/lib/market/instrument";
import {
    anchorChartViewport, chartBarKey, chartMovingAverage as calcMA, chartPointMetrics, chartProvenanceLabel,
    chartRSI as calcRSI, formatChartVolume as formatVol, resolveChartViewport,
    sourcedVwap, type ChartViewport,
} from "@/lib/market/chart-view";

type Period = '1d' | '5d' | '1m' | '3m' | '1y' | '5y';
type ChartStyle = 'candlestick' | 'line';
type MainOverlay = 'ma' | 'boll';
type SubIndicator = 'vol' | 'macd' | 'kdj' | 'rsi';

const PERIODS: { id: Period; label: string }[] = [
    { id: '1d', label: '分时' },
    { id: '5d', label: '五日' },
    { id: '1m', label: '日K' },
    { id: '3m', label: '三月日K' },
    { id: '1y', label: '周K' },
    { id: '5y', label: '月K' },
];

function calcBOLL(points: ChartDataPoint[], window = 20, k = 2) {
    const mb: (number | null)[] = [];
    const ub: (number | null)[] = [];
    const lb: (number | null)[] = [];

    for (let idx = 0; idx < points.length; idx++) {
        if (idx < window - 1) {
            mb.push(null);
            ub.push(null);
            lb.push(null);
            continue;
        }
        let sum = 0;
        for (let i = idx - window + 1; i <= idx; i++) sum += points[i].close;
        const mean = sum / window;
        let sqSum = 0;
        for (let i = idx - window + 1; i <= idx; i++) {
            const diff = points[i].close - mean;
            sqSum += diff * diff;
        }
        const std = Math.sqrt(sqSum / window);
        mb.push(mean);
        ub.push(mean + k * std);
        lb.push(mean - k * std);
    }
    return { mb, ub, lb };
}

function calcMACD(points: ChartDataPoint[], shortP = 12, longP = 26, sigP = 9) {
    const dif: number[] = [];
    const dea: number[] = [];
    const hist: number[] = [];

    if (!points.length) return { dif, dea, hist };

    let emaShort = points[0].close;
    let emaLong = points[0].close;
    let currentDea = 0;

    const kShort = 2 / (shortP + 1);
    const kLong = 2 / (longP + 1);
    const kSig = 2 / (sigP + 1);

    for (let i = 0; i < points.length; i++) {
        const c = points[i].close;
        emaShort = i === 0 ? c : c * kShort + emaShort * (1 - kShort);
        emaLong = i === 0 ? c : c * kLong + emaLong * (1 - kLong);
        const d = emaShort - emaLong;
        currentDea = i === 0 ? d : d * kSig + currentDea * (1 - kSig);
        const h = (d - currentDea) * 2;
        dif.push(d);
        dea.push(currentDea);
        hist.push(h);
    }
    return { dif, dea, hist };
}

function calcKDJ(points: ChartDataPoint[], n = 9) {
    const kList: number[] = [];
    const dList: number[] = [];
    const jList: number[] = [];

    let k = 50;
    let d = 50;

    for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - n + 1);
        let lowN = Infinity;
        let highN = -Infinity;
        for (let m = start; m <= i; m++) {
            const h = points[m].high ?? points[m].close;
            const l = points[m].low ?? points[m].close;
            if (h > highN) highN = h;
            if (l < lowN) lowN = l;
        }
        const close = points[i].close;
        const rsv = highN === lowN ? 50 : ((close - lowN) / (highN - lowN)) * 100;
        k = (2 / 3) * k + (1 / 3) * rsv;
        d = (2 / 3) * d + (1 / 3) * k;
        const j = 3 * k - 2 * d;
        kList.push(k);
        dList.push(d);
        jList.push(j);
    }
    return { kList, dList, jList };
}

export default function YahooStockChart({ symbol }: { symbol: string; tvSymbol?: string }) {
    const provenanceId = useId();
    const [period, setPeriod] = useState<Period>('1d');
    const [chartStyle, setChartStyle] = useState<ChartStyle>('line');
    const [mainOverlay, setMainOverlay] = useState<MainOverlay>('ma');
    const [subIndicator, setSubIndicator] = useState<SubIndicator>('vol');
    const instrument = identifyMarketAndCode(symbol);
    const supported = instrument.exchangeId !== 'BSE' && instrument.kind !== 'unknown'
        && !(instrument.market === 'tw' && (instrument.exchangeId !== 'TWSE' || instrument.kind === 'index'))
        && !(period === '5d' && (instrument.market === 'cn' || instrument.market === 'hk'));
    const resourceKey = `chart:${instrument.normalizedSymbol}:${period}`;
    const loader = useCallback(async () => {
        const data = await getUnifiedChartSeries(symbol, period);
        if (!data?.points.length) throw new Error('该标的暂无此周期行情数据');
        return data;
    }, [symbol, period]);
    const { data: chartData, loading, error, stale } = useMarketResource({
        key: resourceKey,
        loader,
        enabled: supported,
        intervalMs: period === '1d' || period === '5d' ? 30_000 : 3_600_000,
    });
    const [hoveredBar, setHoveredBar] = useState<{ resource: string; key: string } | null>(null);
    const [viewport, setViewport] = useState<{
        resource: string; session: string; anchor: ChartViewport;
    } | null>(null);
    const allPoints = useMemo(() => chartData?.points ?? [], [chartData]);
    const session = period === '1d' ? allPoints.at(-1)?.date ?? '' : '';
    const viewAnchor = viewport?.resource === resourceKey && viewport.session === session ? viewport.anchor : null;
    const setViewRange = (range: [number, number] | null) => {
        const anchor = range ? anchorChartViewport(allPoints, range) : null;
        setViewport(anchor ? { resource: resourceKey, session, anchor } : null);
        setHoveredBar(null);
    };

    // Drag-to-pan refs
    const isDragging = useRef(false);
    const dragStartX = useRef(0);
    const initialRange = useRef<ChartViewport | null>(null);
    const hasMoved = useRef(false);

    // Switch period & auto-pick default style
    const handlePeriodChange = (next: Period) => {
        setPeriod(next);
        if (next === '1d') {
            setChartStyle('line');
        } else {
            setChartStyle('candlestick');
        }
        setViewRange(null);
    };

    useEffect(() => {
        setHoveredBar(null);
        setViewport(null);
        isDragging.current = false;
    }, [resourceKey, session]);
    const currency = chartData?.currency || 'USD';
    const market = chartData?.market || 'us';

    // Global Technical Indicators computed over full series
    const globalMa5 = useMemo(() => calcMA(allPoints, 5), [allPoints]);
    const globalMa10 = useMemo(() => calcMA(allPoints, 10), [allPoints]);
    const globalMa20 = useMemo(() => calcMA(allPoints, 20), [allPoints]);
    const globalMa60 = useMemo(() => calcMA(allPoints, 60), [allPoints]);
    const globalBoll = useMemo(() => calcBOLL(allPoints, 20, 2), [allPoints]);
    const globalMacd = useMemo(() => calcMACD(allPoints, 12, 26, 9), [allPoints]);
    const globalKdj = useMemo(() => calcKDJ(allPoints, 9), [allPoints]);
    const globalRsi6 = useMemo(() => calcRSI(allPoints, 6), [allPoints]);
    const globalRsi12 = useMemo(() => calcRSI(allPoints, 12), [allPoints]);
    const globalRsi24 = useMemo(() => calcRSI(allPoints, 24), [allPoints]);

    // Active zoom & pan window
    const totalBars = allPoints.length;
    const defaultBars = period === '1m' ? 22 : period === '3m' ? 66 : period === '1y' ? 52 : period === '5y' ? 60 : totalBars;
    const [startIdx, endIdx] = resolveChartViewport(allPoints, viewAnchor, defaultBars);
    const timeframe = chartData?.interval === 'minute' ? '分钟K' : chartData?.interval === 'week' ? '周K'
        : chartData?.interval === 'month' ? '月K' : '日K';

    // Sliced visible series
    const visiblePoints = useMemo(() => (totalBars ? allPoints.slice(startIdx, endIdx + 1) : []), [allPoints, totalBars, startIdx, endIdx]);
    const hoveredIndex = hoveredBar?.resource === resourceKey
        ? visiblePoints.findIndex((point) => chartBarKey(point) === hoveredBar.key) : -1;
    const hoverIndex = hoveredIndex >= 0 ? hoveredIndex : null;
    const setHoverIndex = (index: number | null) => {
        const point = index != null ? visiblePoints[index] : null;
        setHoveredBar(point ? { resource: resourceKey, key: chartBarKey(point) } : null);
    };
    const visibleMa5 = useMemo(() => globalMa5.slice(startIdx, endIdx + 1), [globalMa5, startIdx, endIdx]);
    const visibleMa10 = useMemo(() => globalMa10.slice(startIdx, endIdx + 1), [globalMa10, startIdx, endIdx]);
    const visibleMa20 = useMemo(() => globalMa20.slice(startIdx, endIdx + 1), [globalMa20, startIdx, endIdx]);
    const visibleMa60 = useMemo(() => globalMa60.slice(startIdx, endIdx + 1), [globalMa60, startIdx, endIdx]);
    const visibleBollUb = useMemo(() => globalBoll.ub.slice(startIdx, endIdx + 1), [globalBoll, startIdx, endIdx]);
    const visibleBollMb = useMemo(() => globalBoll.mb.slice(startIdx, endIdx + 1), [globalBoll, startIdx, endIdx]);
    const visibleBollLb = useMemo(() => globalBoll.lb.slice(startIdx, endIdx + 1), [globalBoll, startIdx, endIdx]);

    const visibleMacdDif = useMemo(() => globalMacd.dif.slice(startIdx, endIdx + 1), [globalMacd, startIdx, endIdx]);
    const visibleMacdDea = useMemo(() => globalMacd.dea.slice(startIdx, endIdx + 1), [globalMacd, startIdx, endIdx]);
    const visibleMacdHist = useMemo(() => globalMacd.hist.slice(startIdx, endIdx + 1), [globalMacd, startIdx, endIdx]);

    const visibleK = useMemo(() => globalKdj.kList.slice(startIdx, endIdx + 1), [globalKdj, startIdx, endIdx]);
    const visibleD = useMemo(() => globalKdj.dList.slice(startIdx, endIdx + 1), [globalKdj, startIdx, endIdx]);
    const visibleJ = useMemo(() => globalKdj.jList.slice(startIdx, endIdx + 1), [globalKdj, startIdx, endIdx]);

    const visibleRsi6 = useMemo(() => globalRsi6.slice(startIdx, endIdx + 1), [globalRsi6, startIdx, endIdx]);
    const visibleRsi12 = useMemo(() => globalRsi12.slice(startIdx, endIdx + 1), [globalRsi12, startIdx, endIdx]);
    const visibleRsi24 = useMemo(() => globalRsi24.slice(startIdx, endIdx + 1), [globalRsi24, startIdx, endIdx]);

    // SVG Layout Dimensions
    const svgWidth = 840;
    const svgHeight = 420;
    const paddingX = 16;
    const paddingY = 16;
    const innerW = svgWidth - paddingX * 2;

    const mainH = 255; // Main chart height
    const gap = 28;    // Gap between main chart and subchart
    const subTopY = paddingY + mainH + gap;
    const subH = 85;   // Subchart height
    const subBaseY = subTopY + subH;

    // Selected overlays share the price scale, including MA60 after its warm-up.
    const isCandle = chartStyle === 'candlestick' && period !== '1d';
    const overlayValues = (index: number): number[] => {
        const values = isCandle
            ? mainOverlay === 'ma'
                ? [visibleMa5[index], visibleMa10[index], visibleMa20[index], visibleMa60[index]]
                : [visibleBollUb[index], visibleBollLb[index]]
            : [sourcedVwap(visiblePoints[index])];
        return values.filter((value): value is number => value != null && Number.isFinite(value));
    };
    const highs = visiblePoints.map((p, i) => Math.max(isCandle ? p.high ?? p.close : p.close, ...overlayValues(i)));
    const lows = visiblePoints.map((p, i) => Math.min(isCandle ? p.low ?? p.close : p.close, ...overlayValues(i)));
    const rawMin = lows.length ? Math.min(...lows) : 0;
    const rawMax = highs.length ? Math.max(...highs) : 100;
    const range = rawMax - rawMin || 1;
    const padding = range * 0.06;
    const yMin = Math.max(0, rawMin - padding);
    const yMax = rawMax + padding;
    const yDiff = yMax - yMin || 1;

    // Volume scaling over visible slice
    const volumes = visiblePoints.map((p) => p.volume || 0);
    const maxVol = Math.max(...volumes, 1);

    // Coordinate mapping
    const coords = visiblePoints.map((p, idx) => {
        const x = paddingX + (idx / Math.max(1, visiblePoints.length - 1)) * innerW;
        const yClose = paddingY + mainH - ((p.close - yMin) / yDiff) * mainH;
        const yOpen = paddingY + mainH - (((p.open ?? p.close) - yMin) / yDiff) * mainH;
        const yHigh = paddingY + mainH - (((p.high ?? p.close) - yMin) / yDiff) * mainH;
        const yLow = paddingY + mainH - (((p.low ?? p.close) - yMin) / yDiff) * mainH;

        const avg = sourcedVwap(p);
        const yAvg = avg != null ? paddingY + mainH - ((avg - yMin) / yDiff) * mainH : null;

        const volVal = p.volume ?? 0;
        const barH = volVal > 0 ? Math.max(2, (volVal / maxVol) * subH) : 0;
        const yVol = subBaseY - barH;

        return { x, yClose, yOpen, yHigh, yLow, yAvg, yVol, barH, point: p, idx };
    });

    const isUp = (chartData?.change ?? 0) >= 0;
    const strokeColor = isUp ? 'var(--up, #ef4444)' : 'var(--down, #10b981)';

    // Path for line mode
    let priceLineD = '';
    let areaD = '';
    let avgLineD = '';
    if (coords.length > 1) {
        priceLineD = coords.reduce((acc, c, i) => (i === 0 ? `M ${c.x} ${c.yClose}` : `${acc} L ${c.x} ${c.yClose}`), '');
        const first = coords[0];
        const last = coords[coords.length - 1];
        areaD = `${priceLineD} L ${last.x} ${paddingY + mainH} L ${first.x} ${paddingY + mainH} Z`;

        let previousHasVwap = false;
        coords.forEach((c) => {
            if (c.yAvg == null) {
                previousHasVwap = false;
                return;
            }
            avgLineD += `${previousHasVwap ? ' L' : ' M'} ${c.x} ${c.yAvg}`;
            previousHasVwap = true;
        });
    }

    // Previous close baseline
    const prevCloseY = period === '1d' && chartData?.prevClose != null && chartData.prevClose > 0 && chartData.prevClose >= yMin && chartData.prevClose <= yMax
        ? paddingY + mainH - ((chartData.prevClose - yMin) / yDiff) * mainH
        : null;

    // Main chart overlay paths (MA / BOLL)
    const makeMainPath = (list: (number | null)[]) => {
        let path = '';
        coords.forEach((c, i) => {
            const v = list[i];
            if (v == null || v < yMin || v > yMax) return;
            const y = paddingY + mainH - ((v - yMin) / yDiff) * mainH;
            path = path === '' ? `M ${c.x} ${y}` : `${path} L ${c.x} ${y}`;
        });
        return path;
    };

    const ma5Path = isCandle && mainOverlay === 'ma' ? makeMainPath(visibleMa5) : '';
    const ma10Path = isCandle && mainOverlay === 'ma' ? makeMainPath(visibleMa10) : '';
    const ma20Path = isCandle && mainOverlay === 'ma' ? makeMainPath(visibleMa20) : '';
    const ma60Path = isCandle && mainOverlay === 'ma' ? makeMainPath(visibleMa60) : '';

    const bollUbPath = isCandle && mainOverlay === 'boll' ? makeMainPath(visibleBollUb) : '';
    const bollMbPath = isCandle && mainOverlay === 'boll' ? makeMainPath(visibleBollMb) : '';
    const bollLbPath = isCandle && mainOverlay === 'boll' ? makeMainPath(visibleBollLb) : '';

    // Subchart coordinate helpers for MACD / KDJ / RSI
    const macdPaths = useMemo(() => {
        if (subIndicator !== 'macd' || !coords.length) return null;
        const allVals = [...visibleMacdDif, ...visibleMacdDea, ...visibleMacdHist].map((v) => Math.abs(v || 0));
        const maxAbs = Math.max(...allVals, 0.001);
        const midY = subTopY + subH / 2;
        const toY = (v: number) => midY - (v / maxAbs) * (subH / 2 - 4);

        let difPath = '';
        let deaPath = '';
        coords.forEach((c, i) => {
            const dy = toY(visibleMacdDif[i] || 0);
            const ey = toY(visibleMacdDea[i] || 0);
            difPath = i === 0 ? `M ${c.x} ${dy}` : `${difPath} L ${c.x} ${dy}`;
            deaPath = i === 0 ? `M ${c.x} ${ey}` : `${deaPath} L ${c.x} ${ey}`;
        });
        return { midY, toY, difPath, deaPath };
    }, [subIndicator, coords, visibleMacdDif, visibleMacdDea, visibleMacdHist, subTopY, subH]);

    const kdjPaths = useMemo(() => {
        if (subIndicator !== 'kdj' || !coords.length) return null;
        const allVals = [...visibleK, ...visibleD, ...visibleJ];
        const minV = Math.min(0, ...allVals);
        const maxV = Math.max(100, ...allVals);
        const span = maxV - minV || 100;
        const toY = (v: number) => subBaseY - ((v - minV) / span) * subH;

        let kPath = '';
        let dPath = '';
        let jPath = '';
        coords.forEach((c, i) => {
            const ky = toY(visibleK[i] ?? 50);
            const dy = toY(visibleD[i] ?? 50);
            const jy = toY(visibleJ[i] ?? 50);
            kPath = i === 0 ? `M ${c.x} ${ky}` : `${kPath} L ${c.x} ${ky}`;
            dPath = i === 0 ? `M ${c.x} ${dy}` : `${dPath} L ${c.x} ${dy}`;
            jPath = i === 0 ? `M ${c.x} ${jy}` : `${jPath} L ${c.x} ${jy}`;
        });
        return { toY, kPath, dPath, jPath, y80: toY(80), y20: toY(20) };
    }, [subIndicator, coords, visibleK, visibleD, visibleJ, subBaseY, subH]);

    const rsiPaths = useMemo(() => {
        if (subIndicator !== 'rsi' || !coords.length) return null;
        const toY = (v: number) => subBaseY - (Math.max(0, Math.min(100, v)) / 100) * subH;
        const build = (arr: (number | null)[]) => {
            let p = '';
            coords.forEach((c, i) => {
                const v = arr[i];
                if (v == null) return;
                const y = toY(v);
                p = p === '' ? `M ${c.x} ${y}` : `${p} L ${c.x} ${y}`;
            });
            return p;
        };
        return {
            r6Path: build(visibleRsi6),
            r12Path: build(visibleRsi12),
            r24Path: build(visibleRsi24),
            y70: toY(70),
            y30: toY(30),
        };
    }, [subIndicator, coords, visibleRsi6, visibleRsi12, visibleRsi24, subBaseY, subH]);

    // Dynamic candle width based on visible count
    const barW = Math.max(2, Math.min(18, (innerW / Math.max(1, visiblePoints.length)) * 0.72));

    // Active hovered point or latest point
    const activeIdx = hoverIndex != null && visiblePoints[hoverIndex]
        ? hoverIndex
        : visiblePoints.length
            ? visiblePoints.length - 1
            : null;
    const activePoint = activeIdx != null ? visiblePoints[activeIdx] : null;

    // Session totals are used only for the unhovered latest intraday view.
    const showSession = period === '1d' && hoverIndex == null && endIdx === totalBars - 1;
    const metrics = chartData && activeIdx != null
        ? chartPointMetrics(chartData, startIdx + activeIdx, showSession) : null;
    const activePrice = metrics?.price;
    const activeOpen = metrics?.open;
    const activeHigh = metrics?.high;
    const activeLow = metrics?.low;
    const activeVolume = metrics?.volume;
    const activeDiffPct = metrics?.changePercent;
    const activeAmp = metrics?.amplitude;
    const activeTime = activePoint
        ? `${activePoint.date}${chartData?.interval === 'minute' ? ` ${activePoint.time}` : ''}` : '';
    const metricScope = showSession ? '当日' : '本K';
    const activeBarVolume = activePoint?.volume;

    const activeMa5 = activeIdx != null ? visibleMa5[activeIdx] : null;
    const activeMa10 = activeIdx != null ? visibleMa10[activeIdx] : null;
    const activeMa20 = activeIdx != null ? visibleMa20[activeIdx] : null;
    const activeMa60 = activeIdx != null ? visibleMa60[activeIdx] : null;

    const activeBollUb = activeIdx != null ? visibleBollUb[activeIdx] : null;
    const activeBollMb = activeIdx != null ? visibleBollMb[activeIdx] : null;
    const activeBollLb = activeIdx != null ? visibleBollLb[activeIdx] : null;

    const activeDif = activeIdx != null ? visibleMacdDif[activeIdx] : null;
    const activeDea = activeIdx != null ? visibleMacdDea[activeIdx] : null;
    const activeMacdH = activeIdx != null ? visibleMacdHist[activeIdx] : null;

    const activeK = activeIdx != null ? visibleK[activeIdx] : null;
    const activeD = activeIdx != null ? visibleD[activeIdx] : null;
    const activeJ = activeIdx != null ? visibleJ[activeIdx] : null;

    const activeR6 = activeIdx != null ? visibleRsi6[activeIdx] : null;
    const activeR12 = activeIdx != null ? visibleRsi12[activeIdx] : null;
    const activeR24 = activeIdx != null ? visibleRsi24[activeIdx] : null;

    // Describe observed indicator values without inferring trading recommendations.
    const techSignals = useMemo(() => {
        if (!visiblePoints.length || activePrice == null) return [];
        const signals: { text: string; tone: 'up' | 'down' | 'warn' | 'neutral' }[] = [];

        // 1. 均线系统诊断
        if (activeMa5 != null && activeMa10 != null && activeMa20 != null) {
            if (activeMa5 > activeMa10 && activeMa10 > activeMa20) {
                signals.push({ text: '均线排列 MA5>MA10>MA20', tone: 'up' });
            } else if (activeMa5 < activeMa10 && activeMa10 < activeMa20) {
                signals.push({ text: '均线排列 MA5<MA10<MA20', tone: 'down' });
            } else if (activePrice >= activeMa20) {
                signals.push({ text: `价格≥20根${timeframe}均线`, tone: 'neutral' });
            } else {
                signals.push({ text: `价格<20根${timeframe}均线`, tone: 'neutral' });
            }
        }

        // 2. MACD 动能诊断
        if (activeDif != null && activeDea != null) {
            if (activeDif > activeDea && activeDif > 0) {
                signals.push({ text: 'MACD DIF>DEA，DIF>0', tone: 'neutral' });
            } else if (activeDif > activeDea && activeDif <= 0) {
                signals.push({ text: 'MACD DIF>DEA，DIF≤0', tone: 'neutral' });
            } else {
                signals.push({ text: 'MACD DIF≤DEA', tone: 'neutral' });
            }
        }

        // 3. KDJ 超买超卖诊断
        if (activeJ != null) {
            if (activeJ >= 85) {
                signals.push({ text: `KDJ J≥85 (${activeJ.toFixed(0)})`, tone: 'warn' });
            } else if (activeJ <= 15) {
                signals.push({ text: `KDJ J≤15 (${activeJ.toFixed(0)})`, tone: 'warn' });
            }
        }

        // 4. BOLL 轨道位置诊断
        if (activeBollUb != null && activeBollLb != null && activeBollMb != null) {
            if (activePrice >= activeBollUb) {
                signals.push({ text: '价格≥BOLL上轨', tone: 'neutral' });
            } else if (activePrice <= activeBollLb) {
                signals.push({ text: '价格≤BOLL下轨', tone: 'neutral' });
            } else if (activePrice >= activeBollMb) {
                signals.push({ text: '价格位于BOLL中轨上方', tone: 'neutral' });
            } else {
                signals.push({ text: '价格位于BOLL中轨下方', tone: 'neutral' });
            }
        }

        return signals;
    }, [visiblePoints.length, activePrice, activeMa5, activeMa10, activeMa20, activeDif, activeDea, activeJ, activeBollUb, activeBollLb, activeBollMb, timeframe]);

    // --- Zoom & Pan Event Handlers ---
    const handleZoomIn = () => {
        if (totalBars <= 10) return;
        const currentLen = endIdx - startIdx + 1;
        const nextLen = Math.max(10, Math.round(currentLen * 0.75));
        const center = Math.round((startIdx + endIdx) / 2);
        let s = Math.round(center - nextLen / 2);
        let e = s + nextLen - 1;
        if (s < 0) {
            e -= s;
            s = 0;
        }
        if (e > totalBars - 1) {
            s -= (e - (totalBars - 1));
            e = totalBars - 1;
        }
        setViewRange([Math.max(0, s), Math.min(totalBars - 1, e)]);
    };

    const handleZoomOut = () => {
        if (totalBars <= 10) return;
        const currentLen = endIdx - startIdx + 1;
        const nextLen = Math.min(totalBars, Math.round(currentLen * 1.35));
        const center = Math.round((startIdx + endIdx) / 2);
        let s = Math.round(center - nextLen / 2);
        let e = s + nextLen - 1;
        if (s < 0) {
            e -= s;
            s = 0;
        }
        if (e > totalBars - 1) {
            s -= (e - (totalBars - 1));
            e = totalBars - 1;
        }
        setViewRange([Math.max(0, s), Math.min(totalBars - 1, e)]);
    };

    const handleResetZoom = () => {
        setViewRange([0, totalBars - 1]);
    };

    const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
        if (e.button !== 0 || totalBars <= 10) return;
        isDragging.current = true;
        hasMoved.current = false;
        dragStartX.current = e.clientX;
        initialRange.current = anchorChartViewport(allPoints, [startIdx, endIdx]);
    };

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (isDragging.current) {
            const deltaX = e.clientX - dragStartX.current;
            if (Math.abs(deltaX) > 3) {
                hasMoved.current = true;
            }
            const [initialStart, initialEnd] = resolveChartViewport(allPoints, initialRange.current);
            const windowSize = initialEnd - initialStart + 1;
            const pxPerBar = innerW / Math.max(1, windowSize);
            const shiftBars = Math.round(deltaX / pxPerBar);

            if (shiftBars !== 0) {
                let newStart = initialStart - shiftBars;
                let newEnd = initialEnd - shiftBars;
                if (newStart < 0) {
                    newEnd -= newStart;
                    newStart = 0;
                }
                if (newEnd > totalBars - 1) {
                    newStart -= (newEnd - (totalBars - 1));
                    newEnd = totalBars - 1;
                }
                newStart = Math.max(0, newStart);
                newEnd = Math.min(totalBars - 1, newEnd);
                setViewRange([newStart, newEnd]);
            }
        }
    };

    const handleMouseUp = () => {
        isDragging.current = false;
    };

    const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
        if (totalBars <= 10) return;
        e.preventDefault();

        const zoomFactor = e.deltaY < 0 ? 0.85 : 1.18;
        const currentLen = endIdx - startIdx + 1;
        let nextLen = Math.round(currentLen * zoomFactor);
        nextLen = Math.max(10, Math.min(totalBars, nextLen));
        if (nextLen === currentLen) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const mouseRatio = Math.max(0, Math.min(1, (e.clientX - rect.left - paddingX) / innerW));
        const centerIdx = startIdx + Math.round(currentLen * mouseRatio);

        let newStart = Math.round(centerIdx - nextLen * mouseRatio);
        let newEnd = newStart + nextLen - 1;
        if (newStart < 0) {
            newEnd -= newStart;
            newStart = 0;
        }
        if (newEnd > totalBars - 1) {
            newStart -= (newEnd - (totalBars - 1));
            newEnd = totalBars - 1;
        }
        newStart = Math.max(0, newStart);
        newEnd = Math.min(totalBars - 1, newEnd);
        setViewRange([newStart, newEnd]);
    };

    const isZoomed = startIdx > 0 || endIdx < totalBars - 1;

    const action = (
        <div className="flex flex-wrap items-center gap-1.5">
            {/* 缩放与拖拽控制工具组 */}
            <div className="flex items-center rounded-lg bg-page/60 p-0.5 border border-line">
                <button
                    type="button"
                    onClick={handleZoomIn}
                    className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-faint hover:text-foreground transition-colors"
                    title="放大 K 线 (亦可用鼠标滚轮)"
                >
                    <ZoomIn className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={handleZoomOut}
                    className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-faint hover:text-foreground transition-colors"
                    title="缩小 K 线 (亦可用鼠标滚轮)"
                >
                    <ZoomOut className="size-3.5" />
                </button>
                {isZoomed && (
                    <button
                        type="button"
                        onClick={handleResetZoom}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-brand-ink bg-brand-soft hover:bg-brand-soft/80 transition-colors"
                        title="重置全景视野"
                    >
                        <RotateCcw className="size-3" />
                        <span>全貌</span>
                    </button>
                )}
            </div>

            {/* 周期切换 */}
            <div className="flex items-center rounded-lg bg-page/60 p-0.5 border border-line">
                {PERIODS.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => handlePeriodChange(id)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                            period === id ? 'bg-primary text-primary-foreground shadow-xs' : 'text-faint hover:text-foreground'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* 图表类型切换 (蜡烛K线 / 分时走势) */}
            <div className="flex items-center rounded-lg bg-page/60 p-0.5 border border-line">
                <button
                    type="button"
                    onClick={() => setChartStyle('candlestick')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                        chartStyle === 'candlestick' ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'
                    }`}
                    title="切换为蜡烛K线图"
                >
                    <CandlestickChart className="size-3" />
                    <span>蜡烛</span>
                </button>
                <button
                    type="button"
                    onClick={() => setChartStyle('line')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                        chartStyle === 'line' ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'
                    }`}
                    title="切换为分时/平滑折线"
                >
                    <LineChart className="size-3" />
                    <span>折线</span>
                </button>
            </div>
        </div>
    );

    return (
        <Panel
            title="价格走势"
            sub={isCandle ? `${timeframe} · MA/BOLL 主图与 VOL/MACD/KDJ/RSI 副图` : `${chartData?.interval === 'minute' ? '分时' : timeframe}价格走势${avgLineD ? ' · 含来源提供的 VWAP' : ''}`}
            action={action}
        >
            <div className="flex flex-col gap-2 p-4">
                {/* 资深玩家看盘核心常规数据栏 (开高低收、涨跌幅、振幅、成交量) */}
                <div className="flex flex-wrap items-center justify-between gap-y-2 border-b border-line pb-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="num text-3xl font-bold tracking-tight">
                            {activePrice != null ? formatPrice(activePrice, currency) : '—'}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-faint">
                            {period === '1d' ? '较昨收' : '较前K'} <ChangePill value={activeDiffPct} />
                        </span>
                        {activeTime && (
                            <span className="mono flex items-center gap-1 text-xs font-semibold text-brand-ink">
                                <Clock className="size-3" />
                                {activeTime}
                            </span>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span>{metricScope}开: <strong className="num text-foreground">{activeOpen != null ? formatPrice(activeOpen, currency) : '—'}</strong></span>
                        <span>{metricScope}最高: <strong className="num text-up">{activeHigh != null ? formatPrice(activeHigh, currency) : '—'}</strong></span>
                        <span>{metricScope}最低: <strong className="num text-down">{activeLow != null ? formatPrice(activeLow, currency) : '—'}</strong></span>
                        <span>{metricScope}振幅: <strong className="num text-foreground">{activeAmp != null ? `${activeAmp.toFixed(2)}%` : '—'}</strong></span>
                        <span>{metricScope}成交量: <strong className="num text-foreground">{formatVol(activeVolume, market)}</strong></span>
                        <span role="status" className="mono text-[11px] text-faint">
                            {!supported ? '此周期暂不支持' : stale ? '更新失败 · 显示上次成功数据' : error ? '数据加载失败' : period === '1d' || period === '5d' ? '30秒刷新 · 隐藏时暂停' : '1小时刷新 · 隐藏时暂停'}
                        </span>
                    </div>
                </div>

                {chartData && (
                    <p id={provenanceId} className="text-xs leading-relaxed text-muted-foreground">
                        {chartProvenanceLabel(chartData)} · 行情时间: {chartData.asOf ?? '来源未提供'}
                    </p>
                )}

                {/* 技术指标观察 */}
                {techSignals.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pb-1 text-[11px]">
                        <span className="text-faint font-semibold mr-1">技术指标观察 ({timeframe}):</span>
                        {techSignals.map((sig) => {
                            const cls =
                                sig.tone === 'up'
                                    ? 'bg-red-500/15 text-up border-red-500/30'
                                    : sig.tone === 'down'
                                        ? 'bg-emerald-500/15 text-down border-emerald-500/30'
                                        : sig.tone === 'warn'
                                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                            : 'bg-page/60 text-muted-foreground border-line';
                            return (
                                <span
                                    key={sig.text}
                                    className={`rounded-md border px-2 py-0.5 font-semibold ${cls}`}
                                >
                                    {sig.text}
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* 主图指标栏 (MA5/10/20/60 或 BOLL) + 副图指标切换器 (VOL / MACD / KDJ / RSI) */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium">
                    <div className="flex flex-wrap items-center gap-3">
                        {isCandle ? (
                            <>
                                {/* 主图指标切换按钮 (MA / BOLL) */}
                                <div className="flex items-center rounded bg-page/60 p-0.5 border border-line">
                                    <button
                                        type="button"
                                        onClick={() => setMainOverlay('ma')}
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                            mainOverlay === 'ma' ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'
                                        }`}
                                    >
                                        MA均线
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setMainOverlay('boll')}
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                            mainOverlay === 'boll' ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'
                                        }`}
                                    >
                                        BOLL布林
                                    </button>
                                </div>

                                {mainOverlay === 'ma' ? (
                                    <>
                                        <span className="flex items-center gap-1 text-amber-500">
                                            <span className="inline-block size-2 rounded-full bg-amber-500" />
                                            MA5: <strong className="num">{activeMa5 != null ? activeMa5.toFixed(2) : '—'}</strong>
                                        </span>
                                        <span className="flex items-center gap-1 text-purple-400">
                                            <span className="inline-block size-2 rounded-full bg-purple-400" />
                                            MA10: <strong className="num">{activeMa10 != null ? activeMa10.toFixed(2) : '—'}</strong>
                                        </span>
                                        <span className="flex items-center gap-1 text-sky-400">
                                            <span className="inline-block size-2 rounded-full bg-sky-400" />
                                            MA20: <strong className="num">{activeMa20 != null ? activeMa20.toFixed(2) : '—'}</strong>
                                        </span>
                                        <span className="flex items-center gap-1 text-emerald-400">
                                            <span className="inline-block size-2 rounded-full bg-emerald-400" />
                                            MA60: <strong className="num">{activeMa60 != null ? activeMa60.toFixed(2) : '—'}</strong>
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <span className="flex items-center gap-1 text-amber-400">
                                            MID(中轨): <strong className="num">{activeBollMb != null ? activeBollMb.toFixed(2) : '—'}</strong>
                                        </span>
                                        <span className="flex items-center gap-1 text-purple-400">
                                            UPPER(上轨): <strong className="num">{activeBollUb != null ? activeBollUb.toFixed(2) : '—'}</strong>
                                        </span>
                                        <span className="flex items-center gap-1 text-sky-400">
                                            LOWER(下轨): <strong className="num">{activeBollLb != null ? activeBollLb.toFixed(2) : '—'}</strong>
                                        </span>
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <span className="flex items-center gap-1.5 text-foreground">
                                    <span className="inline-block size-2 rounded-full bg-foreground" />
                                    {chartData?.interval === 'minute' ? '价格线' : '收盘价线'}
                                </span>
                                {avgLineD && (
                                    <span className="flex items-center gap-1.5 text-amber-400">
                                        <span className="inline-block size-2 rounded-full bg-amber-400" />
                                        分时均价 (VWAP)
                                    </span>
                                )}
                                {prevCloseY != null && (
                                    <span className="flex items-center gap-1.5 text-faint">
                                        <span className="inline-block h-0.5 w-3 border-t border-dashed border-line-strong" />
                                        昨收参考 ({formatPrice(chartData?.prevClose || 0, currency)})
                                    </span>
                                )}
                            </>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-faint">
                        {/* 副图技术指标切换器 (VOL / MACD / KDJ / RSI) */}
                        <div className="flex items-center rounded bg-page/60 p-0.5 border border-line">
                            {(
                                [
                                    { id: 'vol', label: 'VOL量能' },
                                    { id: 'macd', label: 'MACD' },
                                    { id: 'kdj', label: 'KDJ' },
                                    { id: 'rsi', label: 'RSI' },
                                ] as const
                            ).map((ind) => (
                                <button
                                    key={ind.id}
                                    type="button"
                                    onClick={() => setSubIndicator(ind.id)}
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                                        subIndicator === ind.id ? 'bg-primary text-primary-foreground' : 'text-faint hover:text-foreground'
                                    }`}
                                >
                                    {ind.label}
                                </button>
                            ))}
                        </div>

                        {totalBars > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-page/40 px-2 py-0.5 rounded border border-line">
                                <MoveHorizontal className="size-3 text-brand-ink" />
                                显示 {visiblePoints.length}/{totalBars} 根 (按住拖放 / 滚轮缩放)
                            </span>
                        )}
                    </div>
                </div>

                {/* SVG 主图与副图区域 */}
                <div className="relative h-[430px] w-full">
                    {loading ? (
                        <div className="flex size-full items-center justify-center text-sm text-faint">
                            正在加载实时蜡烛与行情数据...
                        </div>
                    ) : coords.length > 1 ? (
                        <svg
                            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                            className="size-full overflow-visible select-none cursor-crosshair active:cursor-grabbing"
                            preserveAspectRatio="none"
                            role="img"
                            aria-describedby={chartData ? provenanceId : undefined}
                            tabIndex={0}
                            aria-label={`${symbol} ${timeframe}价格与${subIndicator.toUpperCase()}图。左右方向键查看数据，鼠标滚轮缩放，按住拖动平移。${activeTime} 收盘价 ${activePrice ?? '未提供'}。`}
                            onKeyDown={(event) => {
                                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                                event.preventDefault();
                                const index = activeIdx ?? 0;
                                setHoverIndex(Math.max(0, Math.min(visiblePoints.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1))));
                            }}
                            onBlur={() => setHoverIndex(null)}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={() => {
                                handleMouseUp();
                                setHoverIndex(null);
                            }}
                            onWheel={handleWheel}
                        >
                            <defs>
                                <linearGradient id={`chart-grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
                                    <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
                                </linearGradient>
                            </defs>

                            {/* 1. 主图背景网格与昨收线 */}
                            <line x1={paddingX} y1={paddingY} x2={svgWidth - paddingX} y2={paddingY} stroke="var(--line, #333)" strokeWidth="0.5" strokeDasharray="2 2" />
                            <line x1={paddingX} y1={paddingY + mainH / 2} x2={svgWidth - paddingX} y2={paddingY + mainH / 2} stroke="var(--line, #333)" strokeWidth="0.5" strokeDasharray="2 2" />
                            <line x1={paddingX} y1={paddingY + mainH} x2={svgWidth - paddingX} y2={paddingY + mainH} stroke="var(--line, #333)" strokeWidth="1" />

                            {/* 昨收参考线 */}
                            {prevCloseY != null && (
                                <g>
                                    <line
                                        x1={paddingX}
                                        y1={prevCloseY}
                                        x2={svgWidth - paddingX}
                                        y2={prevCloseY}
                                        stroke="var(--line-strong, #666)"
                                        strokeWidth="1"
                                        strokeDasharray="4 4"
                                    />
                                    <text x={svgWidth - paddingX} y={prevCloseY - 4} fill="var(--faint, #888)" fontSize="10" textAnchor="end" className="mono">
                                        昨收 {chartData?.prevClose?.toFixed(2)}
                                    </text>
                                </g>
                            )}

                            {/* 2. 主图内容：蜡烛线模式 vs 分时折线模式 */}
                            {isCandle ? (
                                <g>
                                    {/* 蜡烛线柱与上下影线 */}
                                    {coords.map((c) => {
                                        const p = c.point;
                                        const isCandleUp = p.close >= (p.open ?? p.close);
                                        const candleColor = isCandleUp ? 'var(--up, #ef4444)' : 'var(--down, #10b981)';
                                        const bodyTop = Math.min(c.yOpen, c.yClose);
                                        const bodyH = Math.max(2, Math.abs(c.yClose - c.yOpen));

                                        return (
                                            <g key={`candle-${c.idx}`}>
                                                <line
                                                    x1={c.x}
                                                    y1={c.yHigh}
                                                    x2={c.x}
                                                    y2={c.yLow}
                                                    stroke={candleColor}
                                                    strokeWidth={Math.max(1, barW * 0.16)}
                                                />
                                                <rect
                                                    x={c.x - barW / 2}
                                                    y={bodyTop}
                                                    width={barW}
                                                    height={bodyH}
                                                    fill={candleColor}
                                                    stroke={candleColor}
                                                    rx="0.5"
                                                />
                                            </g>
                                        );
                                    })}

                                    {/* MA 均线叠加 */}
                                    {ma5Path && <path d={ma5Path} fill="none" stroke="#f59e0b" strokeWidth="1.5" />}
                                    {ma10Path && <path d={ma10Path} fill="none" stroke="#a855f7" strokeWidth="1.5" />}
                                    {ma20Path && <path d={ma20Path} fill="none" stroke="#38bdf8" strokeWidth="1.5" />}
                                    {ma60Path && <path d={ma60Path} fill="none" stroke="#10b981" strokeWidth="1.5" />}

                                    {/* BOLL 布林线叠加 */}
                                    {bollUbPath && <path d={bollUbPath} fill="none" stroke="#a855f7" strokeWidth="1.3" strokeDasharray="3 2" />}
                                    {bollMbPath && <path d={bollMbPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" />}
                                    {bollLbPath && <path d={bollLbPath} fill="none" stroke="#38bdf8" strokeWidth="1.3" strokeDasharray="3 2" />}
                                </g>
                            ) : (
                                <g>
                                    <path d={areaD} fill={`url(#chart-grad-${symbol})`} />
                                    <path
                                        d={priceLineD}
                                        fill="none"
                                        stroke={strokeColor}
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    {avgLineD && (
                                        <path
                                            d={avgLineD}
                                            fill="none"
                                            stroke="#eab308"
                                            strokeWidth="1.5"
                                            strokeDasharray="2 1"
                                        />
                                    )}
                                </g>
                            )}

                            {/* 3. 副图区域：支持 VOL / MACD / KDJ / RSI 四大经典指标切换 */}
                            <g>
                                <line x1={paddingX} y1={subBaseY} x2={svgWidth - paddingX} y2={subBaseY} stroke="var(--line, #333)" strokeWidth="1" />

                                {subIndicator === 'vol' && (
                                    <>
                                        <text x={paddingX} y={subTopY - 6} fill="var(--faint, #888)" fontSize="10" className="mono">
                                            VOL 本K成交量: {formatVol(activeBarVolume, market)}
                                        </text>
                                        {coords.map((c) => {
                                            const p = c.point;
                                            const isCandleUp = p.close >= (p.open ?? p.close);
                                            const volColor = isCandleUp ? 'var(--up, #ef4444)' : 'var(--down, #10b981)';
                                            return (
                                                <rect
                                                    key={`vol-${c.idx}`}
                                                    x={c.x - barW / 2}
                                                    y={c.yVol}
                                                    width={barW}
                                                    height={c.barH}
                                                    fill={volColor}
                                                    opacity={0.85}
                                                />
                                            );
                                        })}
                                    </>
                                )}

                                {subIndicator === 'macd' && macdPaths && (
                                    <>
                                        <text x={paddingX} y={subTopY - 6} fill="var(--faint, #888)" fontSize="10" className="mono">
                                            MACD(12,26,9) · DIF: {activeDif != null ? activeDif.toFixed(2) : '—'} | DEA: {activeDea != null ? activeDea.toFixed(2) : '—'} | MACD柱: {activeMacdH != null ? activeMacdH.toFixed(2) : '—'}
                                        </text>
                                        <line x1={paddingX} y1={macdPaths.midY} x2={svgWidth - paddingX} y2={macdPaths.midY} stroke="var(--line, #444)" strokeWidth="0.8" strokeDasharray="2 2" />
                                        {coords.map((c, i) => {
                                            const hVal = visibleMacdHist[i] || 0;
                                            const yVal = macdPaths.toY(hVal);
                                            const top = Math.min(macdPaths.midY, yVal);
                                            const height = Math.max(1.5, Math.abs(yVal - macdPaths.midY));
                                            const col = hVal >= 0 ? 'var(--up, #ef4444)' : 'var(--down, #10b981)';
                                            return (
                                                <rect
                                                    key={`macd-${c.idx}`}
                                                    x={c.x - Math.max(1.5, barW * 0.6) / 2}
                                                    y={top}
                                                    width={Math.max(1.5, barW * 0.6)}
                                                    height={height}
                                                    fill={col}
                                                    opacity={0.85}
                                                />
                                            );
                                        })}
                                        <path d={macdPaths.difPath} fill="none" stroke="#f8fafc" strokeWidth="1.4" />
                                        <path d={macdPaths.deaPath} fill="none" stroke="#f59e0b" strokeWidth="1.4" />
                                    </>
                                )}

                                {subIndicator === 'kdj' && kdjPaths && (
                                    <>
                                        <text x={paddingX} y={subTopY - 6} fill="var(--faint, #888)" fontSize="10" className="mono">
                                            KDJ(9,3,3) · K(白): {activeK != null ? activeK.toFixed(1) : '—'} | D(黄): {activeD != null ? activeD.toFixed(1) : '—'} | J(紫): {activeJ != null ? activeJ.toFixed(1) : '—'}
                                        </text>
                                        <line x1={paddingX} y1={kdjPaths.y80} x2={svgWidth - paddingX} y2={kdjPaths.y80} stroke="var(--line, #444)" strokeWidth="0.6" strokeDasharray="3 3" />
                                        <line x1={paddingX} y1={kdjPaths.y20} x2={svgWidth - paddingX} y2={kdjPaths.y20} stroke="var(--line, #444)" strokeWidth="0.6" strokeDasharray="3 3" />
                                        <path d={kdjPaths.kPath} fill="none" stroke="#f8fafc" strokeWidth="1.4" />
                                        <path d={kdjPaths.dPath} fill="none" stroke="#f59e0b" strokeWidth="1.4" />
                                        <path d={kdjPaths.jPath} fill="none" stroke="#a855f7" strokeWidth="1.4" />
                                    </>
                                )}

                                {subIndicator === 'rsi' && rsiPaths && (
                                    <>
                                        <text x={paddingX} y={subTopY - 6} fill="var(--faint, #888)" fontSize="10" className="mono">
                                            RSI(6,12,24) · RSI6: {activeR6 != null ? activeR6.toFixed(1) : '—'} | RSI12: {activeR12 != null ? activeR12.toFixed(1) : '—'} | RSI24: {activeR24 != null ? activeR24.toFixed(1) : '—'}
                                        </text>
                                        <line x1={paddingX} y1={rsiPaths.y70} x2={svgWidth - paddingX} y2={rsiPaths.y70} stroke="var(--line, #444)" strokeWidth="0.6" strokeDasharray="3 3" />
                                        <line x1={paddingX} y1={rsiPaths.y30} x2={svgWidth - paddingX} y2={rsiPaths.y30} stroke="var(--line, #444)" strokeWidth="0.6" strokeDasharray="3 3" />
                                        {rsiPaths.r6Path && <path d={rsiPaths.r6Path} fill="none" stroke="#f8fafc" strokeWidth="1.4" />}
                                        {rsiPaths.r12Path && <path d={rsiPaths.r12Path} fill="none" stroke="#f59e0b" strokeWidth="1.4" />}
                                        {rsiPaths.r24Path && <path d={rsiPaths.r24Path} fill="none" stroke="#a855f7" strokeWidth="1.4" />}
                                    </>
                                )}
                            </g>

                            {/* 4. 十字准星与悬停吸附 */}
                            {hoverIndex != null && coords[hoverIndex] && (
                                <g pointerEvents="none">
                                    <line
                                        x1={coords[hoverIndex].x}
                                        y1={paddingY}
                                        x2={coords[hoverIndex].x}
                                        y2={subBaseY}
                                        stroke="var(--line-strong, #888)"
                                        strokeWidth="1"
                                        strokeDasharray="3 3"
                                    />
                                    <line
                                        x1={paddingX}
                                        y1={coords[hoverIndex].yClose}
                                        x2={svgWidth - paddingX}
                                        y2={coords[hoverIndex].yClose}
                                        stroke="var(--line-strong, #888)"
                                        strokeWidth="1"
                                        strokeDasharray="3 3"
                                    />
                                    <circle
                                        cx={coords[hoverIndex].x}
                                        cy={coords[hoverIndex].yClose}
                                        r="4"
                                        fill={coords[hoverIndex].point.close >= (coords[hoverIndex].point.open ?? coords[hoverIndex].point.close) ? 'var(--up, #ef4444)' : 'var(--down, #10b981)'}
                                        stroke="var(--page, #000)"
                                        strokeWidth="2"
                                    />
                                </g>
                            )}

                            {/* 5. 交互悬停透明热区 */}
                            {coords.map((c, i) => {
                                const step = innerW / Math.max(1, coords.length - 1);
                                const rectX = Math.max(0, c.x - step / 2);
                                return (
                                    <rect
                                        key={`hit-${i}`}
                                        x={rectX}
                                        y={0}
                                        width={step}
                                        height={svgHeight}
                                        fill="transparent"
                                        className="cursor-crosshair"
                                        onMouseEnter={() => {
                                            if (!isDragging.current) {
                                                setHoverIndex(i);
                                            }
                                        }}
                                    />
                                );
                            })}
                        </svg>
                    ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-faint">
                            <p>{!supported ? '该标的暂不支持此周期，请切换至其他时段查看。' : error?.message ?? '该标的暂无此周期行情数据，请切换至其他时段查看。'}</p>
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}
