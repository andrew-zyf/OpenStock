'use server';

import { getUnifiedChartSeries } from '@/lib/actions/realtime-market.actions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { compareRelativeHistory, getHistoricalBenchmarkOptions, relativeHistoryUnavailableReason, type RelativeHistoryComparison } from '@/lib/market/relative-history';
import {
    canonicalPeerMember, compareDailyResearch, compareDailyVolume, completedDailyPoints, createDailyHistoryLoader,
    dailyPairReason, dailySupportReason, DAILY_RESEARCH_LIMIT, type DailyResearchResult, type PeerMember,
} from '@/lib/market/daily-research';

import { ComparisonError, comparisonDrafts, type DailyResearchDraftResult } from '@/lib/research-comparisons';

const loadDailyHistory = createDailyHistoryLoader(symbol => getUnifiedChartSeries(symbol, '3m'));

/** Exactly two targeted daily-history requests, in parallel; the adapter also bounds each upstream. */
export async function getRelativeHistoryComparison(symbol: string, benchmarkSymbol: string, currency?: string): Promise<RelativeHistoryComparison> {
    const reason = relativeHistoryUnavailableReason(symbol, benchmarkSymbol, currency);
    if (reason) return { status: 'unavailable', reason };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const [stock, benchmark] = await Promise.race([
            Promise.all([
                getUnifiedChartSeries(identifyMarketAndCode(symbol).normalizedSymbol, '1m'),
                getUnifiedChartSeries(identifyMarketAndCode(benchmarkSymbol).normalizedSymbol, '1m'),
            ]),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('历史来源请求超时，请稍后重试')), 7_000);
            }),
        ]);
        // Throw on refresh failure so useMarketResource retains its last successful snapshot.
        if (!stock || !benchmark) throw new Error('标的或基准历史来源暂不可用，请稍后重试');
        return compareRelativeHistory(symbol, stock, benchmarkSymbol, benchmark, currency);
    } finally {
        clearTimeout(timer);
    }
}

/** Explicit user request only: at most 20 rows plus one shared benchmark, no SSR fan-out. */
export async function getDailyResearch(input: { scope: 'watched' | 'group'; groupId?: string; benchmarkSymbol: string }): Promise<DailyResearchDraftResult> {
    const { requireUserId } = await import('@/lib/better-auth/auth');
    const userId = await requireUserId();
    if (!input || !['watched', 'group'].includes(input.scope) || typeof input.benchmarkSymbol !== 'string' || input.benchmarkSymbol.length > 25) throw new ComparisonError('INVALID_INPUT', '比较范围无效');
    const benchmarkSymbol = identifyMarketAndCode(input.benchmarkSymbol).normalizedSymbol;
    const benchmarkMarket = identifyMarketAndCode(benchmarkSymbol).market;
    const representative = benchmarkMarket === 'cn' ? '000001.SZ' : '00700.HK';
    if (dailySupportReason(benchmarkSymbol) || !getHistoricalBenchmarkOptions(representative).some(option => option.symbol === benchmarkSymbol)) throw new ComparisonError('INVALID_INPUT', '请选择受支持的明确基准');
    const group = input.scope === 'group' ? await (await import('@/lib/actions/peer-groups.actions')).getPeerGroup(input.groupId ?? '') : undefined;
    let members: PeerMember[];
    if (group) members = group.members;
    else {
        const [{ Watchlist }, { withWatchlistLifecycle }] = await Promise.all([import('@/database/models/watchlist.model'), import('@/lib/watchlist-lifecycle')]);
        const watched = await withWatchlistLifecycle(userId, { operation: 'daily-research-membership', readOnly: true }, async () =>
            Watchlist.find({ userId, archivedAt: null }).select({ symbol: 1 }).sort({ addedAt: 1, _id: 1 }).limit(100).lean());
        members = [...new Map(watched.flatMap(row => {
            try { const member = canonicalPeerMember(row.symbol); return [[member.symbolId, member] as const]; }
            catch { return []; }
        })).values()];
    }
    const eligible = members.filter(member => !dailySupportReason(member.symbol) && identifyMarketAndCode(member.symbol).market === benchmarkMarket);
    const selected = (group ? members : eligible).slice(0, DAILY_RESEARCH_LIMIT);
    const omittedMembers = members.filter(member => !selected.some(row => row.symbolId === member.symbolId));
    const symbols = [...new Set([...selected.filter(member => eligible.some(row => row.symbolId === member.symbolId)).map(member => member.symbol), ...(eligible.length ? [benchmarkSymbol] : [])])];
    const histories = new Map(await Promise.all(symbols.map(async symbol => [symbol, await loadDailyHistory(symbol)] as const)));
    const benchmark = histories.get(benchmarkSymbol) ?? null;
    const now = new Date();
    // Every included compatible member uses the same actual dates. Failed/mismatched members
    // remain disclosed rows; no current sector membership is ever queried or backfilled.
    const aligned = selected.flatMap(member => {
        const series = histories.get(member.symbol) ?? null;
        if (dailyPairReason(member.symbol, series, benchmarkSymbol, benchmark)) return [];
        const points = completedDailyPoints(series!, now);
        return points ? [points] : [];
    });
    const benchmarkPoints = benchmark && completedDailyPoints(benchmark, now);
    const commonDates = benchmarkPoints && aligned.length ? [...benchmarkPoints.keys()].filter(date => aligned.every(points => points.has(date))) : [];
    const rows = selected.map(member => {
        const series = histories.get(member.symbol) ?? null;
        return { ...member, comparison: compareDailyResearch(member.symbol, series, benchmarkSymbol, benchmark, now, commonDates), volume: compareDailyVolume(member.symbol, series, now) };
    });
    const result: DailyResearchResult = { scope: input.scope, group, benchmarkSymbol, rows, omittedMembers, commonDates: commonDates.slice(-21), fetchedAt: now.toISOString() };
    const originalSeries = [...histories].map(([symbol, series]) => ({ symbol, series }));
    // Store the exact server result before crossing the client boundary; saving only sends
    // this opaque owner-bound draft id and never re-requests or trusts client prices/sources.
    const draft = comparisonDrafts.issue(userId, result, originalSeries);
    return { ...result, draft };
}
