/**
 * Notification-preference rules: catalog defaults, merge behavior,
 * validation, and the delivery-side gate all agree with each other.
 */
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATALOG, NOTIFICATION_CHANNELS, mergePreferences, validatePreferenceUpdate, isEnabled } from '../notifications';

describe('mergePreferences', () => {
  it('emits every event × channel pair with code defaults when nothing is saved', () => {
    const merged = mergePreferences([]);
    expect(merged.length).toBe(NOTIFICATION_CATALOG.length * NOTIFICATION_CHANNELS.length);
    const brief = merged.find((m) => m.event === 'weekly-brief' && m.channel === 'email');
    expect(brief?.enabled).toBe(true);
    const briefSms = merged.find((m) => m.event === 'weekly-brief' && m.channel === 'sms');
    expect(briefSms?.enabled).toBe(false); // sms never defaults on
  });
  it('saved rows override defaults', () => {
    const merged = mergePreferences([{ event_type: 'weekly-brief', channel: 'email', enabled: false, destination: 'a@b.co' }]);
    const brief = merged.find((m) => m.event === 'weekly-brief' && m.channel === 'email');
    expect(brief).toMatchObject({ enabled: false, destination: 'a@b.co' });
  });
});

describe('validatePreferenceUpdate', () => {
  it('accepts a valid email preference', () => {
    expect(validatePreferenceUpdate({ event: 'low-stock', channel: 'email', enabled: true, destination: 'owner@store.com' }))
      .toEqual({ event: 'low-stock', channel: 'email', enabled: true, destination: 'owner@store.com' });
  });
  it('accepts a phone number for sms and rejects garbage', () => {
    expect(validatePreferenceUpdate({ event: 'low-stock', channel: 'sms', enabled: true, destination: '+1 (555) 555-0100' }))
      .toMatchObject({ destination: '+1 (555) 555-0100' });
    expect('error' in validatePreferenceUpdate({ event: 'low-stock', channel: 'sms', enabled: true, destination: 'not-a-phone!' })).toBe(true);
  });
  it('rejects unknown events and channels', () => {
    expect('error' in validatePreferenceUpdate({ event: 'nope', channel: 'email', enabled: true })).toBe(true);
    expect('error' in validatePreferenceUpdate({ event: 'low-stock', channel: 'pigeon', enabled: true })).toBe(true);
  });
  it('rejects a malformed email destination', () => {
    expect('error' in validatePreferenceUpdate({ event: 'low-stock', channel: 'email', enabled: true, destination: 'nope' })).toBe(true);
  });
});

describe('isEnabled (delivery gate)', () => {
  it('follows the same defaults the UI shows', () => {
    expect(isEnabled([], 'weekly-brief', 'email')).toBe(true);
    expect(isEnabled([], 'daily-sales-summary', 'email')).toBe(false);
    expect(isEnabled([], 'weekly-brief', 'sms')).toBe(false);
  });
  it('honors explicit opt-out', () => {
    expect(isEnabled([{ event_type: 'weekly-brief', channel: 'email', enabled: false, destination: null }], 'weekly-brief', 'email')).toBe(false);
  });
});
