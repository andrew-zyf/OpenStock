import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ check: vi.fn(), heartbeat: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { createFunction: (options: unknown, handler: unknown) => ({ options, handler }) } }));
vi.mock('@/lib/alerts/checker', () => ({ runAlertCheck: mocks.check }));
vi.mock('@/lib/alerts/health', () => ({ withAlertJobHeartbeat: mocks.heartbeat }));
vi.mock('@/lib/nodemailer', () => ({ sendNewsSummaryEmail: vi.fn(), sendWelcomeEmail: vi.fn() }));
vi.mock('@/lib/actions/user.actions', () => ({ getAllUsersForNewsEmail: vi.fn(), getWatchlistSymbolsByEmail: vi.fn() }));
vi.mock('@/lib/actions/finnhub.actions', () => ({ getNews: vi.fn() }));
vi.mock('@/lib/ai-provider', () => ({ callAIProviderWithFallback: vi.fn() }));
import { checkStockAlerts } from '@/lib/inngest/functions';

describe('scheduled alert heartbeat integration', () => {
    it('wraps only the actual scheduled check inside its Inngest step', async () => {
        const registered = checkStockAlerts as unknown as {
            options: { id: string; concurrency: number; triggers: { cron: string }[] };
            handler: (context: { step: { run: (name: string, task: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown>;
        };
        mocks.check.mockResolvedValue({ status: 'checked', processed: 0, triggered: 0 });
        mocks.heartbeat.mockImplementation((task: () => Promise<unknown>) => task());
        const step = { run: vi.fn(async (_name: string, task: () => Promise<unknown>) => task()) };
        expect(registered.options).toMatchObject({ id: 'check-stock-alerts', concurrency: 1, triggers: [{ cron: '*/5 * * * *' }] });
        await expect(registered.handler({ step })).resolves.toEqual({ status: 'checked', processed: 0, triggered: 0 });
        expect(step.run).toHaveBeenCalledWith('sample-crossing-alerts', expect.any(Function));
        expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
        expect(mocks.check).toHaveBeenCalledTimes(1);
    });
});
