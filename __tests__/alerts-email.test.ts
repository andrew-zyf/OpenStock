import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail, verify: () => {} }) } }));
let sendStockAlertEmail: typeof import('@/lib/nodemailer').sendStockAlertEmail;
beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODEMAILER_EMAIL', 'sender@example.com');
    vi.stubEnv('NODEMAILER_PASSWORD', 'mock-password');
    sendMail.mockReset().mockResolvedValue({ messageId: 'mock-message' });
    ({ sendStockAlertEmail } = await import('@/lib/nodemailer'));
});
afterEach(() => vi.unstubAllEnvs());

describe('alert email provenance and currency', () => {
    it('renders native currency and the persisted source time, escaping provenance in HTML', async () => {
        expect(await sendStockAlertEmail({ email: 'owner@example.com', symbol: '09988.HK', currentPrice: 101, targetPrice: 100, condition: 'ABOVE', currency: 'HKD', asOf: '2026-11-09T01:59:00.000Z', source: 'tencent<script>' })).toEqual({ status: 'sent', messageId: 'mock-message' });
        const mail = sendMail.mock.calls[0][0];
        expect(mail.html).toContain('HK$101.00');
        expect(mail.html).toContain('Mon, 09 Nov 2026 01:59:00 GMT');
        expect(mail.html).toContain('tencent&lt;script&gt;');
        expect(mail.html).not.toContain('<script>');
        expect(mail.text).toContain('was sampled');
        expect(mail.text).toContain('Source time: Mon, 09 Nov 2026 01:59:00 GMT');
    });
    it('preserves the default US currency for existing callers', async () => {
        await sendStockAlertEmail({ email: 'owner@example.com', symbol: 'AAPL', currentPrice: 99, targetPrice: 100, condition: 'BELOW' });
        expect(sendMail.mock.calls[0][0].html).toContain('$99.00');
    });
});
