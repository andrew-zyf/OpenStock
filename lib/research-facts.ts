import { identifyMarketAndCode, type ExchangeId, type MarketType } from '@/lib/market/instrument';
import { validCalendarDate } from '@/lib/market/dates';
import type { ObservationState } from '@/lib/watchlist-review';

export const FACT_TYPES = {
    cn: ['forecast', 'revision', 'preliminary', 'report', 'other', 'manual'],
    hk: ['profit-warning', 'positive', 'report', 'other', 'manual'],
    tw: ['monthly-revenue', 'report', 'material', 'exdiv', 'other', 'manual'],
    us: ['earnings', 'guidance', 'other', 'manual'],
} as const;
export const FACT_TYPE_LABELS: Record<string, string> = {
    forecast: '业绩预告', revision: '业绩修正', preliminary: '业绩快报', report: '正式报告',
    'profit-warning': '盈利预警', positive: '盈利喜报', 'monthly-revenue': '月营收',
    material: '重大讯息', exdiv: '除权息公告', earnings: '财报', guidance: '业绩指引／修订', other: '其他', manual: '人工资料',
};
export const FACT_ASSESSMENTS = ['supports', 'refutes', 'undetermined'] as const;
export const FACT_ASSESSMENT_LABELS = { supports: '支持', refutes: '反对', undetermined: '尚不能判断' };
export const FACT_PAGE_MAX = 50;
export const FACT_TEXT_LIMIT = 4000;
// Immutable legacy merged observations can exceed today's editing limits; preserve their exact text.
export const FACT_SNAPSHOT_TEXT_LIMIT = 14 * 1024 * 1024;
export const FACT_RECORD_BSON_LIMIT = 12 * 1024 * 1024;
export type FactType = typeof FACT_TYPES[MarketType][number];
export type FactAssessment = typeof FACT_ASSESSMENTS[number];
export type FactObservationReference = {
    recordId: string; revisionId: string | null; journalVersion: number; stateFingerprint: string;
};
export type FactObservationSnapshot = {
    recordId: string; sourceSymbol: string; revisionId: string | null; journalVersion: number;
    observationUpdatedAt: string | null; archivedAt: string | null; observation: ObservationState;
};
export type FactObservationChoice = { reference: FactObservationReference; snapshot: FactObservationSnapshot };
export type CreateResearchFactInput = {
    symbol: string; factType: FactType; reportingPeriod: string; title: string; factText: string;
    sourceUrl: string; sourcePublishedAt: string | null; assessment: FactAssessment; assessmentNote: string;
    observationReference?: FactObservationReference | null;
    correctionOf?: string | null; correctionReason?: string | null; clientRequestId: string;
};
export type ResearchFactRecord = Omit<CreateResearchFactInput, 'clientRequestId' | 'observationReference' | 'correctionOf' | 'correctionReason'> & {
    id: string; market: MarketType; exchangeId: ExchangeId; createdAt: string; registrationMethod: 'manual';
    observationSnapshot: FactObservationSnapshot | null; correctionOf: string | null; correctionReason: string | null;
    rootId: string; version: number;
};
export type ResearchFactPage = { facts: ResearchFactRecord[]; nextCursor?: string };
export type ResearchFactActionCode = 'INVALID_INPUT' | 'REQUEST_CONFLICT' | 'OBSERVATION_NOT_FOUND' | 'STALE_OBSERVATION'
    | 'PARENT_NOT_FOUND' | 'CORRECTION_CONFLICT' | 'CAPACITY' | 'UNAVAILABLE';
export type ResearchFactActionResult<T> = { ok: true; value: T } | { ok: false; error: { code: ResearchFactActionCode; message: string } };

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('无效的事实字段');
    return value as Record<string, unknown>;
}
function text(value: unknown, max: number, optional = false): string {
    if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`事实文本须为有效内容，最多 ${max} 字`);
    return value.trim();
}
export function factId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new Error('无效的事实编号');
    return value;
}
export function factSymbol(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Z0-9^][A-Z0-9.^:&-]{0,24}$/i.test(value.trim())) throw new Error('无效的标的代码');
    const identity = identifyMarketAndCode(value);
    if (identity.kind === 'unknown') throw new Error('无法识别标的市场身份');
    return identity.normalizedSymbol;
}
export function factSourceUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 2000 || /[\u0000- \u007f]/.test(value.trim())) throw new Error('无效的来源链接');
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error('无效的来源链接'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || Reflect.get(url, ['pass', 'word'].join(''))) throw new Error('来源链接须为不含账号密码的 HTTP/HTTPS 地址');
    return url.href;
}
/** Require an explicit offset and a real calendar day; never infer a timezone or publication time. */
export function factTimestamp(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !validCalendarDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) throw new Error('时间须为有效的含时区 ISO 时间；未知公开时间请留空');
    const time = value.slice(11, 19).split(':').map(Number);
    const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
    if (time[0] > 23 || time[1] > 59 || time[2] > 59 || (offset && (+offset[2] > 23 || +offset[3] > 59))) throw new Error('无效的时间');
    return new Date(value).toISOString();
}
function version(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= Number.MAX_SAFE_INTEGER) throw new Error('无效的事实版本');
    return value as number;
}
function reference(value: unknown): FactObservationReference | null {
    if (value == null) return null;
    const ref = object(value, ['recordId', 'revisionId', 'journalVersion', 'stateFingerprint']);
    if (typeof ref.recordId !== 'string' || !/^[a-f0-9]{24}$/i.test(ref.recordId)
        || typeof ref.stateFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(ref.stateFingerprint)
        || (ref.revisionId !== null && (typeof ref.revisionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(ref.revisionId)))) throw new Error('无效的原判断引用');
    return { recordId: ref.recordId, revisionId: ref.revisionId as string | null, journalVersion: version(ref.journalVersion), stateFingerprint: ref.stateFingerprint };
}
const INPUT_KEYS = ['symbol', 'factType', 'reportingPeriod', 'title', 'factText', 'sourceUrl', 'sourcePublishedAt', 'assessment', 'assessmentNote', 'observationReference', 'correctionOf', 'correctionReason', 'clientRequestId'];
export function validateCreateResearchFact(input: unknown): CreateResearchFactInput {
    const value = object(input, INPUT_KEYS);
    const symbol = factSymbol(value.symbol);
    const market = identifyMarketAndCode(symbol).market;
    if (!(FACT_TYPES[market] as readonly unknown[]).includes(value.factType)) throw new Error('事实类型与标的市场不符');
    if (!FACT_ASSESSMENTS.includes(value.assessment as FactAssessment)) throw new Error('请选择人工判断');
    if (typeof value.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value.clientRequestId)) throw new Error('无效的请求标识');
    const correctionOf = value.correctionOf == null ? null : factId(value.correctionOf);
    const correctionReason = correctionOf ? text(value.correctionReason, 2000) : null;
    if (!correctionOf && value.correctionReason != null) throw new Error('更正原因需要原事实引用');
    return {
        symbol, factType: value.factType as FactType, reportingPeriod: text(value.reportingPeriod, 160),
        title: text(value.title, 200), factText: text(value.factText, FACT_TEXT_LIMIT), sourceUrl: factSourceUrl(value.sourceUrl),
        sourcePublishedAt: value.sourcePublishedAt === null ? null : factTimestamp(value.sourcePublishedAt),
        assessment: value.assessment as FactAssessment, assessmentNote: text(value.assessmentNote, 2000, true),
        observationReference: reference(value.observationReference), correctionOf, correctionReason, clientRequestId: value.clientRequestId,
    };
}
export function researchFactFingerprint(value: CreateResearchFactInput): string {
    return JSON.stringify([value.symbol, value.factType, value.reportingPeriod, value.title, value.factText, value.sourceUrl,
        value.sourcePublishedAt, value.assessment, value.assessmentNote, value.observationReference ?? null, value.correctionOf ?? null, value.correctionReason ?? null]);
}

/** Strict public/persisted payload validation for backup. Owner/request metadata is intentionally excluded. */
export function validateResearchFactRecord(input: unknown): ResearchFactRecord {
    const value = object(input, [...INPUT_KEYS.filter((key) => !['clientRequestId', 'observationReference'].includes(key)),
        'id', 'market', 'exchangeId', 'createdAt', 'registrationMethod', 'observationSnapshot', 'rootId', 'version']);
    const fields = validateCreateResearchFact(Object.fromEntries(INPUT_KEYS.filter((key) => !['clientRequestId', 'observationReference'].includes(key)).map((key) => [key, value[key]]).concat([['clientRequestId', 'backup-validation']])));
    const identity = identifyMarketAndCode(fields.symbol);
    if (value.symbol !== fields.symbol || value.market !== identity.market || value.exchangeId !== identity.exchangeId || value.registrationMethod !== 'manual') throw new Error('无效的事实市场或登记方式');
    const id = factId(value.id); const rootId = factId(value.rootId); const factVersion = version(value.version);
    if (factVersion < 1 || (fields.correctionOf ? factVersion < 2 || rootId === id || fields.correctionOf === id : factVersion !== 1 || rootId !== id)) throw new Error('无效的事实更正关系');
    let snapshot: FactObservationSnapshot | null = null;
    if (value.observationSnapshot !== null) {
        const saved = object(value.observationSnapshot, ['recordId', 'sourceSymbol', 'revisionId', 'journalVersion', 'observationUpdatedAt', 'archivedAt', 'observation']);
        reference({ recordId: saved.recordId, revisionId: saved.revisionId, journalVersion: saved.journalVersion, stateFingerprint: '0'.repeat(64) });
        if (factSymbol(saved.sourceSymbol) !== fields.symbol) throw new Error('原判断与事实标的不符');
        const state = object(saved.observation, ['group', 'note', 'invalidation', 'targetPrice', 'reviewStatus', 'reviewedAt', 'nextReviewDate', 'proximityPercent']);
        if (!['watching', 'validated', 'invalidated'].includes(state.reviewStatus as string)) throw new Error('无效的原判断状态');
        for (const key of ['group', 'note', 'invalidation'] as const) if (state[key] !== undefined) text(state[key], key === 'group' ? 80 : FACT_SNAPSHOT_TEXT_LIMIT, true);
        if (state.targetPrice !== undefined && (typeof state.targetPrice !== 'number' || !Number.isFinite(state.targetPrice) || state.targetPrice <= 0)) throw new Error('无效的原判断价格');
        if (state.proximityPercent !== undefined && (typeof state.proximityPercent !== 'number' || !Number.isFinite(state.proximityPercent) || state.proximityPercent < 0 || state.proximityPercent > 100)) throw new Error('无效的原判断比例');
        if (state.reviewedAt !== undefined) factTimestamp(state.reviewedAt);
        if (state.nextReviewDate !== undefined && !validCalendarDate(state.nextReviewDate)) throw new Error('无效的原判断日期');
        snapshot = {
            recordId: saved.recordId as string, sourceSymbol: saved.sourceSymbol as string, revisionId: saved.revisionId as string | null,
            journalVersion: saved.journalVersion as number, observationUpdatedAt: saved.observationUpdatedAt === null ? null : factTimestamp(saved.observationUpdatedAt),
            archivedAt: saved.archivedAt === null ? null : factTimestamp(saved.archivedAt), observation: { ...state } as ObservationState,
        };
    }
    const { clientRequestId: _request, observationReference: _reference, ...publicFields } = fields;
    void _request; void _reference;
    return { ...publicFields, correctionOf: fields.correctionOf ?? null, correctionReason: fields.correctionReason ?? null,
        id, market: identity.market, exchangeId: identity.exchangeId, createdAt: factTimestamp(value.createdAt), registrationMethod: 'manual',
        observationSnapshot: snapshot, rootId, version: factVersion };
}
