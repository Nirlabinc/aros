// ── AROS MCP tool surface (pure module) ─────────────────────────
// Tool definitions, operator tool → AROS API route mapping, per-tool scope
// requirements, and demo-mode payloads. Kept free of network/server concerns
// so the advertised surface and its honesty rules are unit-testable.
//
// Honesty rule: every advertised tool must be backed by a real AROS API
// route in production. Descriptions state only what the connected data
// sources can actually provide — aros_get_inventory_risks reports low-stock/
// stockout vs configured reorder points (fast-moving/stale would need
// per-item sales velocity the RapidRMS API layer does not verifiably
// expose), and aros_get_exception_summary reports void exceptions (refund /
// no-sale / cashier attribution is not available from connected sources).

export type Surface = 'operator' | 'customer';

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export const operatorTools: McpTool[] = [
  {
    name: 'aros_get_store_summary',
    description: 'Read sales, transaction, department, top-mover, and alert summary for scoped AROS stores.',
    inputSchema: objectSchema({
      storeIds: arraySchema('string', 'AROS store IDs to include.'),
      startDate: stringSchema('Start date in YYYY-MM-DD format.'),
      endDate: stringSchema('End date in YYYY-MM-DD format.')
    }, ['storeIds', 'startDate', 'endDate']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'aros_get_connector_health',
    description: 'Read connector status, last test, last sync, and operator-visible failure details.',
    inputSchema: objectSchema({
      storeIds: arraySchema('string', 'AROS store IDs to include.'),
      includeInactive: booleanSchema('Whether inactive connectors should be returned.')
    }, ['storeIds']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'aros_get_inventory_risks',
    description: 'Read low-stock and stockout inventory signals versus configured reorder points for scoped AROS stores. Stores connected through data sources without inventory support are reported as such.',
    inputSchema: objectSchema({
      storeIds: arraySchema('string', 'AROS store IDs to include.'),
      limit: numberSchema('Maximum risks to return.')
    }, ['storeIds']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'aros_get_exception_summary',
    description: 'Read void-exception counts and amounts derived from POS invoice data for scoped AROS stores. Refund, no-sale, and per-cashier exception types are not available from currently connected data sources and are reported as unsupported.',
    inputSchema: objectSchema({
      storeIds: arraySchema('string', 'AROS store IDs to include.'),
      startDate: stringSchema('Start date in YYYY-MM-DD format.'),
      endDate: stringSchema('End date in YYYY-MM-DD format.')
    }, ['storeIds', 'startDate', 'endDate']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'aros_draft_action',
    description: 'Create an approval-ready draft action inside AROS. This never mutates POS systems directly.',
    inputSchema: objectSchema({
      storeId: stringSchema('AROS store ID.'),
      actionType: stringSchema('Draft type, for example price_change or reorder.'),
      title: stringSchema('Operator-visible draft title.'),
      rationale: stringSchema('Why this draft was prepared.'),
      payload: { type: 'object', description: 'Draft payload. No secrets.' }
    }, ['storeId', 'actionType', 'title', 'rationale', 'payload']),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }
];

export const customerTools: McpTool[] = [
  {
    name: 'regulars_get_business_profile',
    description: 'Read the business-approved public Regulars profile for a business. This tool is read-only and cannot change business data.',
    inputSchema: objectSchema({
      businessSlug: stringSchema('Public business slug.'),
      storeId: stringSchema('Optional public store ID.')
    }, ['businessSlug']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'aros_customer_search_products',
    description: 'Search the public customer catalog for products available at a business location.',
    inputSchema: objectSchema({
      businessSlug: stringSchema('Public business slug.'),
      query: stringSchema('Product search query.'),
      storeId: stringSchema('Optional public store ID.'),
      limit: numberSchema('Maximum products to return.')
    }, ['businessSlug', 'query']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'aros_customer_get_promotions',
    description: 'Read public promotions available to customers for a business or store.',
    inputSchema: objectSchema({
      businessSlug: stringSchema('Public business slug.'),
      storeId: stringSchema('Optional public store ID.')
    }, ['businessSlug']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'aros_customer_get_business_hours',
    description: 'Read public business hours, pickup windows, delivery options, and store contact details.',
    inputSchema: objectSchema({
      businessSlug: stringSchema('Public business slug.'),
      storeId: stringSchema('Optional public store ID.')
    }, ['businessSlug']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'regulars_get_links',
    description: 'Read approved public website, map, social, support, legal, QR/deep link, and assistant install links for a business. This tool is read-only.',
    inputSchema: objectSchema({
      businessSlug: stringSchema('Public business slug.'),
      storeId: stringSchema('Optional public store ID.')
    }, ['businessSlug']),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }
];

export const toolsBySurface: Record<Surface, McpTool[]> = {
  operator: operatorTools,
  customer: customerTools
};

// ── Operator tool → AROS API route mapping ──────────────────────

export type OperatorToolRoute = {
  path: string;
  init?: { method: string; body: string };
};

/** Map an operator tool call to its backing AROS API request. Null = no route (not implemented). */
export function operatorToolRoute(name: string, args: Record<string, unknown>): OperatorToolRoute | null {
  if (name === 'aros_get_store_summary') {
    const query = new URLSearchParams();
    addQuery(query, 'storeIds', args.storeIds);
    addQuery(query, 'startDate', args.startDate);
    addQuery(query, 'endDate', args.endDate);
    return { path: `/api/store/summary?${query}` };
  }

  if (name === 'aros_get_connector_health') {
    return { path: '/api/connectors' };
  }

  if (name === 'aros_get_inventory_risks') {
    const query = new URLSearchParams();
    addQuery(query, 'storeIds', args.storeIds);
    addQuery(query, 'limit', args.limit);
    return { path: `/api/store/inventory-risks?${query}` };
  }

  if (name === 'aros_get_exception_summary') {
    const query = new URLSearchParams();
    addQuery(query, 'storeIds', args.storeIds);
    addQuery(query, 'startDate', args.startDate);
    addQuery(query, 'endDate', args.endDate);
    return { path: `/api/store/exceptions?${query}` };
  }

  if (name === 'aros_draft_action') {
    return {
      path: '/api/human/tasks',
      init: {
        method: 'POST',
        body: JSON.stringify({
          title: args.title,
          description: args.rationale,
          source: 'marketplace-mcp',
          metadata: { actionType: args.actionType, storeId: args.storeId, payload: args.payload }
        })
      }
    };
  }

  return null;
}

// ── Per-tool OAuth scope requirements ───────────────────────────
// Resource-level scope gating (REQUIRED_OPERATOR_SCOPES, default `openid`)
// stays in server.ts. On top of it, tokens that DO carry granular `aros.*`
// scopes must hold the specific scope for these reads; tokens without any
// `aros.*` scope (current openid-only deployments) keep the pre-existing
// behavior so this does not lock out live clients.

const OPERATOR_TOOL_SCOPES: Record<string, string> = {
  aros_get_inventory_risks: 'aros.inventory.read',
  aros_get_exception_summary: 'aros.exceptions.read'
};

/** Returns the missing required scope for a tool call, or null when the call may proceed. */
export function missingOperatorScope(name: string, scopes: string[]): string | null {
  const required = OPERATOR_TOOL_SCOPES[name];
  if (!required) return null;
  const hasGranularScopes = scopes.some((scope) => scope.startsWith('aros.'));
  if (!hasGranularScopes) return null;
  return scopes.includes(required) ? null : required;
}

// ── Demo-mode payloads (synthetic, clearly labeled) ─────────────

export function demoResult(name: string, args: Record<string, unknown>, correlationId: string, surface: Surface) {
  if (surface === 'customer') return customerDemoResult(name, args, correlationId);

  const common = {
    tenantId: 'demo_tenant',
    storeIds: args.storeIds || [args.storeId || 'demo_store_001'],
    source: 'synthetic_demo',
    connectorType: 'rapidrms',
    asOf: new Date().toISOString(),
    channel: 'api',
    correlationId
  };

  if (name === 'aros_get_store_summary') {
    return {
      ...common,
      sales: { gross: 4280.42, transactions: 318, averageTicket: 13.46 },
      departments: [
        { name: 'Beverage', sales: 1120.1 },
        { name: 'Grocery', sales: 904.33 },
        { name: 'Tobacco', sales: 870.55 }
      ],
      alerts: ['Lottery sales are down 8% versus the trailing 4-week weekday average.']
    };
  }

  if (name === 'aros_get_connector_health') {
    return {
      ...common,
      connectors: [
        { id: 'demo_rapidrms', type: 'rapidrms', status: 'connected', lastSync: new Date().toISOString() }
      ]
    };
  }

  if (name === 'aros_get_inventory_risks') {
    return {
      ...common,
      risks: [
        { sku: 'DEMO-001', name: '24-pack water', risk: 'stockout', daysRemaining: 2.4 }
      ]
    };
  }

  if (name === 'aros_get_exception_summary') {
    return {
      ...common,
      exceptions: [
        { type: 'void', count: 4, amount: 31.12, note: 'Within normal range for demo store.' }
      ]
    };
  }

  return {
    ...common,
    draft: {
      id: `draft_${correlationId}`,
      status: 'draft_only',
      title: args.title
    }
  };
}

function customerDemoResult(name: string, args: Record<string, unknown>, correlationId: string) {
  const common = {
    businessSlug: args.businessSlug || 'demo-market',
    storeId: args.storeId || 'demo_store_001',
    source: 'public_projection',
    asOf: new Date().toISOString(),
    channel: 'customer-mcp',
    correlationId
  };

  if (name === 'aros_customer_search_products') {
    return {
      ...common,
      products: [
        { id: 'prod_water_24pk', name: '24-pack bottled water', price: 6.99, available: true, fulfillment: ['pickup', 'delivery'] },
        { id: 'prod_chips_family', name: 'Family size potato chips', price: 4.49, available: true, fulfillment: ['pickup'] }
      ]
    };
  }

  if (name === 'aros_customer_get_promotions') {
    return {
      ...common,
      promotions: [
        { id: 'promo_lunch_combo', title: 'Lunch combo', detail: 'Sandwich, chips, and fountain drink bundle.' }
      ]
    };
  }

  if (name === 'aros_customer_get_business_hours') {
    return {
      ...common,
      hours: { monday: '06:00-22:00', tuesday: '06:00-22:00', sunday: '07:00-21:00' },
      fulfillment: { pickup: true, delivery: true }
    };
  }

  if (name === 'regulars_get_business_profile') {
    return {
      ...common,
      profile: {
        name: 'Demo Market',
        category: 'Convenience store',
        phone: '+1-555-0100',
        website: 'https://regulars.aros.live/demo-market',
        address: { locality: 'Calhoun', region: 'GA', country: 'US' },
        readonly: true
      }
    };
  }

  return {
    ...common,
    links: {
      website: 'https://regulars.aros.live/demo-market',
      assistantInstall: {
        chatgpt: 'https://regulars.aros.live/demo-market/connect/chatgpt',
        claude: 'https://regulars.aros.live/demo-market/connect/claude'
      },
      social: []
    }
  };
}

// ── Schema + query helpers ──────────────────────────────────────

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

function stringSchema(description: string) {
  return { type: 'string', description };
}

function numberSchema(description: string) {
  return { type: 'number', description };
}

function booleanSchema(description: string) {
  return { type: 'boolean', description };
}

function arraySchema(itemType: string, description: string) {
  return { type: 'array', description, items: { type: itemType } };
}

export function addQuery(query: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) query.append(key, String(item));
    return;
  }
  query.set(key, String(value));
}
