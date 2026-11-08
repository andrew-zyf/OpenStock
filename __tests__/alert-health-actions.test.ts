import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), find: vi.fn(), select: vi.fn(), lean: vi.fn(), enabled: true }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/database/models/job-run-state.model', () => ({ JobRunState: { findById: mocks.find } }));
vi.mock('@/lib/market-data', () => ({ get alertsEnabled() { return mocks.enabled; } }));
import { getAlertHealthStatus } from '@/lib/actions/alert-health.actions';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-08T10:00:00Z');
    mocks.enabled = true;
    mocks.auth.mockResolvedValue('private-user-id');
    mocks.connect.mockResolvedValue({});
    mocks.find.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ lean: mocks.lean });
    mocks.lean.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('authenticated read-only job summary', () => {
    it('requires auth before touching persistence, even in cached mode', async () => {
        mocks.enabled = false;
        mocks.auth.mockRejectedValue(new Error('Unauthorized'));
        await expect(getAlertHealthStatus()).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.find).not.toHaveBeenCalled();
    });
    it('returns cached mode without connecting to DB', async () => {
        mocks.enabled = false;
        expect(await getAlertHealthStatus()).toMatchObject({ status: 'cached-mode', lastCompletedAt: null });
        expect(mocks.connect).not.toHaveBeenCalled();
    });
    it('does not present a page read as worker completion', async () => {
        const result = await getAlertHealthStatus();
        expect(result).toMatchObject({ status: 'no-heartbeat', lastStartedAt: null, lastCompletedAt: null, checkedAt: '2026-11-08T10:00:00.000Z' });
        expect(mocks.select).toHaveBeenCalledWith('lastStartedAt lastCompletedAt lastFailedAt latestOutcome');
    });
    it('allowlists timestamps and outcome, never raw records, run IDs, errors or identities', async () => {
        mocks.lean.mockResolvedValue({
            _id: 'internal', runId: 'private-run-id', userId: 'private-user-id', email: 'private@example.com',
            error: 'private global failure', key: 'private-key', lastStartedAt: new Date('2026-11-08T09:59:00Z'),
            lastCompletedAt: new Date('2026-11-08T09:59:10Z'), latestOutcome: 'completed',
        });
        const result = await getAlertHealthStatus();
        expect(result.status).toBe('recent');
        expect(Object.keys(result).sort()).toEqual(['status', 'lastStartedAt', 'lastCompletedAt', 'lastFailedAt', 'checkedAt', 'expectedIntervalSeconds', 'overdueAfterSeconds'].sort());
        expect(JSON.stringify(result)).not.toContain('private');
    });
    it('returns unknown without leaking database failure details', async () => {
        mocks.connect.mockRejectedValue(new Error('private database URI'));
        const result = await getAlertHealthStatus();
        expect(result.status).toBe('unknown');
        expect(JSON.stringify(result)).not.toContain('private');
    });
});
