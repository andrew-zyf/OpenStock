import { createHash, randomUUID } from 'node:crypto';
import { ResearchEventHistoryRecord, type ResearchEventHistory, type ResearchChangeState, type ResearchChangeStatus } from '@/database/models/research-change.model';
import type { MarketEvent } from '@/lib/market/events';
import { exchangeDateForSymbol, validCalendarDate } from '@/lib/market/dates';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { observationState, type ObservationRevision, type WatchlistJournalEntry } from '@/lib/watchlist-review';

export type ResearchChange = {
    id: string; kind: 'event-date' | 'observation' | 'review-due'; symbol: string; title: string;
    discoveredAt: string; source: string; sourceUrl?: string;
    before?: Record<string, unknown>; after?: Record<string, unknown>; dueDate?: string;
    status: ResearchChangeStatus; snoozedUntil?: string; stateVersion: number;
};
export type ResearchChangeInbox = { entries: ResearchChange[]; limit: number; truncated: boolean; limitations: string[] };
export type ResearchChangeStateInput = { id: string; status: ResearchChangeStatus; snoozedUntil?: string; expectedStateVersion: number };
export const CHANGE_LIMITS = { entries: 100, histories: 200, versions: 100, journalTail: 101, records: 100, candidates: 30_100 } as const;
export const CHANGE_LIMITATIONS = [
    '仅记录实际取回的 A股预约披露日期版本；首次观察建立基线，来源失败、空结果、离开日程窗口或移出自选均不视为撤回。',
    'TWSE 当前预告没有经验证的稳定事件标识，仅展示日程，不推断改期或撤回；行情可用性待办尚未接入。',
    '本收件箱不重新请求行情或事件来源，也不判断来源当前健康状态；空列表只表示已留存范围内无待处理项，不能解释为没有变化或数据可用。',
    '收件箱仅覆盖活动研究，最多读取 200 个事件的各 100 个最近版本、100 条研究的各 101 条最近历史；超限显示截取提示。',
];
function changeId(kind: ResearchChange['kind'], identity: unknown): string {
    return `${kind}:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}
function pending(change: Omit<ResearchChange, 'status' | 'stateVersion'>): ResearchChange {
    return { ...change, status: 'pending', stateVersion: 0 };
}

/** Persist actual source observations only. Missing rows never modify the saved history. */
export async function observeAutomaticEvents(userId: string, events: MarketEvent[], observedAt: Date): Promise<void> {
    // Conflicting duplicate rows have no trustworthy order. Skip their identity rather than inventing a change.
    const grouped = new Map<string, MarketEvent[]>();
    for (const event of events) {
        if (!event.versionIdentity || event.certainty === 'user') continue;
        const group = grouped.get(event.versionIdentity) ?? [];
        group.push(event); grouped.set(event.versionIdentity, group);
    }
    for (const [identity, group] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
        if (new Set(group.map((event) => event.date)).size !== 1) continue;
        const event = group.sort((a, b) => a.title.localeCompare(b.title) || a.source.localeCompare(b.source))[0];
        for (let attempt = 0; attempt < 4; attempt++) {
            const filter = { userId, identity };
            const saved = await ResearchEventHistoryRecord.findOne(filter).lean();
            const previous = saved?.versions.at(-1);
            if (saved && saved.observedAt.getTime() >= observedAt.getTime()) break;
            if (saved && previous?.date === event.date) {
                // This watermark belongs to a real source response, not a page-read heartbeat.
                // It prevents a delayed older response inventing a change after this observation.
                const result = await ResearchEventHistoryRecord.updateOne({ ...filter, revision: saved.revision }, { $max: { observedAt } });
                if (result.matchedCount) break;
                if (attempt === 3) throw new Error('事件版本并发更新，请稍后刷新');
                continue;
            }
            const version = { id: randomUUID(), date: event.date, ...(previous ? { previousDate: previous.date } : {}),
                title: event.title, source: event.source, sourceUrl: event.sourceUrl, discoveredAt: observedAt.toISOString() };
            if (!saved) {
                try {
                    await ResearchEventHistoryRecord.create({ ...filter, symbol: event.symbol, revision: 1, observedAt, versions: [version] });
                    break;
                } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
            } else {
                const result = await ResearchEventHistoryRecord.updateOne({ ...filter, revision: saved.revision, observedAt: saved.observedAt }, {
                    $set: { observedAt }, $inc: { revision: 1 },
                    $push: { versions: { $each: [version], $slice: -CHANGE_LIMITS.versions } },
                });
                if (result.matchedCount) break;
            }
            if (attempt === 3) throw new Error('事件版本并发更新，请稍后刷新');
        }
    }
}

export function eventResearchChanges(histories: ResearchEventHistory[]): ResearchChange[] {
    return histories.flatMap((history) => history.versions.filter((version) => version.previousDate !== undefined).map((version) => pending({
        id: changeId('event-date', [history.identity, version.id]), kind: 'event-date', symbol: history.symbol,
        title: version.title, discoveredAt: version.discoveredAt, source: version.source, sourceUrl: version.sourceUrl,
        before: { date: version.previousDate }, after: { date: version.date },
    })));
}
export type ResearchJournalRecord = {
    _id: unknown; symbol: string; journal?: WatchlistJournalEntry[]; nextReviewDate?: string | null;
    observationUpdatedAt?: Date | string | null; addedAt?: Date | string; journalTruncated?: boolean;
};
export function journalResearchChanges(records: ResearchJournalRecord[], now: Date): ResearchChange[] {
    const result: ResearchChange[] = [];
    for (const record of records) {
        const symbol = identifyMarketAndCode(record.symbol).normalizedSymbol;
        const revisions = (record.journal ?? []).filter((entry): entry is ObservationRevision => entry.kind === 'observation')
            .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
        for (let index = 1; index < revisions.length; index++) {
            const revision = revisions[index];
            if (revision.source !== 'edit') continue;
            const before = observationState(revisions[index - 1].observation);
            const after = observationState(revision.observation);
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            result.push(pending({ id: changeId('observation', [symbol, revision.id]), kind: 'observation', symbol,
                title: '观察观点已修改', discoveredAt: revision.modifiedAt ?? revision.recordedAt,
                source: '已保存的观点版本', before, after }));
        }
        const dueDate = record.nextReviewDate;
        if (validCalendarDate(dueDate) && dueDate <= exchangeDateForSymbol(symbol, now)) {
            // The bounded journal tail can lose its last observation after review-only appends.
            // Always use the persisted observation token so an unchanged plan keeps its handling state.
            const updatedAt = record.observationUpdatedAt ? new Date(record.observationUpdatedAt).toISOString() : undefined;
            const version = updatedAt ?? 'legacy';
            result.push(pending({ id: changeId('review-due', [String(record._id), symbol, dueDate, version]),
                kind: 'review-due', symbol, title: '计划复核已到期', dueDate,
                discoveredAt: updatedAt ?? `${dueDate}T00:00:00.000Z`,
                source: '已保存的下次复核计划', after: { dueDate } }));
        }
    }
    return [...new Map(result.map((entry) => [entry.id, entry])).values()];
}
export function applyResearchChangeState(entry: ResearchChange, state: ResearchChangeState | undefined, now: Date): ResearchChange {
    if (!state) return entry;
    const snoozedUntil = state.snoozedUntil?.toISOString();
    return { ...entry, status: state.status === 'snoozed' && state.snoozedUntil && state.snoozedUntil <= now ? 'pending' : state.status,
        snoozedUntil, stateVersion: state.revision };
}
export function sortResearchChanges(entries: ResearchChange[]): ResearchChange[] {
    return entries.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt) || a.id.localeCompare(b.id));
}
export function validateResearchChangeState(input: ResearchChangeStateInput, now: Date): ResearchChangeStateInput {
    if (!input || typeof input.id !== 'string' || !/^(event-date|observation|review-due):[a-f0-9]{64}$/.test(input.id)
        || !['pending', 'processed', 'snoozed', 'ignored'].includes(input.status)
        || !Number.isSafeInteger(input.expectedStateVersion) || input.expectedStateVersion < 0) throw new Error('待办处理请求无效');
    if (input.status === 'snoozed') {
        const until = typeof input.snoozedUntil === 'string' ? Date.parse(input.snoozedUntil) : NaN;
        if (!Number.isFinite(until) || new Date(until).toISOString() !== input.snoozedUntil || until <= now.getTime()
            || until > now.getTime() + 366 * 86400_000) throw new Error('稍后核查时间须在未来一年内');
    } else if (input.snoozedUntil !== undefined) throw new Error('仅稍后核查可设置时间');
    return { id: input.id, status: input.status, expectedStateVersion: input.expectedStateVersion,
        ...(input.status === 'snoozed' ? { snoozedUntil: input.snoozedUntil } : {}) };
}
