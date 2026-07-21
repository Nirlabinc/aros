/**
 * Outbound email — SendGrid HTTP API, no SDK dependency.
 *
 * Fail-open by design: email is a notification lane, never a control path.
 * Missing config or a SendGrid error logs and returns false; callers treat
 * delivery as best-effort and must never block or fail their operation on it.
 */

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@aros.live';

export function emailConfigured(): boolean {
  return Boolean(SENDGRID_API_KEY);
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.warn('[email] SENDGRID_API_KEY not set — skipping send:', subject);
    return false;
  }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${SENDGRID_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: EMAIL_FROM, name: 'AROS' },
        subject,
        content: [
          { type: 'text/plain', value: text },
          ...(html ? [{ type: 'text/html', value: html }] : []),
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 202) return true;
    console.error(`[email] SendGrid HTTP ${res.status} for "${subject}":`, (await res.text()).slice(0, 200));
    return false;
  } catch (err) {
    console.error('[email] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
