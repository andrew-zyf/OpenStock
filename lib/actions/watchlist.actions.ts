'use server';

import { randomUUID } from 'node:crypto';
import { BSON } from 'mongodb';
import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { withWatchlistLifecycle, WatchlistLifecycleError, type LifecycleFailure } from '@/lib/watchlist-lifecycle';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { getSymbolAliases } from '@/lib/utils';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { fetchRealtimeQuotes } from '@/lib/realtime-market';
import {
    mergeWatchlistRecords, observationOwner, snapshotFromQuote, validateObservationInput,
    type ObservationInput, type SavedWatchlistRecord, type WatchlistEntry,
} from '@/lib/watchlist-observation';
import {
    compareJournalEntries, journalTime, observationState, reviewRequest, validateReviewInput,
    type ObservationRevision, type ObservationState, type WatchlistJournalEntry,
    type WatchlistJournalPage, type WatchlistReview, type WatchlistReviewInput,
} from '@/lib/watchlist-review';

// Tickers as Finnhub writes them (AAPL, BRK.B, RELIANCE.NS, M&M.NS, 0700.HK, BINANCE:BTCUSDT). Server actions take
// untrusted input, and every symbol here becomes Finnhub calls on /watchlist and in the news digest.
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.&:-]{0,24}$/;
const MAX_WATCHLIST = 50;
const watchlistCapacity = { success: false, code: 'WATCHLIST_CAPACITY', error: `自选列表已满（上限 ${MAX_WATCHLIST} 只股票），请归档部分后再添加。` } as const;
const archivedFailure = { success: false, code: 'ARCHIVED', error: '研究记录已归档，请先恢复到自选后再编辑' } as const;

async function lifecycleWrite<T>(userId: string, operation: string, symbol: string, write: () => Promise<T>): Promise<T | LifecycleFailure> {
    try {
        return await withWatchlistLifecycle(userId, { operation, symbol: identifyMarketAndCode(symbol).normalizedSymbol }, write);
    } catch (error) {
        if (error instanceof WatchlistLifecycleError) return error.failure();
        throw error;
    }
}

// -- CRUD Operations --

export async function addToWatchlist(symbol: string, company: string) {
    const userId = await requireUserId();
    const input = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(input)) throw new Error('无效的股票代码');
    const ticker = identifyMarketAndCode(input).normalizedSymbol;
    const name = String(company ?? '').trim().slice(0, 120);
    try {
        return await withWatchlistLifecycle(userId, { operation: 'add', symbol: ticker }, async () => {
            const aliases = { userId, symbol: { $in: getSymbolAliases(input) } };
            const existing = await Watchlist.findOne(aliases);
            if (existing) {
                const restored = await restoreRecords(userId, input);
                return restored.success ? restored.entry : { error: restored.error };
            }
            if ((await Watchlist.countDocuments({ userId, archivedAt: null })) >= MAX_WATCHLIST) {
                return { error: watchlistCapacity.error };
            }

            // Optional quote availability never prevents saving research or creates a backfill.
            let initialSnapshot;
            try {
                initialSnapshot = snapshotFromQuote((await fetchRealtimeQuotes([ticker]))[ticker]);
            } catch { /* Leave the initial snapshot absent when the provider is unavailable. */ }

            let newItem;
            try {
                newItem = await Watchlist.findOneAndUpdate(
                    { userId, symbol: ticker },
                    { $setOnInsert: {
                        userId, symbol: ticker, company: name, addedAt: new Date(),
                        ...(initialSnapshot ? { initialSnapshot } : {}),
                    } },
                    { upsert: true, new: true }
                );
            } catch (error) {
                if ((error as { code?: number }).code !== 11000) throw error;
                newItem = await Watchlist.findOne(aliases);
                if (!newItem) throw error;
            }
            if (newItem?.archivedAt) {
                const restored = await restoreRecords(userId, input);
                return restored.success ? restored.entry : { error: restored.error };
            }
            revalidatePath('/', 'layout');
            return mergeWatchlistRecords([JSON.parse(JSON.stringify(newItem))])[0];
        });
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        if (error instanceof WatchlistLifecycleError) return error.failure();
        throw new Error('添加自选失败');
    }
}

export async function removeFromWatchlist(symbol: string) {
    const userId = await requireUserId();
    const ticker = checkedSymbol(symbol);
    try {
        // The shared user mutex serializes all aliases with restores, adds and ordinary reads.
        // Advancing the CAS token also rejects a journal write which read before this archive.
        await withWatchlistLifecycle(userId, { operation: 'archive', symbol: ticker }, async () => {
            await Watchlist.updateMany({ userId, symbol: { $in: getSymbolAliases(ticker) }, archivedAt: null }, {
                $set: { archivedAt: new Date() }, $inc: { journalVersion: 1 },
            });
        });
        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return { success: true };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        if (error instanceof WatchlistLifecycleError) return error.failure();
        throw new Error('移出自选失败');
    }
}

export async function getUserWatchlist(): Promise<WatchlistEntry[]> {
    const userId = await requireUserId();
    try {
        return await withWatchlistLifecycle(userId, { operation: 'read-active', readOnly: true }, async () => {
            const watchlist = await Watchlist.find({ userId, archivedAt: null }).sort({ addedAt: -1 });
            return mergeWatchlistRecords(JSON.parse(JSON.stringify(watchlist)));
        });
    } catch (error) {
        if (error instanceof WatchlistLifecycleError) throw error;
        console.error('Error fetching watchlist:', error);
        return [];
    }
}

export async function getArchivedWatchlist(): Promise<WatchlistEntry[]> {
    const userId = await requireUserId();
    try {
        return await withWatchlistLifecycle(userId, { operation: 'read-archived', readOnly: true }, async () => {
            const records = await Watchlist.find({ userId, archivedAt: { $ne: null } }).sort({ addedAt: -1 });
            return mergeWatchlistRecords(JSON.parse(JSON.stringify(records)));
        });
    } catch (error) {
        if (error instanceof WatchlistLifecycleError) throw error;
        console.error('Error fetching archived watchlist:', error);
        return [];
    }
}

type RestoreResult = { success: true; entry: WatchlistEntry }
    | { success: false; code: 'NOT_FOUND' | 'WATCHLIST_CAPACITY'; error: string } | LifecycleFailure;

async function restoreRecords(userId: string, ticker: string): Promise<RestoreResult> {
    const scope = { userId, symbol: { $in: getSymbolAliases(ticker) } };
    const records: SavedWatchlistRecord[] = JSON.parse(JSON.stringify(await Watchlist.find(scope).sort({ addedAt: -1 })));
    if (!records.length) return { success: false, code: 'NOT_FOUND', error: '未找到研究记录' };
    const archivedCount = records.filter((record) => record.archivedAt).length;
    if (archivedCount) {
        if ((await Watchlist.countDocuments({ userId, archivedAt: null })) + archivedCount > MAX_WATCHLIST) return watchlistCapacity;
        await Watchlist.updateMany({ ...scope, archivedAt: { $ne: null } }, {
            $set: { archivedAt: null }, $inc: { journalVersion: 1 },
        });
        const restored = await Watchlist.find(scope).sort({ addedAt: -1 });
        revalidatePath('/', 'layout');
        return { success: true, entry: mergeWatchlistRecords(JSON.parse(JSON.stringify(restored)))[0] };
    }
    return { success: true, entry: mergeWatchlistRecords(records)[0] };
}

/** Restoring keeps the saved identity, addedAt, snapshot and entire journal intact. */
export async function restoreWatchlist(symbol: string): Promise<RestoreResult> {
    const userId = await requireUserId();
    const ticker = checkedSymbol(symbol);
    try {
        return await withWatchlistLifecycle(userId, { operation: 'restore', symbol: identifyMarketAndCode(ticker).normalizedSymbol }, () => restoreRecords(userId, ticker));
    } catch (error) {
        if (error instanceof WatchlistLifecycleError) return error.failure();
        throw error;
    }
}

function checkedSymbol(symbol: string): string {
    const ticker = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(ticker)) throw new Error('无效的股票代码');
    return ticker;
}

async function journalRecords(userId: string, ticker: string): Promise<SavedWatchlistRecord[]> {
    return JSON.parse(JSON.stringify(await Watchlist.find({ userId, symbol: { $in: getSymbolAliases(ticker) } })
        .select('+journal').sort({ addedAt: -1 })));
}

function journalCAS(userId: string, owner: SavedWatchlistRecord) {
    return {
        _id: owner._id, userId, symbol: owner.symbol, archivedAt: null,
        observationUpdatedAt: owner.observationUpdatedAt ? new Date(owner.observationUpdatedAt) : null,
        journalVersion: owner.journalVersion ?? null,
    };
}

function entryAfterSave(records: SavedWatchlistRecord[], updated: unknown): WatchlistEntry {
    const saved: SavedWatchlistRecord = JSON.parse(JSON.stringify(updated));
    return mergeWatchlistRecords(records.map((record) => record._id === saved._id ? saved : record))[0];
}

/** Stay below MongoDB's 16 MiB document ceiling without ever truncating history. */
function checkJournalCapacity(owner: SavedWatchlistRecord, additions: WatchlistJournalEntry[], set: object) {
    if (BSON.calculateObjectSize({ ...owner, ...set, journal: [...(owner.journal || []), ...additions] }) > 12 * 1024 * 1024) {
        return { success: false, code: 'JOURNAL_CAPACITY', error: '观察历史已达到单条记录容量限制，本次未保存；请先导出并联系管理员扩容，已有历史不会被截断' } as const;
    }
}

function observationChange(records: SavedWatchlistRecord[], owner: SavedWatchlistRecord, entry: WatchlistEntry, patch: ObservationInput, now: string) {
    const previous = observationState(entry);
    const next: ObservationState = { ...previous };
    for (const key of ['group', 'note', 'invalidation', 'targetPrice', 'nextReviewDate', 'proximityPercent'] as const) {
        if (patch[key] !== undefined) Object.assign(next, { [key]: patch[key] ?? undefined });
    }
    if (patch.reviewStatus !== undefined && patch.reviewStatus !== previous.reviewStatus) {
        next.reviewStatus = patch.reviewStatus;
        next.reviewedAt = patch.reviewStatus === 'watching' ? undefined : now;
    }
    if (JSON.stringify(previous) === JSON.stringify(next)) return undefined;
    const revisions: ObservationRevision[] = [];
    const revisionId = `${String(owner.journalVersion ?? 0).padStart(12, '0')}_${randomUUID()}`;
    const archived = records.flatMap((record) => record.journal || [])
        .filter((item): item is ObservationRevision => item.kind === 'observation');
    const appendRevision = (revision: Omit<ObservationRevision, 'kind' | 'id' | 'recordedAt'>) => {
        revisions.push({ ...revision, kind: 'observation', id: `${revisionId}_${String(revisions.length).padStart(3, '0')}`, recordedAt: now });
    };
    // An authoritative merged view can hide older alias opinions. Archive each untouched alias
    // in the same owner CAS, recording provenance so later edits never recapture stale raw states.
    const unarchived = records.filter((record) => !archived.some((item) => item.sourceSymbol === record.symbol)
        && !record.journal?.some((item) => item.kind === 'observation' && !item.sourceSymbol))
        .sort((a, b) => (Date.parse(a.observationUpdatedAt || '') || 0) - (Date.parse(b.observationUpdatedAt || '') || 0)
            || Date.parse(a.addedAt) - Date.parse(b.addedAt) || a.symbol.localeCompare(b.symbol));
    for (const record of unarchived) {
        appendRevision({
            modifiedAt: record.observationUpdatedAt ?? null,
            source: record.observationUpdatedAt ? 'saved-revision' : 'legacy-capture',
            sourceSymbol: record.symbol, observation: observationState(mergeWatchlistRecords([record])[0]),
        });
    }
    // Keep the effective before-state adjacent to the edit. A matching older alias capture
    // elsewhere in history does not describe the transition after a different raw alias state.
    const preceding = revisions.at(-1) ?? [...archived].sort(compareJournalEntries)[0];
    if (!preceding || JSON.stringify(observationState(preceding.observation)) !== JSON.stringify(previous)) {
        appendRevision({ modifiedAt: entry.observationUpdatedAt ?? null,
            source: entry.observationUpdatedAt ? 'saved-revision' : 'legacy-capture', observation: previous });
    }
    appendRevision({ modifiedAt: now, source: 'edit', sourceSymbol: owner.symbol, observation: next });
    return {
        revisions,
        set: {
            group: next.group ?? null, note: next.note ?? null, invalidation: next.invalidation ?? null,
            targetPrice: next.targetPrice ?? null, reviewStatus: next.reviewStatus,
            reviewedAt: next.reviewedAt ? new Date(next.reviewedAt) : null,
            nextReviewDate: next.nextReviewDate ?? null, proximityPercent: next.proximityPercent ?? null,
            // Retain the existing monotonic CAS token; journal.modifiedAt is the real wall clock.
            observationUpdatedAt: new Date(Math.max(Date.parse(now), (Date.parse(entry.observationUpdatedAt || '') || 0) + 1)),
        },
    };
}

export async function updateWatchlistObservation(
    symbol: string,
    input: ObservationInput,
    expectedUpdatedAt?: string | null,
): Promise<{ success: true; entry: WatchlistEntry } | { success: false; code: 'CONFLICT' | 'NOT_FOUND' | 'ARCHIVED' | 'JOURNAL_CAPACITY'; error: string } | LifecycleFailure> {
    const userId = await requireUserId();
    const ticker = checkedSymbol(symbol);
    const patch = validateObservationInput(input);
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null
        && (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))
            || new Date(expectedUpdatedAt).toISOString() !== expectedUpdatedAt)) throw new Error('无效的观察版本');

    return lifecycleWrite<Awaited<ReturnType<typeof updateWatchlistObservation>>>(userId, 'observation', ticker, async () => {
    const records = await journalRecords(userId, ticker);
    if (!records.length) return { success: false, code: 'NOT_FOUND', error: '未找到自选记录' };
    const entry = mergeWatchlistRecords(records)[0];
    if (entry.archivedAt) return archivedFailure;
    const conflict = { success: false, code: 'CONFLICT', error: '观察记录已更新，请刷新后重试' } as const;
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== (entry.observationUpdatedAt ?? null)) return conflict;
    const owner = observationOwner(records);
    const change = observationChange(records, owner, entry, patch, new Date(Date.now()).toISOString());
    if (!change) return { success: true, entry };
    const capacityFailure = checkJournalCapacity(owner, change.revisions, change.set);
    if (capacityFailure) return capacityFailure;
    const updated = await Watchlist.findOneAndUpdate(journalCAS(userId, owner), {
        $set: change.set, $push: { journal: { $each: change.revisions } }, $inc: { journalVersion: 1 },
    }, { new: true });
    if (!updated) return conflict;
    const result = entryAfterSave(records, updated);
    revalidatePath('/', 'layout');
    return { success: true, entry: result };
    });
}

export async function getWatchlistJournal(
    symbol: string,
    options: { limit?: number; before?: string } = {},
): Promise<WatchlistJournalPage> {
    const userId = await requireUserId();
    const ticker = checkedSymbol(symbol);
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('历史分页大小须为 1–100');
    let before: { time: string; id: string } | undefined;
    if (options.before !== undefined) {
        try {
            if (typeof options.before !== 'string' || options.before.length > 500) throw new Error();
            const value = JSON.parse(Buffer.from(options.before, 'base64url').toString('utf8'));
            if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id)
                || typeof value.time !== 'string' || !Number.isFinite(Date.parse(value.time))
                || new Date(value.time).toISOString() !== value.time) throw new Error();
            before = value;
        } catch { throw new Error('无效的历史分页游标'); }
    }
    await connectToDatabase();
    const scope = { userId, symbol: { $in: getSymbolAliases(ticker) } };
    if (!await Watchlist.findOne(scope, { _id: 1 })) return { success: false, code: 'NOT_FOUND', error: '未找到自选记录' };
    // Page inside MongoDB across every saved alias; never load all journals into the response process.
    const entries: WatchlistJournalEntry[] = await Watchlist.aggregate([
        { $match: scope },
        { $unwind: '$journal' },
        { $replaceRoot: { newRoot: '$journal' } },
        { $addFields: { _journalTime: { $ifNull: ['$recordedAt', '$createdAt'] } } },
        ...(before ? [{ $match: { $or: [
            { _journalTime: { $lt: before.time } },
            { _journalTime: before.time, id: { $lt: before.id } },
        ] } }] : []),
        { $sort: { _journalTime: -1, id: -1 } },
        { $limit: limit + 1 },
        { $project: { _journalTime: 0 } },
    ]);
    const page = entries.slice(0, limit);
    const last = page.at(-1);
    return {
        success: true, entries: page,
        ...(entries.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ time: journalTime(last), id: last.id })).toString('base64url') } : {}),
    };
}

function entriesForReview(records: SavedWatchlistRecord[], review: WatchlistReview): WatchlistJournalEntry[] {
    return records.flatMap((record) => record.journal || []).filter((item) =>
        item.id === review.id || (item.kind === 'observation' && item.reviewId === review.id));
}

export async function appendWatchlistReview(
    symbol: string,
    input: WatchlistReviewInput,
): Promise<{ success: true; review: WatchlistReview; deduplicated: boolean; entry: WatchlistEntry; entries: WatchlistJournalEntry[] }
    | { success: false; code: 'CONFLICT' | 'NOT_FOUND' | 'INVALID_CORRECTION' | 'ARCHIVED' | 'JOURNAL_CAPACITY'; error: string } | LifecycleFailure> {
    const userId = await requireUserId();
    const ticker = checkedSymbol(symbol);
    const request = validateReviewInput(input);
    return lifecycleWrite<Awaited<ReturnType<typeof appendWatchlistReview>>>(userId, 'review', ticker, async () => {
    const records = await journalRecords(userId, ticker);
    if (!records.length) return { success: false, code: 'NOT_FOUND', error: '未找到自选记录' };
    const conflict = { success: false, code: 'CONFLICT', error: '复核记录已变化或请求标识已被使用，请刷新后使用原请求重试' } as const;
    const existing = records.flatMap((record) => record.journal || []).filter((item): item is WatchlistReview => item.kind === 'review');
    const duplicate = existing.find((item) => item.clientRequestId === request.clientRequestId);
    if (duplicate) return JSON.stringify(reviewRequest(duplicate)) === JSON.stringify(request)
        ? { success: true, review: duplicate, deduplicated: true, entry: mergeWatchlistRecords(records)[0], entries: entriesForReview(records, duplicate) } : conflict;
    if (request.correctionOf && !existing.some((item) => item.id === request.correctionOf)) {
        return { success: false, code: 'INVALID_CORRECTION', error: '更正引用必须属于当前用户的这只股票的已有复核条目' };
    }
    const entry = mergeWatchlistRecords(records)[0];
    // Exact request retries above remain readable after archive; all new writes require restore.
    if (entry.archivedAt) return archivedFailure;
    const owner = observationOwner(records);
    let sourceQuote;
    try {
        sourceQuote = snapshotFromQuote((await fetchRealtimeQuotes([entry.symbol]))[entry.symbol]);
    } catch { /* An optional quote must never prevent appending a note. */ }
    const now = new Date(Date.now()).toISOString();
    const review: WatchlistReview = {
        ...request, kind: 'review', id: randomUUID(), createdAt: now,
        ...(sourceQuote ? { sourceQuote } : {}),
    };
    const change = request.nextReviewDate !== undefined
        ? observationChange(records, owner, entry, { nextReviewDate: request.nextReviewDate }, now) : undefined;
    const additions: WatchlistJournalEntry[] = [...(change?.revisions.map((revision) => ({ ...revision, reviewId: review.id })) || []), review];
    const capacityFailure = checkJournalCapacity(owner, additions, change?.set || {});
    if (capacityFailure) return capacityFailure;
    const updated = await Watchlist.findOneAndUpdate(journalCAS(userId, owner), {
        ...(change ? { $set: change.set } : {}),
        $push: { journal: { $each: additions } }, $inc: { journalVersion: 1 },
    }, { new: true });
    if (!updated) {
        // A concurrent retry may have won the CAS. Return its original server time/quote/id.
        const latest = await journalRecords(userId, ticker);
        const winner = latest.flatMap((record) => record.journal || []).find((item): item is WatchlistReview =>
            item.kind === 'review' && item.clientRequestId === request.clientRequestId);
        if (winner && JSON.stringify(reviewRequest(winner)) === JSON.stringify(request)) {
            return { success: true, review: winner, deduplicated: true, entry: mergeWatchlistRecords(latest)[0], entries: entriesForReview(latest, winner) };
        }
        return conflict;
    }
    revalidatePath('/', 'layout');
    return { success: true, review, deduplicated: false, entry: entryAfterSave(records, updated), entries: additions };
    });
}

// Check if a symbol is in the user's watchlist
export async function isStockInWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        return await withWatchlistLifecycle(userId, { operation: 'read-membership', readOnly: true }, async () => {
            const item = await Watchlist.findOne({ userId, symbol: { $in: getSymbolAliases(symbol) }, archivedAt: null });
            return !!item;
        });
    } catch (error) {
        if (error instanceof WatchlistLifecycleError) throw error;
        console.error('Error checking watchlist status:', error);
        return false;
    }
}
