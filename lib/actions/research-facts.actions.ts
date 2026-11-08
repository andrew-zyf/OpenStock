'use server';

import { createHash, randomUUID } from 'node:crypto';
import { BSON } from 'mongodb';
import { connectToDatabase } from '@/database/mongoose';
import { ResearchFact, type StoredResearchFact } from '@/database/models/research-fact.model';
import { Watchlist, type WatchlistItem } from '@/database/models/watchlist.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { getSymbolAliases } from '@/lib/utils';
import { observationState, type ObservationRevision } from '@/lib/watchlist-review';
import {
    FACT_PAGE_MAX, FACT_RECORD_BSON_LIMIT, factId, factSymbol, factTimestamp, researchFactFingerprint, validateCreateResearchFact,
    type CreateResearchFactInput, type FactObservationChoice, type FactObservationReference,
    type FactObservationSnapshot, type ResearchFactPage, type ResearchFactRecord,
    type ResearchFactActionCode, type ResearchFactActionResult,
} from '@/lib/research-facts';

class FactActionError extends Error {
    constructor(readonly code: ResearchFactActionCode, message: string) { super(message); }
}
const PUBLIC_MESSAGES: Record<ResearchFactActionCode, string> = {
    INVALID_INPUT: '事实字段或分页参数无效，请核对标的、类型、来源链接、含时区时间与必填内容；输入仍保留。',
    REQUEST_CONFLICT: '请求标识已用于其他事实内容，请重新提交；输入仍保留。',
    OBSERVATION_NOT_FOUND: '未找到当前账户与标的的原判断版本，请重新读取并选择；输入仍保留。',
    STALE_OBSERVATION: '原判断版本已变化，请重新读取并选择；输入仍保留。',
    PARENT_NOT_FOUND: '未找到当前账户与标的的原事实，请重新读取后核对；输入仍保留。',
    CORRECTION_CONFLICT: '原事实已有更正，请重新读取最新事实后追加；输入仍保留。',
    CAPACITY: '关联原判断使事实记录超过单条容量限制，本次未保存；原文与输入仍保留，可核对后独立登记事实。',
    UNAVAILABLE: '事实操作暂时失败，请重新读取核对后重试；已显示资料与输入仍保留。',
};
function checked<T>(validate: () => T): T {
    try { return validate(); }
    catch (error) { throw new FactActionError('INVALID_INPUT', error instanceof Error ? error.message : '无效的事实字段'); }
}
async function safeFactAction<T>(operation: () => Promise<T>): Promise<ResearchFactActionResult<T>> {
    try { return { ok: true, value: await operation() }; }
    catch (error) {
        const code = error instanceof FactActionError ? error.code : 'UNAVAILABLE';
        return { ok: false, error: { code, message: PUBLIC_MESSAGES[code] } };
    }
}

function publicFact(fact: StoredResearchFact): ResearchFactRecord {
    return {
        id: fact.id, symbol: fact.symbol, market: fact.market, exchangeId: fact.exchangeId,
        factType: fact.factType, reportingPeriod: fact.reportingPeriod, title: fact.title, factText: fact.factText,
        sourceUrl: fact.sourceUrl, sourcePublishedAt: fact.sourcePublishedAt,
        assessment: fact.assessment, assessmentNote: fact.assessmentNote, createdAt: fact.createdAt.toISOString(),
        registrationMethod: 'manual', observationSnapshot: fact.observationSnapshot,
        correctionOf: fact.correctionOf, correctionReason: fact.correctionReason, rootId: fact.rootId, version: fact.version,
    };
}
function retry(saved: StoredResearchFact | null, fingerprint: string): ResearchFactRecord | undefined {
    if (!saved) return undefined;
    if (saved.createFingerprint !== fingerprint) throw new FactActionError('REQUEST_CONFLICT', '请求标识已用于其他事实内容，请重新提交');
    return publicFact(saved);
}
function digest(snapshot: FactObservationSnapshot): string {
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
function iso(value: Date | string | null | undefined): string | null {
    return value == null ? null : new Date(value).toISOString();
}
type ObservationRecord = Pick<WatchlistItem, 'symbol' | 'journalVersion' | 'observationUpdatedAt' | 'archivedAt' | 'group' | 'note' | 'invalidation' | 'targetPrice' | 'reviewStatus' | 'reviewedAt' | 'nextReviewDate' | 'proximityPercent'> & { _id: unknown };
function snapshot(record: ObservationRecord, revision?: ObservationRevision): FactObservationSnapshot {
    return {
        recordId: String(record._id), sourceSymbol: record.symbol, revisionId: revision?.id ?? null,
        journalVersion: record.journalVersion ?? 0,
        observationUpdatedAt: revision ? revision.modifiedAt : iso(record.observationUpdatedAt),
        archivedAt: iso(record.archivedAt),
        observation: observationState(revision ? revision.observation : {
            group: record.group ?? undefined, note: record.note ?? undefined, invalidation: record.invalidation ?? undefined,
            targetPrice: record.targetPrice ?? undefined, reviewStatus: record.reviewStatus ?? 'watching',
            reviewedAt: iso(record.reviewedAt) ?? undefined, nextReviewDate: record.nextReviewDate ?? undefined,
            proximityPercent: record.proximityPercent ?? undefined,
        }),
    };
}
function choice(saved: FactObservationSnapshot): FactObservationChoice {
    return { snapshot: saved, reference: { recordId: saved.recordId, revisionId: saved.revisionId,
        journalVersion: saved.journalVersion, stateFingerprint: digest(saved) } };
}

/** Optional choices include active AND archived raw records. No watchlist row is created or modified. */
export async function getFactObservationChoices(symbol: string): Promise<FactObservationChoice[]> {
    const userId = await requireUserId();
    const canonical = checked(() => factSymbol(symbol));
    await connectToDatabase();
    const records = await Watchlist.find({ userId, symbol: { $in: getSymbolAliases(canonical) } })
        .select('+journal').slice('journal', -FACT_PAGE_MAX).limit(20).lean();
    const choices: FactObservationChoice[] = [];
    for (const record of records) {
        choices.push(choice(snapshot(record)));
        for (const revision of [...(record.journal ?? [])].reverse()) {
            if (revision.kind === 'observation') choices.push(choice(snapshot(record, revision)));
            if (choices.length >= FACT_PAGE_MAX) break;
        }
        if (choices.length >= FACT_PAGE_MAX) break;
    }
    return choices.slice(0, FACT_PAGE_MAX);
}
async function resolveObservation(userId: string, symbol: string, ref: FactObservationReference): Promise<FactObservationSnapshot> {
    // The exact record, owner and canonical identity are checked together, including archived rows.
    const record = await Watchlist.findOne({ _id: ref.recordId, userId, symbol: { $in: getSymbolAliases(symbol) } })
        .select(ref.revisionId ? { journal: { $elemMatch: { kind: 'observation', id: ref.revisionId } },
            symbol: 1, journalVersion: 1, archivedAt: 1, observationUpdatedAt: 1 } : '-journal').lean();
    if (!record) throw new FactActionError('OBSERVATION_NOT_FOUND', '未找到当前账户与标的的原判断');
    const revision = ref.revisionId ? record.journal?.find((entry): entry is ObservationRevision => entry.kind === 'observation' && entry.id === ref.revisionId) : undefined;
    if (ref.revisionId && !revision) throw new FactActionError('OBSERVATION_NOT_FOUND', '未找到原判断版本');
    const saved = snapshot(record, revision);
    if (saved.journalVersion !== ref.journalVersion || digest(saved) !== ref.stateFingerprint) throw new FactActionError('STALE_OBSERVATION', '原判断版本已变化，请重新读取并选择；输入仍保留');
    return saved;
}

/** Owner-validated journal evidence lookup; an immutable historical correction remains valid evidence. */
export async function getResearchFactById(id: string, symbol?: string): Promise<ResearchFactRecord | null> {
    const userId = await requireUserId();
    checked(() => factId(id));
    const canonical = symbol === undefined ? undefined : checked(() => factSymbol(symbol));
    await connectToDatabase();
    const fact = await ResearchFact.findOne({ userId, id, ...(canonical ? { symbol: canonical } : {}) }).lean();
    return fact ? publicFact(fact) : null;
}

export async function getResearchFacts(options: { symbol?: string; cursor?: string; limit?: number } = {}): Promise<ResearchFactPage> {
    const userId = await requireUserId();
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => !['symbol', 'cursor', 'limit'].includes(key))) throw new FactActionError('INVALID_INPUT', '无效的事实分页参数');
    const symbol = options.symbol === undefined ? undefined : checked(() => factSymbol(options.symbol));
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > FACT_PAGE_MAX) throw new FactActionError('INVALID_INPUT', `每页最多 ${FACT_PAGE_MAX} 条事实`);
    let after: { createdAt: Date; id: string } | undefined;
    if (options.cursor !== undefined) {
        try {
            if (typeof options.cursor !== 'string' || options.cursor.length > 300) throw new Error();
            const cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
            if (!cursor || Object.keys(cursor).sort().join(',') !== 'createdAt,id,symbol' || cursor.symbol !== (symbol ?? null)) throw new Error();
            after = { createdAt: new Date(factTimestamp(cursor.createdAt)), id: factId(cursor.id) };
        } catch { throw new FactActionError('INVALID_INPUT', '无效的事实分页游标'); }
    }
    await connectToDatabase();
    const facts = await ResearchFact.find({ userId, ...(symbol ? { symbol } : {}), ...(after ? { $or: [
        { createdAt: { $lt: after.createdAt } }, { createdAt: after.createdAt, id: { $lt: after.id } },
    ] } : {}) }).sort({ createdAt: -1, id: -1 }).limit(limit + 1).lean();
    const page = facts.slice(0, limit).map(publicFact);
    const last = page.at(-1);
    return { facts: page, ...(facts.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id, symbol: symbol ?? null })).toString('base64url') } : {}) };
}

/** Append only: a correction inserts a new immutable version and never rewrites the original evidence. */
export async function createResearchFact(input: CreateResearchFactInput): Promise<ResearchFactRecord> {
    const userId = await requireUserId();
    const value = checked(() => validateCreateResearchFact(input));
    const fingerprint = researchFactFingerprint(value);
    await connectToDatabase();
    const duplicate = retry(await ResearchFact.findOne({ userId, clientRequestId: value.clientRequestId }).lean(), fingerprint);
    if (duplicate) return duplicate;
    const parent = value.correctionOf ? await ResearchFact.findOne({ userId, id: value.correctionOf, symbol: value.symbol }).lean() : null;
    if (value.correctionOf && !parent) throw new FactActionError('PARENT_NOT_FOUND', '未找到当前账户与标的的原事实');
    if (parent && await ResearchFact.findOne({ userId, correctionOf: parent.id }).lean()) {
        // The winner may have completed after our initial retry read but before this parent read.
        const winner = retry(await ResearchFact.findOne({ userId, clientRequestId: value.clientRequestId }).lean(), fingerprint);
        if (winner) return winner;
        throw new FactActionError('CORRECTION_CONFLICT', '原事实已有更正，请读取最新版本后追加');
    }
    const observationSnapshot = value.observationReference ? await resolveObservation(userId, value.symbol, value.observationReference) : parent?.observationSnapshot ?? null;
    const identity = identifyMarketAndCode(value.symbol);
    const id = randomUUID();
    const fact: StoredResearchFact = {
        userId, id, symbol: value.symbol, market: identity.market, exchangeId: identity.exchangeId,
        factType: value.factType, reportingPeriod: value.reportingPeriod, title: value.title, factText: value.factText,
        sourceUrl: value.sourceUrl, sourcePublishedAt: value.sourcePublishedAt, createdAt: new Date(), registrationMethod: 'manual',
        assessment: value.assessment, assessmentNote: value.assessmentNote, observationSnapshot,
        correctionOf: value.correctionOf ?? null, correctionReason: value.correctionReason ?? null,
        rootId: parent?.rootId ?? id, version: parent ? parent.version + 1 : 1,
        clientRequestId: value.clientRequestId, createFingerprint: fingerprint,
    };
    // Bound the complete BSON record, including the original snapshot and request metadata.
    if (BSON.calculateObjectSize({ ...fact, _id: new BSON.ObjectId() }) > FACT_RECORD_BSON_LIMIT) throw new FactActionError('CAPACITY', PUBLIC_MESSAGES.CAPACITY);
    try {
        await ResearchFact.create(fact);
        return publicFact(fact);
    } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const winner = retry(await ResearchFact.findOne({ userId, clientRequestId: value.clientRequestId }).lean(), fingerprint);
        if (winner) return winner;
        if (parent && await ResearchFact.findOne({ userId, correctionOf: parent.id }).lean()) throw new FactActionError('CORRECTION_CONFLICT', '原事实已有更正，请读取最新版本后追加');
        throw error;
    }
}

/** UI boundaries return static serializable errors; production server actions may redact thrown Error messages. */
export async function createResearchFactForUI(input: CreateResearchFactInput): Promise<ResearchFactActionResult<ResearchFactRecord>> {
    return safeFactAction(() => createResearchFact(input));
}
export async function getFactObservationChoicesForUI(symbol: string): Promise<ResearchFactActionResult<FactObservationChoice[]>> {
    return safeFactAction(() => getFactObservationChoices(symbol));
}
export async function getResearchFactByIdForUI(id: string, symbol?: string): Promise<ResearchFactActionResult<ResearchFactRecord | null>> {
    return safeFactAction(() => getResearchFactById(id, symbol));
}
export async function getResearchFactsForUI(options: { symbol?: string; cursor?: string; limit?: number } = {}): Promise<ResearchFactActionResult<ResearchFactPage>> {
    return safeFactAction(() => getResearchFacts(options));
}
