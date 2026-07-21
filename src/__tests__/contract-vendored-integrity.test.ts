/**
 * Vendored-integrity guard — AROS's copy of the role-bundle contract must not
 * drift from the shreai source.
 *
 * The contract + 5 presets under contracts/platform/ are VENDORED from shreai
 * (shre-rapidrms/contracts/platform, source of truth). CHECKSUMS.txt is
 * vendored alongside them; this asserts every vendored file still hashes to
 * the manifest value. Editing AROS's copy without re-vendoring from source
 * (files + manifest together) fails here — silent drift becomes a loud local
 * failure. Line endings normalized to LF so a CRLF checkout can't false-fail.
 *
 * On an intentional contract change: update the shreai source, regenerate its
 * manifest, then re-vendor files AND CHECKSUMS.txt here in lockstep (or bump
 * to v2). See shreai contracts/README.md rule 6.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM = join(dirname(fileURLToPath(import.meta.url)), '../../contracts/platform');

function sha256Lf(rel: string): string {
  const raw = readFileSync(join(PLATFORM, rel), 'utf8').replace(/\r/g, '');
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function manifest(): Array<{ hash: string; file: string }> {
  return readFileSync(join(PLATFORM, 'CHECKSUMS.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [hash, file] = l.split(/\s+/, 2);
      return { hash, file };
    });
}

describe('AROS vendored role-bundle contract integrity', () => {
  it('manifest covers the schema + 5 presets', () => {
    expect(manifest().map((e) => e.file).sort()).toEqual([
      'presets/bookkeeper.v1.json',
      'presets/owner.v1.json',
      'presets/regional.v1.json',
      'presets/shift-lead.v1.json',
      'presets/store-manager.v1.json',
      'role-bundle.v1.schema.json',
    ]);
  });

  it('every vendored file matches the shreai manifest hash', () => {
    for (const { hash, file } of manifest()) {
      expect({ file, hash: sha256Lf(file) }).toEqual({ file, hash });
    }
  });
});
