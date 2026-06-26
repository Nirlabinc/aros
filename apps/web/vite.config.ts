import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read port from ports.json (single source of truth)
function getPort(): number {
  try {
    const portsPath = join(__dirname, '..', '..', '..', 'ports.json');
    const ports = JSON.parse(readFileSync(portsPath, 'utf8'));
    return ports.services?.['aros-platform']?.port ?? 5457;
  } catch {
    return 5457;
  }
}

export default defineConfig(({ command, mode }) => {
  // Read .env from the monorepo root so the single /opt/aros-platform/.env
  // on the VPS supplies these vars (no duplicate needed in apps/web/).
  const envDir = join(__dirname, '..', '..');
  // Empty prefix so we can also read the unprefixed SUPABASE_* names the
  // servers already use — Vite only auto-exposes VITE_-prefixed vars.
  const env = loadEnv(mode, envDir, '');

  // Accept either the VITE_-prefixed or the plain server-side name. ONLY
  // these two public keys are mapped in — never SUPABASE_SERVICE_ROLE_KEY,
  // which must never be inlined into a browser bundle.
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';

  // Fail the build loudly instead of shipping a bundle that throws
  // "supabaseUrl is required" at load and renders a blank white page.
  if (command === 'build' && (!supabaseUrl || !supabaseAnonKey)) {
    throw new Error(
      '[aros-web] Refusing to build: VITE_SUPABASE_URL/SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY must be set (looked in ' +
      `${envDir}/.env and process.env). Building without them produces a ` +
      'blank app because the Supabase client throws at startup.',
    );
  }

  return {
    envDir,
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
    server: {
      port: getPort(),
      host: '0.0.0.0',
    },
    preview: {
      port: getPort(),
      host: '0.0.0.0',
      allowedHosts: true,
    },
    build: {
      outDir: 'dist',
    },
  };
});
