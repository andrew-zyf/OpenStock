import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { validateObservationInput, type SavedWatchlistRecord } from '@/lib/watchlist-observation';
import { isMarketDate, validateReviewInput, type WatchlistJournalEntry } from '@/lib/watchlist-review';

// Byte and BSON limits are authoritative; count guards must not reject ordinary long-lived archives.
export const RESEARCH_BACKUP_LIMITS = { bytes: 32 * 1024 * 1024, records: 1_000_000, events: 1_000_000, alerts: 1_000_000, journal: 1_000_000, bson: 12 * 1024 * 1024 } as const;
export type BackupResearch = Omit<SavedWatchlistRecord, '_id'> & { id: string; archivedAt?: string | null };
export type BackupManualEvent = { id: string; symbol: string; title: string; date: string; kind: 'earnings' | 'ex-dividend' | 'other'; sourceUrl?: string; note?: string; clientRequestId: string; createdAt: string; cancelledAt?: string };
type Row = Record<string, unknown>;
export type ResearchBackup = { format: 'openstock-research'; version: 1; exportedAt: string; research: BackupResearch[]; manualEvents: BackupManualEvent[]; alertReferences: { referenceOnly: true; alerts: Row[] } };
export type ResearchImportPreview = { digest: string; research: { symbol: string; records: number; status: 'import' | 'skip-existing' }[]; manualEvents: { id: string; title: string; status: 'import' | 'skip-existing' | 'skip-capacity' }[]; referenceAlerts: number };
export type ResearchBackupActionResult<T> = { success: true; data: T } | { success: false; code: 'INVALID_BACKUP' | 'PREVIEW_CHANGED' | 'TRANSACTIONS_UNSUPPORTED' | 'LIFECYCLE_BUSY' | 'LIFECYCLE_MAINTENANCE' | 'BACKUP_FAILED'; error: string };
export class ResearchBackupValidationError extends Error {}
const observationKeys = ['group', 'note', 'invalidation', 'targetPrice', 'reviewStatus', 'nextReviewDate', 'proximityPercent'];
const researchKeys = ['id', 'symbol', 'company', 'addedAt', ...observationKeys, 'reviewedAt', 'observationUpdatedAt', 'initialSnapshot', 'journal', 'journalVersion', 'archivedAt'];
const eventKeys = ['id', 'symbol', 'title', 'date', 'kind', 'sourceUrl', 'note', 'clientRequestId', 'createdAt', 'cancelledAt'];
const snapshotKeys = ['price', 'currency', 'source', 'asOf', 'fetchedAt', 'priceBasis', 'adjustment'];
const reviewKeys = ['kind', 'id', 'createdAt', 'tradingDate', 'hypothesis', 'changes', 'conclusion', 'verificationType', 'evidenceURLs', 'nextReviewDate', 'correctionOf', 'clientRequestId', 'sourceQuote'];
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
    const root = object(parsed, ['format', 'version', 'exportedAt', 'research', 'manualEvents', 'alertReferences']);
    if (root.format !== 'openstock-research' || root.version !== 1) throw new Error('不支持的备份格式或版本');
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
