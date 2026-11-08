import { describe, expect, it } from 'vitest';
import { Watchlist } from '@/database/models/watchlist.model';

// Schema-only validation: never connects to a database or writes a document.
describe('watchlist journal persistence schema', () => {
    it('excludes growing history from ordinary queries and keeps the initial snapshot immutable', () => {
        expect(Watchlist.schema.path('journal').options.select).toBe(false);
        expect(Watchlist.schema.path('initialSnapshot').options.immutable).toBe(true);
        const legacy = new Watchlist({ userId: 'owner', symbol: 'AAPL', company: 'Apple' });
        expect(legacy.journal).toBeUndefined();
        expect(legacy.journalVersion).toBeUndefined();
        expect(legacy.nextReviewDate).toBeUndefined();
        expect(legacy.proximityPercent).toBeUndefined();
    });

    it('preserves the whole immutable revision payload including merged legacy text', () => {
        const note = `${'甲'.repeat(1000)}\n\n${'乙'.repeat(1000)}`;
        const journal = [{ kind: 'observation', id: 'legacy', source: 'legacy-capture', modifiedAt: null,
            recordedAt: '2026-11-08T00:00:00.000Z', observation: { note, reviewStatus: 'watching' } }];
        const record = new Watchlist({ userId: 'owner', symbol: 'AAPL', company: 'Apple', journal });
        expect(record.validateSync()).toBeUndefined();
        expect(record.toObject().journal).toEqual(journal);
        expect(record.journal?.[0].kind === 'observation' && record.journal[0].observation.note).toHaveLength(2002);
    });

    it.each([
        { nextReviewDate: '2026-02-30' }, { nextReviewDate: '2026-11-08T00:00:00Z' },
        { proximityPercent: -1 }, { proximityPercent: 101 }, { proximityPercent: Infinity },
    ])('rejects invalid persisted planning fields %j', (fields) => {
        const record = new Watchlist({ userId: 'owner', symbol: 'AAPL', company: 'Apple', ...fields });
        expect(record.validateSync()).toBeDefined();
    });

    it.each([{ nextReviewDate: '2028-02-29', proximityPercent: 0 }, { nextReviewDate: null, proximityPercent: null }, { proximityPercent: 100 }])('accepts explicit clears and percentage bounds %j', (fields) => {
        const record = new Watchlist({ userId: 'owner', symbol: 'AAPL', company: 'Apple', ...fields });
        expect(record.validateSync()).toBeUndefined();
    });
});
