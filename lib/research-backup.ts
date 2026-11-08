import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { validateObservationInput, type SavedWatchlistRecord } from '@/lib/watchlist-observation';
import { isMarketDate, validateReviewInput, type WatchlistJournalEntry } from '@/lib/watchlist-review';
import { validateCreateManualPlan, validateManualPlanId } from '@/lib/manual-plan';
import { canonicalPeerMember } from '@/lib/market/daily-research';
import { validateResearchFactRecord } from '@/lib/research-facts';
import { validateResearchComparisonPayload } from '@/lib/research-comparisons';

// Byte and BSON limits are authoritative; count guards must not reject ordinary long-lived archives.
export const RESEARCH_BACKUP_LIMITS = { bytes: 32 * 1024 * 1024, records: 1_000_000, events: 1_000_000, alerts: 1_000_000, journal: 1_000_000, bson: 12 * 1024 * 1024 } as const;
export type BackupResearch = Omit<SavedWatchlistRecord, '_id'> & { id: string; archivedAt?: string | null };
export type BackupManualEvent = { id: string; symbol: string; title: string; date: string; kind: 'earnings' | 'ex-dividend' | 'other'; sourceUrl?: string; note?: string; clientRequestId: string; createdAt: string; cancelledAt?: string };
type Row = Record<string, unknown>;
type ResearchBackupBase = { format: 'openstock-research'; exportedAt: string; research: BackupResearch[]; manualEvents: BackupManualEvent[]; alertReferences: { referenceOnly: true; alerts: Row[] } };
export const WORKBENCH_COLLECTIONS = ['manualPlans', 'planSchedules', 'peerGroups', 'eventHistories', 'changeStates', 'factCards', 'comparisons'] as const;
export type WorkbenchCollection = typeof WORKBENCH_COLLECTIONS[number];
export type BackupCollectionCapture = { schemaVersion: 1; startedAt: string; completedAt: string; count: number; sourceCount: number; scope: string; limitations: string[]; retainedVersions?: number; unavailableVersions?: number; unresolvedTargets?: number };
export type ResearchBackupV2 = ResearchBackupBase & { version: 2; capture: { consistency: 'independent-collection-reads'; startedAt: string; completedAt: string; collections: Record<'research' | 'manualEvents' | 'alertReferences' | WorkbenchCollection, BackupCollectionCapture>; unsupported: string[] } } & Record<WorkbenchCollection, Row[]>;
export type ResearchBackup = (ResearchBackupBase & { version: 1 }) | ResearchBackupV2;
export type ImportStatus = 'import' | 'skip-existing' | 'skip-capacity' | 'skip-related' | 'skip-unsupported';
export type ResearchImportPreview = { digest: string; version?: 1 | 2; capture?: ResearchBackupV2['capture']; capability?: { status: 'supported' | 'unsupported' | 'unknown'; message: string }; research: { symbol: string; records: number; status: ImportStatus }[]; manualEvents: { id: string; title: string; status: ImportStatus }[]; workbench?: { collection: WorkbenchCollection; id: string; status: ImportStatus; reason?: string }[]; referenceAlerts: number };
export type ResearchBackupActionResult<T> = { success: true; data: T } | { success: false; code: 'INVALID_BACKUP' | 'PREVIEW_CHANGED' | 'TRANSACTIONS_UNSUPPORTED' | 'LIFECYCLE_BUSY' | 'LIFECYCLE_MAINTENANCE' | 'BACKUP_FAILED'; error: string };
export class ResearchBackupValidationError extends Error {}
const observationKeys = ['group', 'note', 'invalidation', 'targetPrice', 'reviewStatus', 'nextReviewDate', 'proximityPercent'];
const researchKeys = ['id', 'symbol', 'company', 'addedAt', ...observationKeys, 'reviewedAt', 'observationUpdatedAt', 'initialSnapshot', 'journal', 'journalVersion', 'archivedAt'];
const eventKeys = ['id', 'symbol', 'title', 'date', 'kind', 'sourceUrl', 'note', 'clientRequestId', 'createdAt', 'cancelledAt'];
const snapshotKeys = ['price', 'currency', 'source', 'asOf', 'fetchedAt', 'priceBasis', 'adjustment'];
const reviewKeys = ['kind', 'id', 'createdAt', 'tradingDate', 'hypothesis', 'changes', 'conclusion', 'verificationType', 'evidenceURLs', 'evidenceReferences', 'nextReviewDate', 'correctionOf', 'clientRequestId', 'sourceQuote'];
const revisionKeys = ['kind', 'id', 'recordedAt', 'modifiedAt', 'source', 'sourceSymbol', 'reviewId', 'observation'];
const alertKeys = ['id', 'symbol', 'targetPrice', 'condition', 'mode', 'active', 'triggered', 'createdAt', 'expiresAt', 'lastObservation', 'triggerEvent', 'delivery'];
const alertObservationKeys = ['price', 'asOf', 'source'];
const triggerKeys = ['id', ...alertObservationKeys, 'direction', 'observedAt', 'previousObservation'];
// Message IDs and provider errors are intentionally not portable research evidence.
const deliveryKeys = ['status', 'attemptedAt', 'completedAt'];
function pick(row: Row, keys: string[]): Row {
    return Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
}
function object(value: unknown, keys: string[]): Row {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份字段必须为对象');
    const row = value as Row;
    if (Object.keys(row).some((key) => !keys.includes(key))) throw new Error('备份含不支持的字段（包括归属或执行指令）');
    return row;
}
function text(value: unknown, max: number, label: string, pattern?: RegExp): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > max || (pattern && !pattern.test(value))) throw new Error(`无效的${label}`);
}
function timestamp(value: unknown) {
    // Quote providers may omit milliseconds or use an explicit offset; retain their original time text.
    const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!match || !isMarketDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 || Number(match[6] || 0) > 23 || Number(match[7] || 0) > 59 || !Number.isFinite(Date.parse(value as string))) throw new Error('无效的 ISO 时间');
}
function identifier(value: unknown): asserts value is string { text(value, 100, '记录标识', /^[A-Za-z0-9_-]+$/); }
function recordId(value: unknown): asserts value is string { text(value, 24, '原始记录编号', /^[a-f0-9]{24}$/); }
export function backupCanonicalSymbol(value: unknown): string {
    text(value, 40, '标的身份', /^[A-Z0-9^][A-Z0-9.&:^\-]{0,39}$/);
    const identity = identifyMarketAndCode(value);
    if (identity.kind === 'unknown') throw new Error('备份标的身份尚未确认');
    return identity.normalizedSymbol;
}
function positive(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('备份价格必须为正数');
}
function evidence(value: unknown, max: number) {
    text(value, max, '证据链接');
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('无效的证据链接'); }
    if (!['http:', 'https:'].includes(url.protocol) || /^https?:\/\/[^/]*@/.test(url.href)) throw new Error('证据链接须为不含登录信息的 HTTP/HTTPS 地址');
}
function snapshot(value: unknown) {
    const row = object(value, snapshotKeys);
    positive(row.price); text(row.currency, 20, '币种'); text(row.source, 200, '来源');
    timestamp(row.asOf); timestamp(row.fetchedAt);
    if (row.priceBasis !== 'last-trade' || row.adjustment !== 'unadjusted') throw new Error('无效的成交快照口径');
}
function observation(value: unknown, requiredStatus = false) {
    const row = object(value, [...observationKeys, 'reviewedAt']);
    const fields = pick(row, observationKeys);
    // Immutable legacy captures can contain merged alias text beyond today's edit-input limit.
    if (requiredStatus) for (const key of ['note', 'invalidation']) if (fields[key] != null) {
        if (typeof fields[key] !== 'string' || (fields[key] as string).length > RESEARCH_BACKUP_LIMITS.bson) throw new Error('历史观察文本无效或超过安全容量');
        delete fields[key];
    }
    if (Object.keys(fields).length) validateObservationInput(fields);
    if (requiredStatus && !['watching', 'validated', 'invalidated'].includes(row.reviewStatus as string)) throw new Error('复核状态缺失');
    if (row.reviewedAt != null) timestamp(row.reviewedAt);
}
function array(value: unknown, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max) throw new Error('备份条目数量超限或格式无效');
    return value;
}
function journal(value: unknown, canonical: string): WatchlistJournalEntry[] {
    return array(value, RESEARCH_BACKUP_LIMITS.journal).map((value) => {
        const kind = (value as Row)?.kind;
        const row = object(value, kind === 'review' ? reviewKeys : revisionKeys);
        identifier(row.id);
        if (kind === 'review') {
            timestamp(row.createdAt);
            validateReviewInput(pick(row, reviewKeys.filter((key) => !['kind', 'id', 'createdAt', 'sourceQuote'].includes(key))));
            for (const url of array(row.evidenceURLs, 10)) evidence(url, 2000);
            if (row.sourceQuote !== undefined) snapshot(row.sourceQuote);
        } else if (kind === 'observation') {
            timestamp(row.recordedAt);
            if (row.modifiedAt !== null) timestamp(row.modifiedAt);
            if (!['legacy-capture', 'saved-revision', 'edit'].includes(row.source as string)) throw new Error('无效的观察版本来源');
            if (row.sourceSymbol !== undefined && backupCanonicalSymbol(row.sourceSymbol) !== canonical) throw new Error('观察版本来源标的身份不匹配');
            if (row.reviewId !== undefined) identifier(row.reviewId);
            observation(row.observation, true);
        } else throw new Error('无效的历史条目类型');
        return row as WatchlistJournalEntry;
    });
}

/** Relationships are checked across the entire raw alias group, never across identities. */
function relationships(records: BackupResearch[]) {
    const entries = new Map<string, WatchlistJournalEntry>();
    const requests = new Map<string, string>();
    for (const record of records) {
        const local = new Set<string>();
        for (const entry of record.journal || []) {
            if (local.has(entry.id)) throw new Error('同一记录内历史编号重复');
            local.add(entry.id);
            const previous = entries.get(entry.id);
            if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error('别名历史编号冲突');
            entries.set(entry.id, entry);
            if (entry.kind === 'review') {
                if (requests.has(entry.clientRequestId) && requests.get(entry.clientRequestId) !== entry.id) throw new Error('复核请求编号重复');
                requests.set(entry.clientRequestId, entry.id);
            }
        }
    }
    for (const entry of entries.values()) {
        if (entry.kind === 'observation' && entry.reviewId && entries.get(entry.reviewId)?.kind !== 'review') throw new Error('观察版本的复核引用缺失');
        if (entry.kind !== 'review' || !entry.correctionOf) continue;
        const target = entries.get(entry.correctionOf);
        if (target?.kind !== 'review') throw new Error('更正引用缺失');
        const visited = new Set([entry.id]);
        let current: WatchlistJournalEntry | undefined = target;
        while (current?.kind === 'review') {
            if (visited.has(current.id)) throw new Error('更正关系存在循环');
            visited.add(current.id);
            current = current.correctionOf ? entries.get(current.correctionOf) : undefined;
        }
    }
}
export function groupBackupResearch(records: BackupResearch[]): Map<string, BackupResearch[]> {
    const groups = new Map<string, BackupResearch[]>();
    for (const record of records) {
        const symbol = backupCanonicalSymbol(record.symbol);
        groups.set(symbol, [...(groups.get(symbol) || []), record]);
    }
    return groups;
}
function validateAlerts(value: unknown) {
    const section = object(value, ['referenceOnly', 'alerts']);
    if (section.referenceOnly !== true) throw new Error('提醒必须声明仅供参考');
    for (const value of array(section.alerts, RESEARCH_BACKUP_LIMITS.alerts)) {
        const row = object(value, alertKeys);
        recordId(row.id); backupCanonicalSymbol(row.symbol); positive(row.targetPrice);
        if (!['ABOVE', 'BELOW'].includes(row.condition as string) || typeof row.active !== 'boolean' || typeof row.triggered !== 'boolean') throw new Error('无效的提醒参考');
        if (row.mode !== undefined && !['crossing', 'legacy-threshold'].includes(row.mode as string)) throw new Error('无效的提醒模式');
        timestamp(row.createdAt); timestamp(row.expiresAt);
        const checkObservation = (value: unknown) => { const observation = object(value, alertObservationKeys); positive(observation.price); timestamp(observation.asOf); text(observation.source, 200, '提醒来源'); };
        if (row.lastObservation !== undefined) checkObservation(row.lastObservation);
        if (row.triggerEvent !== undefined) {
            const trigger = object(row.triggerEvent, triggerKeys);
            text(trigger.id, 200, '触发编号'); checkObservation(pick(trigger, alertObservationKeys)); timestamp(trigger.observedAt);
            if (!['ABOVE', 'BELOW'].includes(trigger.direction as string)) throw new Error('无效的触发方向');
            if (trigger.previousObservation !== undefined) checkObservation(trigger.previousObservation);
        }
        if (row.delivery !== undefined) {
            const delivery = object(row.delivery, deliveryKeys);
            if (!['pending', 'sent', 'skipped', 'failed'].includes(delivery.status as string)) throw new Error('无效的通知状态');
            for (const key of ['attemptedAt', 'completedAt']) if (delivery[key] !== undefined) timestamp(delivery[key]);
        }
    }
}

export function parseResearchBackup(json: unknown): ResearchBackup {
    try { return validateResearchBackup(json); }
    catch (error) { throw new ResearchBackupValidationError(error instanceof Error ? error.message : '备份格式无效'); }
}
function validateResearchBackup(json: unknown): ResearchBackup {
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > RESEARCH_BACKUP_LIMITS.bytes) throw new Error('备份 JSON 须小于 32 MiB');
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { throw new Error('无法读取 JSON 备份'); }
    const isV2 = (parsed as Row)?.version === 2;
    const root = object(parsed, ['format', 'version', 'exportedAt', 'research', 'manualEvents', 'alertReferences', ...(isV2 ? ['capture', ...WORKBENCH_COLLECTIONS] : [])]);
    if (root.format !== 'openstock-research' || ![1, 2].includes(root.version as number)) throw new Error('不支持的备份格式或版本');
    if (isV2 && !root.capture) throw new Error('备份版本 2 缺少集合清单');
    timestamp(root.exportedAt);
    const ids = new Set<string>(); const symbols = new Set<string>();
    const records = array(root.research, RESEARCH_BACKUP_LIMITS.records).map((value) => {
        const row = object(value, researchKeys);
        recordId(row.id); const canonical = backupCanonicalSymbol(row.symbol);
        if (ids.has(row.id) || symbols.has(row.symbol as string)) throw new Error('原始研究记录编号或别名重复');
        ids.add(row.id); symbols.add(row.symbol as string);
        text(row.company, 120, '公司名称'); timestamp(row.addedAt);
        observation(pick(row, [...observationKeys, 'reviewedAt']));
        for (const key of ['observationUpdatedAt', 'archivedAt']) if (row[key] != null) timestamp(row[key]);
        if (row.initialSnapshot !== undefined) snapshot(row.initialSnapshot);
        if (row.journal !== undefined) journal(row.journal, canonical);
        if (row.journalVersion !== undefined && (!Number.isSafeInteger(row.journalVersion) || (row.journalVersion as number) < 0)) throw new Error('无效的历史版本');
        // Include room for owner, archive metadata and BSON array-key overhead before any write.
        if (BSON.calculateObjectSize({ ...row, userId: 'x'.repeat(1024), archivedAt: new Date() }) > RESEARCH_BACKUP_LIMITS.bson) throw new Error('研究历史超过 BSON 安全容量');
        return row as BackupResearch;
    });
    for (const group of groupBackupResearch(records).values()) relationships(group);
    const eventIds = new Set<string>(); const requestIds = new Set<string>();
    for (const value of array(root.manualEvents, RESEARCH_BACKUP_LIMITS.events)) {
        const row = object(value, eventKeys);
        recordId(row.id); backupCanonicalSymbol(row.symbol);
        text(row.title, 120, '事件标题'); text(row.clientRequestId, 80, '事件请求标识', /^[A-Za-z0-9_-]{8,80}$/);
        if (!isMarketDate(row.date) || !['earnings', 'ex-dividend', 'other'].includes(row.kind as string)) throw new Error('无效的手动事件日期或类型');
        if (row.note !== undefined && (typeof row.note !== 'string' || row.note.length > 2000)) throw new Error('事件备注过长');
        if (row.sourceUrl !== undefined) evidence(row.sourceUrl, 1500);
        timestamp(row.createdAt); if (row.cancelledAt !== undefined) timestamp(row.cancelledAt);
        if (eventIds.has(row.id) || requestIds.has(row.clientRequestId as string)) throw new Error('手动事件标识重复');
        eventIds.add(row.id); requestIds.add(row.clientRequestId as string);
    }
    validateAlerts(root.alertReferences);
    if (isV2) validateWorkbench(root as ResearchBackupV2);
    else if (records.some((record) => record.journal?.some((entry) => entry.kind === 'review' && entry.evidenceReferences?.length))) throw new Error('证据引用需要版本 2 的关联集合');
    return root as ResearchBackup;
}

/** Explicit allowlists prevent owner IDs, executable fields or provider secrets escaping. */
export function createResearchBackup(research: Row[], manualEvents: Row[], alerts: Row[], now = new Date()): ResearchBackup {
    const clean = (row: Row, keys: string[]) => pick(row, keys);
    const snapshotFields = (value: unknown) => clean(value as Row, snapshotKeys);
    const records = research.map((row) => {
        const result = clean({ ...row, id: String(row._id) }, researchKeys);
        if (row.initialSnapshot) result.initialSnapshot = snapshotFields(row.initialSnapshot);
        if (Array.isArray(row.journal)) result.journal = row.journal.map((entry: Row) => {
            const result = clean(entry, entry.kind === 'review' ? reviewKeys : revisionKeys);
            if (entry.sourceQuote) result.sourceQuote = snapshotFields(entry.sourceQuote);
            if (entry.observation) result.observation = clean(entry.observation as Row, [...observationKeys, 'reviewedAt']);
            return result;
        });
        return result;
    });
    const references = alerts.map((row) => {
        const result = clean({ ...row, id: String(row._id) }, alertKeys);
        if (row.lastObservation) result.lastObservation = clean(row.lastObservation as Row, alertObservationKeys);
        if (row.triggerEvent) {
            result.triggerEvent = clean(row.triggerEvent as Row, triggerKeys);
            const trigger = result.triggerEvent as Row;
            if (trigger.previousObservation) trigger.previousObservation = clean(trigger.previousObservation as Row, alertObservationKeys);
        }
        if (row.delivery) result.delivery = clean(row.delivery as Row, deliveryKeys);
        return result;
    });
    return JSON.parse(JSON.stringify({ format: 'openstock-research', version: 1, exportedAt: now.toISOString(), research: records, manualEvents: manualEvents.map((row) => clean({ ...row, id: String(row._id) }, eventKeys)), alertReferences: { referenceOnly: true, alerts: references } }));
}
const workbenchKeys: Record<WorkbenchCollection, string[]> = {
    manualPlans: ['id', 'symbol', 'waitingCondition', 'invalidation', 'nextAction', 'checkDate', 'manualState', 'version', 'clientRequestId', 'createFingerprint', 'createdAt', 'updatedAt', 'scheduleRevision', 'stateReason', 'observationVersionId', 'observationSnapshot'],
    planSchedules: ['planId', 'revision', 'fromDate', 'toDate', 'reason', 'changedAt'],
    peerGroups: ['id', 'slot', 'name', 'purpose', 'members', 'membershipSavedAt'],
    eventHistories: ['identity', 'symbol', 'revision', 'observedAt', 'versions'],
    changeStates: ['changeId', 'status', 'snoozedUntil', 'revision', 'updatedAt'],
    factCards: ['id', 'symbol', 'market', 'exchangeId', 'factType', 'reportingPeriod', 'title', 'factText', 'sourceUrl', 'sourcePublishedAt', 'createdAt', 'registrationMethod', 'assessment', 'assessmentNote', 'observationSnapshot', 'correctionOf', 'correctionReason', 'rootId', 'version', 'clientRequestId', 'createFingerprint'],
    comparisons: ['id', 'requestId', 'draftId', 'createdAt', 'savedAt', 'caption', 'observationReference', 'originalObservation', 'algorithmVersion', 'result', 'originalSeries'],
};
function integer(value: unknown, minimum = 1) { if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error('无效的备份版本或数量'); }
function date(value: unknown) { if (!isMarketDate(value)) throw new Error('无效的备份自然日'); }
export function workbenchRowId(collection: WorkbenchCollection, row: Row): string {
    return String(collection === 'planSchedules' ? `${row.planId}:${row.revision}` : collection === 'eventHistories' ? row.identity : collection === 'changeStates' ? row.changeId : row.id);
}
function validateWorkbench(backup: ResearchBackupV2) {
    const captures = object(backup.capture, ['consistency', 'startedAt', 'completedAt', 'collections', 'unsupported']);
    if (captures.consistency !== 'independent-collection-reads') throw new Error('备份不得声称跨集合一致快照');
    timestamp(captures.startedAt); timestamp(captures.completedAt);
    if (Date.parse(captures.startedAt as string) > Date.parse(captures.completedAt as string)) throw new Error('备份取样时间范围无效');
    const names = ['research', 'manualEvents', 'alertReferences', ...WORKBENCH_COLLECTIONS];
    const manifests = object(captures.collections, names);
    for (const name of names) {
        const manifest = object(manifests[name], ['schemaVersion', 'startedAt', 'completedAt', 'count', 'sourceCount', 'scope', 'limitations', 'retainedVersions', 'unavailableVersions', 'unresolvedTargets']);
        if (manifest.schemaVersion !== 1) throw new Error('不支持的集合模式版本');
        timestamp(manifest.startedAt); timestamp(manifest.completedAt);
        if (Date.parse(manifest.startedAt as string) < Date.parse(captures.startedAt as string) || Date.parse(manifest.completedAt as string) > Date.parse(captures.completedAt as string) || Date.parse(manifest.startedAt as string) > Date.parse(manifest.completedAt as string)) throw new Error('集合取样时间范围无效');
        integer(manifest.count, 0); integer(manifest.sourceCount, 0); text(manifest.scope, 2000, '集合取样范围');
        for (const key of ['retainedVersions', 'unavailableVersions', 'unresolvedTargets']) if (manifest[key] !== undefined) {
            integer(manifest[key], 0);
            if (name !== (key === 'unresolvedTargets' ? 'changeStates' : 'eventHistories')) throw new Error('集合覆盖指标归属错误');
        }
        for (const note of array(manifest.limitations, 30)) text(note, 2000, '集合限制');
        const rows = name === 'alertReferences' ? backup.alertReferences.alerts : backup[name as keyof ResearchBackupV2];
        if (!Array.isArray(rows) || manifest.count !== rows.length || (manifest.sourceCount as number) < rows.length) throw new Error('集合清单数量不匹配');
    }
    for (const note of array(captures.unsupported, 30)) text(note, 2000, '未覆盖范围');
    for (const collection of WORKBENCH_COLLECTIONS) {
        const ids = new Set<string>(); const requests = new Set<string>(); const drafts = new Set<string>();
        for (const value of array(backup[collection], RESEARCH_BACKUP_LIMITS.records)) {
            const row = object(value, workbenchKeys[collection]);
            const id = workbenchRowId(collection, row);
            if (ids.has(id)) throw new Error('集合稳定身份重复');
            ids.add(id);
            if (collection === 'manualPlans') {
                validateManualPlanId(row.id);
                validateCreateManualPlan(pick(row, ['symbol', 'waitingCondition', 'invalidation', 'nextAction', 'checkDate', 'clientRequestId']));
                if (!['waiting', 'completed', 'cancelled'].includes(row.manualState as string)) throw new Error('无效的人工计划状态');
                integer(row.version); if (row.scheduleRevision !== undefined) integer(row.scheduleRevision);
                timestamp(row.createdAt); timestamp(row.updatedAt); text(row.createFingerprint, 40000, '原始计划请求');
                if (row.stateReason !== undefined) text(row.stateReason, 2000, '计划原因');
                if (row.observationVersionId !== undefined) identifier(row.observationVersionId);
                if (row.observationSnapshot !== undefined) {
                    const saved = object(row.observationSnapshot, ['recordedAt', 'note', 'invalidation']); timestamp(saved.recordedAt);
                    for (const key of ['note', 'invalidation']) if (saved[key] !== undefined && (typeof saved[key] !== 'string' || (saved[key] as string).length > RESEARCH_BACKUP_LIMITS.bson)) throw new Error('计划原判断文本无效');
                }
                if (Boolean(row.observationSnapshot) !== Boolean(row.observationVersionId)) throw new Error('计划原判断引用和快照不完整');
                let initial: unknown; try { initial = JSON.parse(row.createFingerprint as string); } catch { throw new Error('原始计划请求格式无效'); }
                const tuple = array(initial, 6); if (tuple.length !== 5 && tuple.length !== 6) throw new Error('原始计划请求格式无效');
                validateCreateManualPlan({ symbol: tuple[0], waitingCondition: tuple[1], invalidation: tuple[2], nextAction: tuple[3], checkDate: tuple[4], clientRequestId: row.clientRequestId });
                if (backupCanonicalSymbol(tuple[0]) !== backupCanonicalSymbol(row.symbol) || (tuple.length === 6) !== Boolean(row.observationVersionId) || (tuple.length === 6 && tuple[5] !== row.observationVersionId)) throw new Error('原始计划身份不匹配');
            } else if (collection === 'planSchedules') {
                identifier(row.planId); integer(row.revision, 2); date(row.fromDate); date(row.toDate); text(row.reason, 2000, '改期原因'); timestamp(row.changedAt);
            } else if (collection === 'peerGroups') {
                recordId(row.id); integer(row.slot, 0); if ((row.slot as number) > 9) throw new Error('无效的固定组槽位');
                text(row.name, 60, '固定组名称'); timestamp(row.membershipSavedAt);
                if (row.purpose !== undefined && !['peer', 'theme'].includes(row.purpose as string)) throw new Error('无效的固定组用途');
                const members = array(row.members, 20); if (!members.length) throw new Error('固定组成员为空');
                const memberIds = new Set<string>();
                for (const value of members) {
                    const member = object(value, ['symbolId', 'symbol']); const canonical = canonicalPeerMember(member.symbol as string);
                    if (member.symbolId !== canonical.symbolId || memberIds.has(canonical.symbolId)) throw new Error('固定组成员身份不匹配或重复');
                    memberIds.add(canonical.symbolId);
                }
            } else if (collection === 'eventHistories') {
                text(row.identity, 500, '事件身份'); backupCanonicalSymbol(row.symbol); integer(row.revision); timestamp(row.observedAt);
                const versions = array(row.versions, RESEARCH_BACKUP_LIMITS.events); if (!versions.length || versions.length > (row.revision as number)) throw new Error('事件版本数量无效');
                const versionIds = new Set<string>();
                for (const value of versions) {
                    const version = object(value, ['id', 'date', 'previousDate', 'discoveredAt', 'source', 'sourceUrl', 'title']);
                    identifier(version.id); if (versionIds.has(version.id)) throw new Error('事件版本身份重复'); versionIds.add(version.id);
                    date(version.date); if (version.previousDate !== undefined) date(version.previousDate);
                    timestamp(version.discoveredAt); text(version.source, 500, '事件来源'); text(version.title, 500, '事件标题'); if (version.sourceUrl !== undefined) evidence(version.sourceUrl, 2000);
                }
            } else if (collection === 'changeStates') {
                text(row.changeId, 100, '变化处理身份', /^(event-date|observation|review-due|manual-plan-due|manual-fact):[a-f0-9]{64}$/);
                if (!['pending', 'processed', 'snoozed', 'ignored'].includes(row.status as string)) throw new Error('无效的变化处理状态');
                integer(row.revision); timestamp(row.updatedAt); if (row.snoozedUntil != null) timestamp(row.snoozedUntil);
                if (row.status === 'snoozed' && !row.snoozedUntil) throw new Error('稍后处理缺少期限');
            } else if (collection === 'factCards') {
                validateResearchFactRecord(pick(row, workbenchKeys.factCards.filter((key) => !['clientRequestId', 'createFingerprint'].includes(key))));
                text(row.clientRequestId, 100, '事实请求标识', /^[A-Za-z0-9_-]{8,100}$/); text(row.createFingerprint, 100000, '原始事实请求');
                let initial: unknown; try { initial = JSON.parse(row.createFingerprint as string); } catch { throw new Error('原始事实请求格式无效'); }
                const tuple = array(initial, 12); if (tuple.length !== 12) throw new Error('原始事实请求格式无效');
                if (tuple[9] !== null) {
                    const reference = object(tuple[9], ['recordId', 'revisionId', 'journalVersion', 'stateFingerprint']);
                    recordId(reference.recordId); if (reference.revisionId !== null) identifier(reference.revisionId); integer(reference.journalVersion, 0); text(reference.stateFingerprint, 64, '原判断指纹', /^[a-f0-9]{64}$/);
                }
                if (tuple.slice(0, 9).some((value, index) => value !== row[['symbol', 'factType', 'reportingPeriod', 'title', 'factText', 'sourceUrl', 'sourcePublishedAt', 'assessment', 'assessmentNote'][index]]) || tuple[10] !== row.correctionOf || tuple[11] !== row.correctionReason) throw new Error('原始事实请求与事实内容不匹配');
            } else {
                recordId(row.id); identifier(row.requestId); identifier(row.draftId); timestamp(row.createdAt); timestamp(row.savedAt);
                if (drafts.has(row.draftId as string)) throw new Error('对照草稿保存身份重复'); drafts.add(row.draftId as string);
                validateResearchComparisonPayload(pick(row, ['caption', 'observationReference', 'originalObservation', 'algorithmVersion', 'result', 'originalSeries']));
            }
            const requestId = row.clientRequestId ?? row.requestId;
            if (requestId !== undefined) { if (requests.has(requestId as string)) throw new Error('集合请求标识重复'); requests.add(requestId as string); }
            if (BSON.calculateObjectSize({ ...row, userId: 'x'.repeat(1024) }) > RESEARCH_BACKUP_LIMITS.bson) throw new Error('集合记录超过 BSON 安全容量');
        }
    }
    workbenchGraph(backup); // Verify the whole evidence graph before preview or writes.
    const historyCapture = backup.capture.collections.eventHistories;
    const retained = backup.eventHistories.reduce((count, row) => count + (row.versions as Row[]).length, 0);
    const missing = backup.eventHistories.reduce((count, row) => count + (row.revision as number) - (row.versions as Row[]).length, 0);
    if ((historyCapture.retainedVersions !== undefined && historyCapture.retainedVersions !== retained) || (historyCapture.unavailableVersions !== undefined && historyCapture.unavailableVersions !== missing)) throw new Error('事件版本覆盖数量不匹配');
    const stateCapture = backup.capture.collections.changeStates;
    const targets = handlingStateTargets(backup);
    if (stateCapture.unresolvedTargets !== undefined && stateCapture.unresolvedTargets !== backup.changeStates.filter((row) => !targets.has(row.changeId as string)).length) throw new Error('处理状态覆盖数量不匹配');
}
export function createResearchBackupV2(base: ResearchBackup, collections: Record<WorkbenchCollection, Row[]>, capture: ResearchBackupV2['capture']): ResearchBackupV2 {
    const clean = Object.fromEntries(WORKBENCH_COLLECTIONS.map((name) => [name, collections[name].map((row) => pick({ ...row, ...(row.id === undefined && row._id !== undefined ? { id: String(row._id) } : {}) }, workbenchKeys[name]))]));
    const backup = JSON.parse(JSON.stringify({ ...base, version: 2, ...clean, capture })) as ResearchBackupV2;
    return parseResearchBackup(JSON.stringify(backup)) as ResearchBackupV2;
}

function changeIdentity(kind: string, identity: unknown) { return `${kind}:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`; }
export function researchAliasIds(backup: ResearchBackup, userId: string): Map<string, string> {
    const ids = new Map<string, string>();
    for (const [symbol, rows] of groupBackupResearch(backup.research)) {
        const prefix = researchImportId(userId, `aliases:${symbol}`).slice(0, 18);
        [...rows].sort((a, b) => a.id.localeCompare(b.id)).forEach((row, rank) => ids.set(row.id, `${prefix}${rank.toString(16).padStart(6, '0')}`));
    }
    return ids;
}
/** Each connected evidence group is imported entirely or skipped entirely. */
function workbenchGraph(backup: ResearchBackupV2) {
    const graph = new Map<string, Set<string>>();
    const node = (name: string) => { if (!graph.has(name)) graph.set(name, new Set()); return name; };
    const link = (a: string, b: string) => { node(a); node(b); graph.get(a)!.add(b); graph.get(b)!.add(a); };
    const research = new Map(backup.research.map((row) => [row.id, row]));
    const facts = new Map(backup.factCards.map((row) => [row.id as string, row]));
    const comparisons = new Map(backup.comparisons.map((row) => [row.id as string, row]));
    const plans = new Map(backup.manualPlans.map((row) => [row.id as string, row]));
    const entries = new Map<string, WatchlistJournalEntry>();
    for (const [symbol, rows] of groupBackupResearch(backup.research)) {
        node(`research:${symbol}`);
        for (const row of rows) for (const entry of row.journal ?? []) {
            const key = `${symbol}:${entry.id}`; entries.set(key, entry);
            if (entry.kind === 'review') for (const ref of entry.evidenceReferences ?? []) {
                const target = (ref.kind === 'fact' ? facts : comparisons).get(ref.id);
                if (!target) throw new Error('复核关联证据缺失');
                if (ref.kind === 'fact' && backupCanonicalSymbol(target.symbol) !== symbol) throw new Error('复核关联事实标的不匹配');
                if (ref.kind === 'comparison' && !((target.result as Row).rows as Row[]).some((member) => canonicalPeerMember(member.symbol as string).symbolId === canonicalPeerMember(symbol).symbolId)) throw new Error('复核关联对照标的不匹配');
                link(`research:${symbol}`, `${ref.kind === 'fact' ? 'factCards' : 'comparisons'}:${ref.id}`);
            }
        }
    }
    for (const collection of WORKBENCH_COLLECTIONS) for (const row of backup[collection]) node(`${collection}:${workbenchRowId(collection, row)}`);
    for (const plan of backup.manualPlans) if (plan.observationVersionId !== undefined) {
        const symbol = backupCanonicalSymbol(plan.symbol);
        const revision = entries.get(`${symbol}:${plan.observationVersionId}`);
        if (revision?.kind !== 'observation' || revision.recordedAt !== (plan.observationSnapshot as Row)?.recordedAt) throw new Error('计划关联观察版本缺失或时间不匹配');
        link(`manualPlans:${plan.id}`, `research:${symbol}`);
    }
    for (const schedule of backup.planSchedules) {
        const plan = plans.get(schedule.planId as string);
        if (!plan || (schedule.revision as number) > ((plan.scheduleRevision as number) ?? 1)) throw new Error('计划改期历史关联缺失');
        link(`planSchedules:${workbenchRowId('planSchedules', schedule)}`, `manualPlans:${schedule.planId}`);
    }
    for (const plan of backup.manualPlans) {
        const schedules = backup.planSchedules.filter((row) => row.planId === plan.id).sort((a, b) => (a.revision as number) - (b.revision as number));
        if (schedules.length !== ((plan.scheduleRevision as number) ?? 1) - 1 || schedules.some((row, index) => row.revision !== index + 2 || (index > 0 && row.fromDate !== schedules[index - 1].toDate)) || (schedules.length && schedules.at(-1)!.toDate !== plan.checkDate)) throw new Error('计划改期历史缺失或顺序不连续');
    }
    const correctionTargets = new Set<string>();
    for (const fact of backup.factCards) {
        const symbol = backupCanonicalSymbol(fact.symbol);
        if (fact.correctionOf != null) {
            if (correctionTargets.has(fact.correctionOf as string)) throw new Error('事实修订存在不支持的分叉');
            correctionTargets.add(fact.correctionOf as string);
            const previous = facts.get(fact.correctionOf as string);
            if (!previous || previous.symbol !== fact.symbol || previous.rootId !== fact.rootId || (previous.version as number) + 1 !== fact.version) throw new Error('事实修订引用缺失或版本不连续');
            link(`factCards:${fact.id}`, `factCards:${previous.id}`);
        } else if (fact.rootId !== fact.id || fact.version !== 1) throw new Error('事实原始版本身份无效');
        if (fact.observationSnapshot) {
            const snapshot = fact.observationSnapshot as Row; const record = research.get(snapshot.recordId as string);
            if (!record || backupCanonicalSymbol(record.symbol) !== symbol || record.symbol !== snapshot.sourceSymbol) throw new Error('事实关联观察记录缺失或标的不匹配');
            if (snapshot.revisionId != null && !record.journal?.some((entry) => entry.kind === 'observation' && entry.id === snapshot.revisionId)) throw new Error('事实关联观察版本缺失');
            link(`factCards:${fact.id}`, `research:${symbol}`);
        }
    }
    for (const comparison of backup.comparisons) {
        const reference = comparison.observationReference as Row | undefined;
        if (reference) {
            const symbol = [...groupBackupResearch(backup.research).keys()].find((symbol) => canonicalPeerMember(symbol).symbolId === reference.symbolId);
            const revision = symbol ? entries.get(`${symbol}:${reference.observationId}`) : undefined;
            if (!symbol || revision?.kind !== 'observation' || revision.recordedAt !== reference.version) throw new Error('对照关联观察版本缺失或时间不匹配');
            journal([comparison.originalObservation], symbol);
            link(`comparisons:${comparison.id}`, `research:${symbol}`);
        }
        const groupId = ((comparison.result as Row).group as Row | undefined)?.id;
        if (backup.peerGroups.some((group) => group.id === groupId)) link(`comparisons:${comparison.id}`, `peerGroups:${groupId}`);
    }
    const targets = handlingStateTargets(backup);
    for (const state of backup.changeStates) { const target = targets.get(state.changeId as string); if (target) link(`changeStates:${state.changeId}`, target.node); }
    return graph;
}
export function handlingStateTargets(backup: ResearchBackupV2, userId?: string): Map<string, { node: string; destination: string }> {
    const targets = new Map<string, { node: string; destination: string }>();
    const aliases = userId ? researchAliasIds(backup, userId) : new Map<string, string>();
    const add = (kind: string, identity: unknown, node: string, destinationIdentity = identity) => targets.set(changeIdentity(kind, identity), { node, destination: changeIdentity(kind, destinationIdentity) });
    for (const history of backup.eventHistories) for (const version of history.versions as Row[]) if (version.previousDate !== undefined) add('event-date', [history.identity, version.id], `eventHistories:${history.identity}`);
    for (const [symbol, records] of groupBackupResearch(backup.research)) {
        for (const record of records) {
            const versions = [{ date: record.nextReviewDate, token: record.observationUpdatedAt ?? 'legacy' }, ...(record.journal ?? []).filter((entry) => entry.kind === 'observation').map((entry) => ({ date: entry.observation.nextReviewDate, token: entry.modifiedAt ?? 'legacy' }))];
            for (const { date, token } of versions) if (date) add('review-due', [record.id, symbol, date, token], `research:${symbol}`, [aliases.get(record.id) ?? record.id, symbol, date, token]);
            for (const entry of record.journal ?? []) if (entry.kind === 'observation') add('observation', [symbol, entry.id], `research:${symbol}`);
        }
    }
    for (const plan of backup.manualPlans) {
        const revisions = new Set([1, plan.scheduleRevision ?? 1, ...backup.planSchedules.filter((row) => row.planId === plan.id).flatMap((row) => [row.revision as number, (row.revision as number) - 1])]);
        for (const revision of revisions) add('manual-plan-due', [plan.id, revision], `manualPlans:${plan.id}`);
    }
    for (const fact of backup.factCards) add('manual-fact', [fact.id, fact.version], `factCards:${fact.id}`);
    return targets;
}
export function planWorkbenchImport(backup: ResearchBackupV2, preview: ResearchImportPreview, existing: Record<WorkbenchCollection, Row[]>, userId: string): ResearchImportPreview {
    const graph = workbenchGraph(backup); const blocked = new Set<string>();
    const entries: NonNullable<ResearchImportPreview['workbench']> = [];
    const stateTargets = handlingStateTargets(backup, userId);
    let waitingCapacity = Math.max(0, 100 - existing.manualPlans.filter((row) => row.manualState === 'waiting').length);
    let groupCapacity = Math.max(0, 10 - new Set(existing.peerGroups.map((row) => row.slot)).size);
    for (const item of preview.research) if (item.status !== 'import') blocked.add(`research:${item.symbol}`);
    for (const collection of WORKBENCH_COLLECTIONS) for (const row of backup[collection]) {
        const id = workbenchRowId(collection, row); const destination = collection === 'comparisons' || collection === 'peerGroups' ? researchImportId(userId, id) : collection === 'changeStates' ? stateTargets.get(id)?.destination : id;
        const exists = existing[collection].some((current) => {
            const currentId = workbenchRowId(collection, current);
            return currentId === id || currentId === destination || (row.clientRequestId !== undefined && current.clientRequestId === row.clientRequestId) || (row.requestId !== undefined && current.requestId === row.requestId) || (row.draftId !== undefined && current.draftId === row.draftId);
        });
        let status: ImportStatus = exists ? 'skip-existing' : 'import';
        if (collection === 'changeStates' && !destination) status = 'skip-unsupported';
        if (status !== 'import') blocked.add(`${collection}:${id}`);
        entries.push({ collection, id, status });
    }
    // Propagate conflicts in both directions. A skipped observation cannot strand a saved fact or review.
    const queue = [...blocked];
    for (let index = 0; index < queue.length; index++) for (const neighbor of graph.get(queue[index]) ?? []) if (!blocked.has(neighbor)) { blocked.add(neighbor); queue.push(neighbor); }
    for (const item of preview.research) if (item.status === 'import' && blocked.has(`research:${item.symbol}`)) item.status = 'skip-related';
    for (const item of entries) if (item.status === 'import' && blocked.has(`${item.collection}:${item.id}`)) item.status = 'skip-related';
    // Allocate capacity to whole eligible components, after conflicts have removed blocked groups.
    const byNode = new Map(entries.map((item) => [`${item.collection}:${item.id}`, item]));
    const waitingNodes = new Set(backup.manualPlans.filter((row) => row.manualState === 'waiting').map((row) => `manualPlans:${row.id}`));
    const visited = new Set<string>();
    for (const start of graph.keys()) {
        if (visited.has(start) || blocked.has(start)) continue;
        const component = [start]; visited.add(start);
        for (let index = 0; index < component.length; index++) for (const neighbor of graph.get(component[index])!) if (!visited.has(neighbor)) { visited.add(neighbor); component.push(neighbor); }
        const plans = component.filter((key) => waitingNodes.has(key));
        const groups = component.filter((key) => byNode.get(key)?.collection === 'peerGroups');
        const plansFull = plans.length > waitingCapacity; const groupsFull = groups.length > groupCapacity;
        if (!plansFull && !groupsFull) { waitingCapacity -= plans.length; groupCapacity -= groups.length; continue; }
        for (const key of component) {
            const item = byNode.get(key);
            if (item) item.status = (plansFull && waitingNodes.has(key)) || (groupsFull && item.collection === 'peerGroups') ? 'skip-capacity' : 'skip-related';
            else if (key.startsWith('research:')) { const research = preview.research.find((row) => `research:${row.symbol}` === key); if (research) research.status = 'skip-related'; }
        }
    }
    return { ...preview, version: 2, capture: backup.capture, workbench: entries };
}
export function remapWorkbenchRow(backup: ResearchBackupV2, collection: WorkbenchCollection, row: Row, userId: string): Row {
    const result = structuredClone(row);
    if (collection === 'peerGroups' || collection === 'comparisons') { result._id = researchImportId(userId, row.id as string); delete result.id; }
    if (collection === 'factCards' && result.observationSnapshot) {
        const snapshot = result.observationSnapshot as Row; snapshot.recordId = researchAliasIds(backup, userId).get(snapshot.recordId as string)!;
    }
    if (collection === 'changeStates') result.changeId = handlingStateTargets(backup, userId).get(row.changeId as string)!.destination;
    if (collection === 'comparisons') {
        const group = (result.result as Row).group as Row | undefined;
        if (group && typeof group.id === 'string') group.id = researchImportId(userId, group.id);
    }
    return { ...result, userId };
}
export function remapResearchEvidence(record: BackupResearch, userId: string): Omit<BackupResearch, 'id'> {
    const { id, ...result } = structuredClone(record); void id;
    for (const entry of result.journal ?? []) if (entry.kind === 'review') for (const ref of entry.evidenceReferences ?? []) if (ref.kind === 'comparison') ref.id = researchImportId(userId, ref.id);
    return result;
}

export function researchBackupDigest(backup: ResearchBackup): string { return createHash('sha256').update(JSON.stringify(backup)).digest('hex'); }
export function researchImportId(userId: string, sourceId: string): string { return createHash('sha256').update(JSON.stringify(['openstock-research-v1', userId, sourceId])).digest('hex').slice(0, 24); }
export function planResearchImport(backup: ResearchBackup, existingSymbols: string[], existingEvents: { _id?: unknown; clientRequestId: string; cancelledAt?: unknown }[], userId: string): ResearchImportPreview {
    const symbols = new Set(existingSymbols.map((symbol) => identifyMarketAndCode(symbol).normalizedSymbol));
    const requests = new Set(existingEvents.map((row) => row.clientRequestId));
    const eventIds = new Set(existingEvents.map((row) => String(row._id)));
    let activeEvents = existingEvents.filter((row) => !row.cancelledAt).length;
    return {
        digest: researchBackupDigest(backup),
        research: [...groupBackupResearch(backup.research)].map(([symbol, records]) => ({ symbol, records: records.length, status: symbols.has(symbol) ? 'skip-existing' : 'import' })),
        manualEvents: backup.manualEvents.map((event) => {
            const exists = requests.has(event.clientRequestId) || eventIds.has(event.id) || eventIds.has(researchImportId(userId, event.id));
            const status = exists ? 'skip-existing' : !event.cancelledAt && activeEvents >= 100 ? 'skip-capacity' : 'import';
            if (status === 'import' && !event.cancelledAt) activeEvents++;
            return { id: event.id, title: event.title, status };
        }),
        referenceAlerts: backup.alertReferences.alerts.length,
    };
}
