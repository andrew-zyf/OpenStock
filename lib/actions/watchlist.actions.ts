'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { getSymbolAliases } from '@/lib/utils';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { fetchRealtimeQuotes } from '@/lib/realtime-market';
import {
    mergeWatchlistRecords, observationOwner, snapshotFromQuote, validateObservationInput,
    type ObservationInput, type SavedWatchlistRecord, type WatchlistEntry,
} from '@/lib/watchlist-observation';

// Tickers as Finnhub writes them (AAPL, BRK.B, RELIANCE.NS, M&M.NS, 0700.HK, BINANCE:BTCUSDT). Server actions take
// untrusted input, and every symbol here becomes Finnhub calls on /watchlist and in the news digest.
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.&:-]{0,24}$/;
const MAX_WATCHLIST = 50;

// -- CRUD Operations --

export async function addToWatchlist(symbol: string, company: string) {
    const userId = await requireUserId();
    const input = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(input)) throw new Error('无效的股票代码');
    const ticker = identifyMarketAndCode(input).normalizedSymbol;
    const name = String(company ?? '').trim().slice(0, 120);
    try {
        await connectToDatabase();

        const aliases = { userId, symbol: { $in: getSymbolAliases(input) } };
        const existing = await Watchlist.findOne(aliases);
        if (existing) {
            const records = await Watchlist.find(aliases).sort({ addedAt: -1 });
            return mergeWatchlistRecords(JSON.parse(JSON.stringify(records)))[0];
        }

        if ((await Watchlist.countDocuments({ userId })) >= MAX_WATCHLIST) {
            return { error: `自选列表已满（上限 ${MAX_WATCHLIST} 只股票），请移除部分后再添加。` };
        }

        // Quote availability must never prevent saving an observation. This adapter does not
        // import Finnhub actions, and explicitly rejects Taiwan's previous-close fallback.
        let initialSnapshot;
        try {
            initialSnapshot = snapshotFromQuote((await fetchRealtimeQuotes([ticker]))[ticker]);
        } catch {
            // Optional provider unavailable: leave the snapshot absent, including on later reads.
        }

        // Keep saved metadata, snapshot and addedAt intact if another request inserted it.
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
            // A concurrent upsert can lose the unique-index race. Reuse its saved record.
            newItem = await Watchlist.findOne(aliases);
            if (!newItem) throw error;
        }

        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return mergeWatchlistRecords([JSON.parse(JSON.stringify(newItem))])[0];
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        throw new Error('添加自选失败');
    }
}

export async function removeFromWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        await Watchlist.deleteMany({ userId, symbol: { $in: getSymbolAliases(symbol) } });
        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return { success: true };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        throw new Error('移出自选失败');
    }
}

export async function getUserWatchlist(): Promise<WatchlistEntry[]> {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const watchlist = await Watchlist.find({ userId }).sort({ addedAt: -1 });
        return mergeWatchlistRecords(JSON.parse(JSON.stringify(watchlist)));
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        return [];
    }
}

export async function updateWatchlistObservation(
    symbol: string,
    input: ObservationInput,
    expectedUpdatedAt?: string | null,
): Promise<{ success: true; entry: WatchlistEntry } | { success: false; code: 'CONFLICT' | 'NOT_FOUND'; error: string }> {
    const userId = await requireUserId();
    const ticker = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(ticker)) throw new Error('无效的股票代码');
    const patch = validateObservationInput(input);
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null
        && (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))
            || new Date(expectedUpdatedAt).toISOString() !== expectedUpdatedAt)) throw new Error('无效的观察版本');

    await connectToDatabase();
    const records: SavedWatchlistRecord[] = JSON.parse(JSON.stringify(
        await Watchlist.find({ userId, symbol: { $in: getSymbolAliases(ticker) } }).sort({ addedAt: -1 })
    ));
    if (!records.length) return { success: false, code: 'NOT_FOUND', error: '未找到自选记录' };
    const entry = mergeWatchlistRecords(records)[0];
    const conflict = { success: false, code: 'CONFLICT', error: '观察记录已更新，请刷新后重试' } as const;
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== (entry.observationUpdatedAt ?? null)) return conflict;

    const owner = observationOwner(records);
    // Even callers omitting a version must not overwrite an edit racing this read.
    const observationUpdatedAt = new Date(Math.max(Date.now(), (Date.parse(entry.observationUpdatedAt || '') || 0) + 1));
    const updated = await Watchlist.findOneAndUpdate(
        { _id: owner._id, userId, symbol: owner.symbol, observationUpdatedAt: owner.observationUpdatedAt ? new Date(owner.observationUpdatedAt) : null },
        { $set: {
            group: entry.group ?? null, note: entry.note ?? null,
            invalidation: entry.invalidation ?? null, targetPrice: entry.targetPrice ?? null,
            reviewStatus: entry.reviewStatus, reviewedAt: entry.reviewedAt ? new Date(entry.reviewedAt) : null,
            ...patch,
            ...(patch.reviewStatus ? { reviewedAt: patch.reviewStatus === 'watching' ? null : observationUpdatedAt } : {}),
            observationUpdatedAt,
        } },
        { new: true },
    );
    if (!updated) return conflict;
    const saved: SavedWatchlistRecord = JSON.parse(JSON.stringify(updated));
    const result = mergeWatchlistRecords(records.map((record) => record._id === saved._id ? saved : record))[0];
    revalidatePath('/', 'layout');
    return { success: true, entry: result };
}

// Check if a symbol is in the user's watchlist
export async function isStockInWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const item = await Watchlist.findOne({ userId, symbol: { $in: getSymbolAliases(symbol) } });
        return !!item;
    } catch (error) {
        console.error('Error checking watchlist status:', error);
        return false;
    }
}
