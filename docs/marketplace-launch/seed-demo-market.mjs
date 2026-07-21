import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const supabase = createClient(url, key, { auth: { persistSession: false } });

const tenantId = 'dd000000-0000-4000-8000-000000000001';
const storeId = 'dd000000-0000-4000-8000-000000000002';
const snapshotAt = '2026-07-21T08:00:00Z';

async function upsert(table, rows, onConflict) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table} upsert failed: ${error.message}`);
}

const { data: ownerRows, error: ownerError } = await supabase
  .from('tenants')
  .select('owner_id')
  .not('owner_id', 'is', null)
  .limit(1);
if (ownerError) throw new Error(`owner lookup failed: ${ownerError.message}`);
const ownerId = ownerRows?.[0]?.owner_id;
if (!ownerId) throw new Error('No existing tenant owner_id found to bind synthetic demo tenant.');

await upsert('tenants', [{
  id: tenantId,
  owner_id: ownerId,
  slug: 'demo-market',
  name: 'Demo Market (synthetic)',
  timezone: 'America/New_York',
  currency: 'USD',
  status: 'active',
}], 'slug');

await upsert('stores', [{
  id: storeId,
  tenant_id: tenantId,
  name: 'Demo Market - Main St',
  slug: 'main-st',
  address: '100 Main St, Calhoun, GA 30701',
  timezone: 'America/New_York',
  currency: 'USD',
  status: 'active',
  pos_provider: 'synthetic',
  metadata: {
    synthetic: true,
    category: 'Convenience store',
    phone: '+1-555-0100',
    website: 'https://regulars.aros.live/demo-market',
    hours: {
      mon: '06:00-22:00',
      tue: '06:00-22:00',
      wed: '06:00-22:00',
      thu: '06:00-22:00',
      fri: '06:00-23:00',
      sat: '07:00-23:00',
      sun: '07:00-21:00',
    },
    profile: {
      name: 'Demo Market',
      category: 'Convenience store',
      phone: '+1-555-0100',
      website: 'https://regulars.aros.live/demo-market',
      address: {
        street: '100 Main St',
        locality: 'Calhoun',
        region: 'GA',
        postalCode: '30701',
        country: 'US',
      },
      links: {
        website: 'https://regulars.aros.live/demo-market',
        maps: {
          google: 'https://www.google.com/maps/search/?api=1&query=Demo%20Market%20Calhoun%20GA',
          apple: 'https://maps.apple.com/?q=Demo%20Market%20Calhoun%20GA',
        },
        social: {
          facebook: 'https://www.facebook.com/demo-market-example',
          instagram: 'https://www.instagram.com/demo_market_example',
        },
        support: 'mailto:info@rapidinfosoft.com',
        legal: [
          'https://www.aros.live/legal/privacy/',
          'https://www.aros.live/legal/terms/',
        ],
        chatgpt: 'https://regulars.aros.live/demo-market/connect/chatgpt',
        claude: 'https://regulars.aros.live/demo-market/connect/claude',
      },
    },
  },
}], 'tenant_id,slug');

await upsert('pos_inventory_snapshot', [
  ['COF-LG', 'Large Coffee', 'Hot Beverages', 999, 0.42, 2.49, 419.58],
  ['BAN-01', 'Banana', 'Produce', 44, 0.19, 0.79, 8.36],
  ['H2O-24', 'Spring Water 24pk', 'Beverages', 18, 3.10, 5.99, 55.80],
  ['ENR-16', 'Energy Drink 16oz', 'Beverages', 4, 1.05, 2.99, 4.20],
  ['SND-BLT', 'BLT Sandwich', 'Deli', 6, 1.80, 5.49, 10.80],
  ['CHP-REG', 'Potato Chips', 'Snacks', 0, 0.85, 1.99, 0.00],
  ['MLK-OAT', 'Oat Milk Quart', 'Dairy Alt', 9, 2.10, 4.29, 18.90],
  ['ICE-10', 'Ice Bag 10lb', 'Frozen', 25, 0.60, 2.49, 15.00],
].map(([sku, name, department, units_on_hand, unit_cost, unit_price, inventory_value]) => ({
  tenant_id: tenantId,
  store_id: storeId,
  sku,
  name,
  department,
  units_on_hand,
  unit_cost,
  unit_price,
  inventory_value,
  snapshot_at: snapshotAt,
})), 'store_id,sku,snapshot_at');

await upsert('public_promotions', [
  {
    id: 'dd000000-0000-4000-8000-000000000011',
    title: '2 energy drinks for $5',
    description: 'Any two 16oz energy drinks',
    kind: 'offer',
    sponsored: true,
    starts_at: '2026-07-21T00:00:00Z',
    ends_at: '2026-08-31T00:00:00Z',
  },
  {
    id: 'dd000000-0000-4000-8000-000000000012',
    title: 'Free banana with any coffee',
    description: 'Auto-applies at the register',
    kind: 'offer',
    sponsored: false,
    starts_at: '2026-07-21T00:00:00Z',
    ends_at: null,
  },
  {
    id: 'dd000000-0000-4000-8000-000000000013',
    title: 'Ice 2-for-1 after 6pm',
    description: 'Beat the heat',
    kind: 'offer',
    sponsored: false,
    starts_at: '2026-07-21T00:00:00Z',
    ends_at: '2026-08-31T00:00:00Z',
  },
].map((row) => ({
  ...row,
  tenant_id: tenantId,
  store_id: storeId,
  status: 'active',
})), 'id');

console.log(JSON.stringify({ ok: true, tenantId, storeId, slug: 'demo-market' }));
