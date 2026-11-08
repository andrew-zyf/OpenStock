'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { ResearchEventHistoryRecord, ResearchChangeStateRecord } from '@/database/models/research-change.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { mergeWatchlistRecords, observationOwner, type SavedWatchlistRecord } from '@/lib/watchlist-observation';
import {
    CHANGE_LIMITATIONS, CHANGE_LIMITS, applyResearchChangeState, eventResearchChanges, journalResearchChanges,
    sortResearchChanges, validateResearchChangeState,
    type ResearchChange, type ResearchChangeInbox, type ResearchChangeStateInput, type ResearchJournalRecord,
} from '@/lib/market/research-changes';

async function candidates(userId: string, now: Date): Promise<{ entries: ResearchChange[]; truncated: boolean }> {
    const raw = await withWatchlistLifecycle(userId, { operation: 'research-changes-journal', readOnly: true }, async () => Watchlist.aggregate([
        { $match: { userId, archivedAt: null } }, { $sort: { addedAt: -1, _id: 1 } }, { $limit: CHANGE_LIMITS.records + 1 },
        { $project: { symbol: 1, company: 1, addedAt: 1, observationUpdatedAt: 1, nextReviewDate: 1,
            group: 1, note: 1, invalidation: 1, targetPrice: 1, reviewStatus: 1, reviewedAt: 1, proximityPercent: 1,
            journal: { $slice: [{ $ifNull: ['$journal', []] }, -CHANGE_LIMITS.journalTail] },
            journalTruncated: { $gt: [{ $size: { $ifNull: ['$journal', []] } }, CHANGE_LIMITS.journalTail] } } },
    ]));
    const records: (SavedWatchlistRecord & { journalTruncated?: boolean })[] = JSON.parse(JSON.stringify(raw.slice(0, CHANGE_LIMITS.records)));
    const merged = mergeWatchlistRecords(records);
    const journals: ResearchJournalRecord[] = merged.map((entry) => {
        const aliases = records.filter((record) => identifyMarketAndCode(record.symbol).normalizedSymbol === entry.symbol);
        return { ...entry, _id: observationOwner(aliases)._id,
            journal: [...new Map(aliases.flatMap((record) => record.journal ?? []).map((revision) => [revision.id, revision])).values()],
            journalTruncated: aliases.some((record) => record.journalTruncated) };
    });
    const symbols = merged.map((entry) => entry.symbol);
    const histories = symbols.length ? await ResearchEventHistoryRecord.find({ userId, symbol: { $in: symbols } })
        .sort({ observedAt: -1, identity: 1 }).limit(CHANGE_LIMITS.histories + 1).lean() : [];
    const all = sortResearchChanges([...eventResearchChanges(histories.slice(0, CHANGE_LIMITS.histories)), ...journalResearchChanges(journals, now)]);
    return { entries: all.slice(0, CHANGE_LIMITS.candidates),
        truncated: raw.length > CHANGE_LIMITS.records || histories.length > CHANGE_LIMITS.histories
            || records.some((record) => record.journalTruncated) || histories.some((history) => history.revision > CHANGE_LIMITS.versions)
            || all.length > CHANGE_LIMITS.candidates };
}

export async function getResearchChanges(options: { limit?: number; includeHandled?: boolean } = {}): Promise<ResearchChangeInbox> {
    const userId = await requireUserId();
    const limit = options?.limit ?? 50;
    if (!options || !Number.isInteger(limit) || limit < 1 || limit > CHANGE_LIMITS.entries
        || (options.includeHandled !== undefined && typeof options.includeHandled !== 'boolean')) throw new Error('待办分页大小须为 1–100');
    await connectToDatabase();
    const now = new Date();
    const result = await candidates(userId, now);
    const states = result.entries.length ? await ResearchChangeStateRecord.find({ userId, changeId: { $in: result.entries.map((entry) => entry.id) } })
        .limit(CHANGE_LIMITS.candidates).lean() : [];
    const byId = new Map(states.map((state) => [state.changeId, state]));
    const entries = result.entries.map((entry) => applyResearchChangeState(entry, byId.get(entry.id), now))
        .filter((entry) => options.includeHandled || entry.status === 'pending');
    return { entries: entries.slice(0, limit), limit, truncated: result.truncated || entries.length > limit, limitations: [...CHANGE_LIMITATIONS] };
}

export async function setResearchChangeState(input: ResearchChangeStateInput): Promise<ResearchChange> {
    const userId = await requireUserId();
    const now = new Date();
    const value = validateResearchChangeState(input, now);
    await connectToDatabase();
    // Re-derive the concrete fact from this user's active records. Clients cannot create arbitrary state rows.
    const entry = (await candidates(userId, now)).entries.find((change) => change.id === value.id);
    if (!entry) throw new Error('未找到当前账户可处理的变化，请刷新');
    const saved = { userId, changeId: value.id, status: value.status,
        snoozedUntil: value.snoozedUntil ? new Date(value.snoozedUntil) : null,
        revision: value.expectedStateVersion + 1, updatedAt: now };
    const conflict = () => new Error('待办已在其他页面更新，请刷新后重试');
    if (value.expectedStateVersion === 0) {
        try { await ResearchChangeStateRecord.create(saved); }
        catch (error) { if ((error as { code?: number }).code === 11000) throw conflict(); throw error; }
    } else {
        const result = await ResearchChangeStateRecord.updateOne({ userId, changeId: value.id, revision: value.expectedStateVersion }, { $set: saved });
        if (!result.matchedCount) throw conflict();
    }
    return applyResearchChangeState(entry, saved, now);
}
