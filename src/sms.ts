/**
 * Outbound SMS — Twilio REST API, no SDK dependency.
 *
 * Same contract as email: a notification lane, fail-open, never a control
 * path. Inert until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are
 * set — the Notifications page reads smsConfigured() and keeps the channel
 * marked "provider not connected" until then, so no toggle over-promises.
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || '';

export function smsConfigured(): boolean {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM);
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!smsConfigured()) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 201) return true;
    console.error(`[sms] Twilio HTTP ${res.status}:`, (await res.text()).slice(0, 200));
    return false;
  } catch (err) {
    console.error('[sms] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
