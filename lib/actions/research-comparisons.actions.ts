'use server';

import { connectToDatabase } from '@/database/mongoose';
import { ResearchComparisonRecord, type IResearchComparison } from '@/database/models/research-comparison.model';
import { Watchlist } from '@/database/models/watchlist.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { PeerGroupInputError, canonicalPeerMember } from '@/lib/market/daily-research';
import { getSymbolAliases } from '@/lib/utils';
import { withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';
import type { ObservationRevision } from '@/lib/watchlist-review';
import { getDailyResearch } from '@/lib/actions/relative-history.actions';
import {
    ComparisonError, comparisonDrafts, DAILY_RESEARCH_ALGORITHM_VERSION, normalizeComparisonObservation, validateResearchComparisonPayload, validateSaveComparisonInput,
    type ComparisonActionResult, type ComparisonObservationReference, type ComparisonSummary, type DailyResearchDraftResult,
    type SavedResearchComparison, type SaveResearchComparisonInput,
} from '@/lib/research-comparisons';

async function safe<T>(operation: () => Promise<T>): Promise<ComparisonActionResult<T>> {
    try { return { ok: true, value: await operation() }; }
    catch (error) {
        if (error instanceof ComparisonError) return { ok: false, error: { code: error.code, message: error.message } };
        if (error instanceof PeerGroupInputError) return { ok: false, error: { code: 'INVALID_INPUT', message: error.message } };
        return { ok: false, error: { code: 'REQUEST_FAILED', message: '请求未完成，请确认登录与资料维护状态后重试。保存结果不明时请保留原请求重试。' } };
    }
}
function checkId(id: string) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new ComparisonError('INVALID_ID', '对照编号或分页游标无效');
}
function serialize(row: IResearchComparison): SavedResearchComparison {
    return {
        id: String(row._id), savedAt: row.savedAt.toISOString(), caption: row.caption, algorithmVersion: row.algorithmVersion,
        result: row.result, originalSeries: row.originalSeries,
        ...(row.observationReference ? { observationReference: row.observationReference, originalObservation: row.originalObservation } : {}),
    };
}
function sameRequest(row: IResearchComparison, input: SaveResearchComparisonInput) {
    const previous = row.observationReference;
    const next = input.observationReference;
    return row.draftId === input.draftId && row.caption === input.caption
        && Boolean(previous) === Boolean(next) && previous?.symbolId === next?.symbolId
        && previous?.observationId === next?.observationId && previous?.version === next?.version;
}
async function latestObservations(userId: string, symbol: string, observationId?: string): Promise<ObservationRevision[]> {
    const rows = await Watchlist.aggregate([
        { $match: { userId, symbol: { $in: getSymbolAliases(symbol) } } }, { $unwind: '$journal' },
        { $match: { 'journal.kind': 'observation', ...(observationId ? { 'journal.id': observationId } : {}) } },
        { $replaceRoot: { newRoot: '$journal' } }, { $sort: { recordedAt: -1, id: -1 } }, { $limit: 1 },
    ]);
    return rows.map(normalizeComparisonObservation);
}

/** The UI uses a serialized error envelope; expected failures survive production action redaction. */
export async function getDailyResearchDraft(input: Parameters<typeof getDailyResearch>[0]): Promise<ComparisonActionResult<DailyResearchDraftResult>> {
    return safe(async () => getDailyResearch(input));
}

/** Optional original judgment selection is read-only and never creates a parallel journal. */
export async function getComparisonObservation(draftId: string, symbol: string): Promise<ComparisonActionResult<{ reference: ComparisonObservationReference; original: ObservationRevision }>> {
    return safe(async () => {
        const userId = await requireUserId();
        const draft = comparisonDrafts.read(userId, draftId);
        const member = draft.result.rows.find(row => row.symbol === symbol);
        if (!member) throw new ComparisonError('INVALID_INPUT', '原判断须属于本次对照成员');
        const [original] = await withWatchlistLifecycle(userId, { operation: 'comparison-observation', readOnly: true }, () => latestObservations(userId, symbol));
        if (!original) throw new ComparisonError('NO_OBSERVATION', '该标的尚无已留存的观点版本；可先独立保存对照，或在研究记录中保存观点后重新选择。');
        return { reference: { symbolId: member.symbolId, observationId: original.id, version: original.recordedAt }, original };
    });
}

/** Save only the issued draft. No history fetch, client numbers or current membership lookup. */
export async function saveResearchComparison(raw: SaveResearchComparisonInput): Promise<ComparisonActionResult<SavedResearchComparison>> {
    return safe(async () => {
        const userId = await requireUserId();
        const input = validateSaveComparisonInput(raw);
        await connectToDatabase();
        const lookup = { userId, $or: [{ requestId: input.requestId }, { draftId: input.draftId }] };
        const retry = await ResearchComparisonRecord.findOne(lookup).lean();
        if (retry) {
            if (!sameRequest(retry, input)) throw new ComparisonError('REQUEST_CONFLICT', '该请求或对照版本已保存为另一份内容，请读取已保存依据核对。');
            return serialize(retry);
        }
        const draft = comparisonDrafts.read(userId, input.draftId);
        const persist = async (originalObservation?: ObservationRevision) => {
            const payload = validateResearchComparisonPayload({ caption: input.caption, algorithmVersion: DAILY_RESEARCH_ALGORITHM_VERSION, ...draft,
                ...(input.observationReference ? { observationReference: input.observationReference, originalObservation } : {}) });
            const savedAt = new Date();
            try {
                return serialize(await ResearchComparisonRecord.create({ ...payload, userId, requestId: input.requestId, draftId: input.draftId, createdAt: savedAt, savedAt }));
            } catch (error) {
                if ((error as { code?: number }).code !== 11000) throw error;
                const saved = await ResearchComparisonRecord.findOne(lookup).lean();
                if (!saved || !sameRequest(saved, input)) throw new ComparisonError('REQUEST_CONFLICT', '并发请求已保存不同内容，请读取已保存依据核对。');
                return serialize(saved);
            }
        };
        if (!input.observationReference) return persist();
        const ref = input.observationReference;
        const member = draft.result.rows.find(row => row.symbolId === ref.symbolId);
        if (!member) throw new ComparisonError('INVALID_REFERENCE', '原判断须属于本次对照成员');
        // Hold the existing owner lock through the save so an observation edit cannot slip
        // between version verification and persistence. No journal/watchlist mutation occurs.
        return withWatchlistLifecycle(userId, { operation: 'comparison-observation', readOnly: true }, async () => {
            const [original] = await latestObservations(userId, member.symbol, ref.observationId);
            if (!original || original.recordedAt !== ref.version) throw new ComparisonError('INVALID_REFERENCE', '未找到当前账户的原判断版本');
            const [latest] = await latestObservations(userId, member.symbol);
            if (latest?.id !== original.id && !input.confirmOriginalObservation) throw new ComparisonError('RESEARCH_CHANGED', '原判断在编辑期间已有新版本。请核对原文，并明确确认仍引用旧版本后保存。');
            return persist(original);
        });
    });
}

export async function getResearchComparison(id: string): Promise<ComparisonActionResult<SavedResearchComparison>> {
    return safe(async () => {
        const userId = await requireUserId(); checkId(id); await connectToDatabase();
        const row = await ResearchComparisonRecord.findOne({ _id: id, userId }).lean();
        if (!row) throw new ComparisonError('NOT_FOUND', '未找到当前账户的已保存对照');
        return serialize(row);
    });
}
export async function listResearchComparisons(options: { cursor?: string; limit?: number; symbol?: string } = {}): Promise<ComparisonActionResult<{ entries: ComparisonSummary[]; nextCursor?: string }>> {
    return safe(async () => {
        const userId = await requireUserId();
        const limit = options.limit ?? 10;
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ComparisonError('INVALID_INPUT', '每页须为 1–50 份');
        if (options.cursor !== undefined) checkId(options.cursor);
        const symbolId = options.symbol === undefined ? undefined : canonicalPeerMember(options.symbol).symbolId;
        await connectToDatabase();
        const rows = await ResearchComparisonRecord.find({ userId, ...(options.cursor ? { _id: { $lt: options.cursor } } : {}), ...(symbolId ? { 'result.rows.symbolId': symbolId } : {}) })
            .select({ caption: 1, savedAt: 1, algorithmVersion: 1, 'result.benchmarkSymbol': 1, 'result.fetchedAt': 1, 'result.group.name': 1, 'result.rows.symbol': 1 })
            .sort({ _id: -1 }).limit(limit + 1).lean();
        return { entries: rows.slice(0, limit).map(row => ({ id: String(row._id), savedAt: row.savedAt.toISOString(), caption: row.caption,
            algorithmVersion: row.algorithmVersion, benchmarkSymbol: row.result.benchmarkSymbol, symbols: row.result.rows.map(member => member.symbol),
            fetchedAt: row.result.fetchedAt, ...(row.result.group ? { groupName: row.result.group.name } : {}) })),
        ...(rows.length > limit ? { nextCursor: String(rows[limit - 1]._id) } : {}) };
    });
}
