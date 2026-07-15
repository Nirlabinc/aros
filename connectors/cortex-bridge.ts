// ── CortexDB Bridge ─────────────────────────────────────────────
// Optionally replicates store snapshots into the shared CortexDB warehouse,
// so self-serve connector data reaches the same cross-platform analytics/RAG
// that internal RapidRMS stores get (rapidrms.branches / /v1/rag/context).
//
// OPT-IN via env (CORTEX_URL or AROS_CORTEX_BRIDGE) — no env, no coupling.
// Fire-and-forget: the SDK client is WAL-backed and circuit-broken, and every
// call is wrapped so a warehouse outage can NEVER block or break the primary
// Supabase snapshot path. The aros app stays authoritative; CortexDB is a
// downstream analytics replica.

import { createCortexClient, type CortexClient } from 'shre-sdk/cortex';

export interface SnapshotForCortex {
  tenantId: string;
  connectorId: string;
  businessDate: string;
  revenue: number;
  transactions: number;
  lowStockCount: number;
  source: { type?: string; name?: string };
  partial: boolean;
}

let _client: CortexClient | null = null;

/** Lazily construct the Cortex client, or null when the bridge is disabled. */
function client(): CortexClient | null {
  if (!process.env.CORTEX_URL && !process.env.AROS_CORTEX_BRIDGE) return null;
  if (!_client) {
    _client = createCortexClient('aros-platform', {
      // Falls back to the SDK's ports.json discovery when CORTEX_URL is unset
      // but AROS_CORTEX_BRIDGE forces it on.
      url: process.env.CORTEX_URL,
    });
  }
  return _client;
}

export function cortexBridgeEnabled(): boolean {
  return Boolean(process.env.CORTEX_URL || process.env.AROS_CORTEX_BRIDGE);
}

/**
 * Replicate one store snapshot into CortexDB as an `aros_store_snapshot`
 * record. No-op when the bridge is disabled. Never throws.
 */
export async function replicateSnapshotToCortex(s: SnapshotForCortex): Promise<void> {
  const cx = client();
  if (!cx) return;
  try {
    await cx.write(
      'aros_store_snapshot',
      {
        tenant_id: s.tenantId,
        connector_id: s.connectorId,
        business_date: s.businessDate,
        revenue: s.revenue,
        transactions: s.transactions,
        low_stock_count: s.lowStockCount,
        source: s.source,
        partial: s.partial,
      },
      { tenantId: s.tenantId },
    );
  } catch {
    // Warehouse replication must never break the primary snapshot path.
  }
}
