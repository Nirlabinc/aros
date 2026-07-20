/**
 * Auth-client hygiene — pins the RLS session-possession incident of
 * 2026-07-20: signInWithPassword/verifyOtp on the SHARED Supabase admin
 * singleton stored the user's session on it, silently RLS-scoping every
 * later "admin" query (connector saves 42501, lists empty, fleet-wide 401s
 * once the captured session expired).
 *
 * Rule: session-mutating auth calls may only run on a throwaway
 * `createSupabaseAuthClient()` — never on a client that outlives the request.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SESSION_MUTATORS = ['signInWithPassword', 'verifyOtp', 'signInWithOtp', 'setSession', 'exchangeCodeForSession'];

describe('no session-mutating auth calls on shared Supabase clients', () => {
  const source = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
  const lines = source.split('\n');

  for (const method of SESSION_MUTATORS) {
    it(`${method} only ever runs on an ephemeral createSupabaseAuthClient()`, () => {
      const offenders: string[] = [];
      lines.forEach((line, i) => {
        if (!line.includes(`.auth.${method}(`)) return;
        if (line.includes(`createSupabaseAuthClient().auth.${method}(`)) return;
        offenders.push(`server.ts:${i + 1}: ${line.trim()}`);
      });
      expect(offenders, `Session-mutating auth call on a shared client — use createSupabaseAuthClient() (see 2026-07-20 RLS possession incident):\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});
