/**
 * Notification preferences — pure catalog + rules (no I/O).
 *
 * The catalog is the single source of truth for what a user can subscribe
 * to. Every entry states its delivery honesty: `active` lanes send today;
 * `pending` lanes record the preference now and start delivering the moment
 * their sender ships — the UI must say so rather than imply delivery.
 */

export const NOTIFICATION_CHANNELS = [
  {
    id: 'email' as const,
    label: 'Email',
    // Live since 2026-07-21: team-change and connector-health emails send via
    // SendGrid; the weekly-brief lane joins as the digest recipients ship.
    status: 'active' as const,
    destinationHint: 'Defaults to your account email',
  },
  {
    id: 'sms' as const,
    label: 'Text (SMS)',
    status: 'pending-provider' as const,
    destinationHint: 'Mobile number — texting activates once an SMS provider is connected',
  },
];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]['id'];

export const NOTIFICATION_CATALOG = [
  {
    id: 'weekly-brief',
    label: 'Weekly Brief',
    description: 'The owner digest: sales, trends, and exceptions for your stores, once a week.',
    defaultEnabled: true,
  },
  {
    id: 'daily-sales-summary',
    label: 'Daily sales summary',
    description: 'Yesterday in one email: revenue, transactions, and anything unusual.',
    defaultEnabled: false,
  },
  {
    id: 'connector-health',
    label: 'Store connection issues',
    description: 'A connected POS stops syncing or its connection test starts failing.',
    defaultEnabled: true,
  },
  {
    id: 'low-stock',
    label: 'Low stock alerts',
    description: 'Items that fall below their configured reorder point.',
    defaultEnabled: false,
  },
  {
    id: 'team-changes',
    label: 'Team changes',
    description: 'Someone is invited to, joins, or is removed from this workspace.',
    defaultEnabled: true,
  },
];
export type NotificationEvent = (typeof NOTIFICATION_CATALOG)[number]['id'];

export interface PreferenceRow {
  event_type: string;
  channel: string;
  enabled: boolean;
  destination: string | null;
}

/** Catalog × channels merged with saved rows — unset pairs fall back to the
 * catalog default (email) / off (sms). This is the GET response shape. */
export function mergePreferences(saved: PreferenceRow[]): Array<{
  event: string; channel: string; enabled: boolean; destination: string | null;
}> {
  const byKey = new Map(saved.map((r) => [`${r.event_type}:${r.channel}`, r]));
  const merged: Array<{ event: string; channel: string; enabled: boolean; destination: string | null }> = [];
  for (const event of NOTIFICATION_CATALOG) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const row = byKey.get(`${event.id}:${channel.id}`);
      merged.push({
        event: event.id,
        channel: channel.id,
        enabled: row ? row.enabled : channel.id === 'email' ? event.defaultEnabled : false,
        destination: row?.destination ?? null,
      });
    }
  }
  return merged;
}

/** Validate one preference update. Destinations get a light shape check —
 * the sender revalidates at delivery time. */
export function validatePreferenceUpdate(body: unknown): { event: string; channel: NotificationChannel; enabled: boolean; destination: string | null } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON' };
  const rec = body as Record<string, unknown>;
  const event = typeof rec.event === 'string' ? rec.event : '';
  if (!NOTIFICATION_CATALOG.some((e) => e.id === event)) return { error: `Unknown notification event: ${event || '(missing)'}` };
  const channel = typeof rec.channel === 'string' ? rec.channel : '';
  if (!NOTIFICATION_CHANNELS.some((c) => c.id === channel)) return { error: `Unknown channel: ${channel || '(missing)'}` };
  if (typeof rec.enabled !== 'boolean') return { error: 'enabled must be true or false' };
  let destination: string | null = null;
  if (rec.destination != null) {
    if (typeof rec.destination !== 'string') return { error: 'destination must be a string' };
    const trimmed = rec.destination.trim();
    if (trimmed) {
      if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { error: 'destination must be a valid email address' };
      if (channel === 'sms' && !/^\+?[0-9\s().-]{7,20}$/.test(trimmed)) return { error: 'destination must be a valid phone number' };
      destination = trimmed;
    }
  }
  return { event, channel: channel as NotificationChannel, enabled: rec.enabled, destination };
}

/** Delivery-side gate: is this event enabled on this channel for the user?
 * Unset pairs use the same defaults the UI shows. First consumer: the
 * weekly-brief digest generator. */
export function isEnabled(saved: PreferenceRow[], event: string, channel: NotificationChannel): boolean {
  const row = saved.find((r) => r.event_type === event && r.channel === channel);
  if (row) return row.enabled;
  const def = NOTIFICATION_CATALOG.find((e) => e.id === event);
  return channel === 'email' ? Boolean(def?.defaultEnabled) : false;
}
