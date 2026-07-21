-- Synthetic marketplace reviewer data for Regulars.
-- Idempotent. Touches only fixed demo UUIDs and slug `demo-market`.

INSERT INTO public.tenants (id, slug, name, timezone, currency, status)
VALUES ('dd000000-0000-4000-8000-000000000001', 'demo-market', 'Demo Market (synthetic)', 'America/New_York', 'USD', 'active')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  timezone = EXCLUDED.timezone,
  currency = EXCLUDED.currency,
  status = EXCLUDED.status;

INSERT INTO public.stores (id, tenant_id, name, slug, address, timezone, currency, status, pos_provider, metadata)
VALUES (
  'dd000000-0000-4000-8000-000000000002',
  'dd000000-0000-4000-8000-000000000001',
  'Demo Market - Main St',
  'main-st',
  '100 Main St, Calhoun, GA 30701',
  'America/New_York',
  'USD',
  'active',
  'synthetic',
  '{
    "synthetic": true,
    "category": "Convenience store",
    "phone": "+1-555-0100",
    "website": "https://regulars.aros.live/demo-market",
    "hours": {
      "mon": "06:00-22:00",
      "tue": "06:00-22:00",
      "wed": "06:00-22:00",
      "thu": "06:00-22:00",
      "fri": "06:00-23:00",
      "sat": "07:00-23:00",
      "sun": "07:00-21:00"
    },
    "profile": {
      "name": "Demo Market",
      "category": "Convenience store",
      "phone": "+1-555-0100",
      "website": "https://regulars.aros.live/demo-market",
      "address": {
        "street": "100 Main St",
        "locality": "Calhoun",
        "region": "GA",
        "postalCode": "30701",
        "country": "US"
      },
      "links": {
        "website": "https://regulars.aros.live/demo-market",
        "maps": {
          "google": "https://www.google.com/maps/search/?api=1&query=Demo%20Market%20Calhoun%20GA",
          "apple": "https://maps.apple.com/?q=Demo%20Market%20Calhoun%20GA"
        },
        "social": {
          "facebook": "https://www.facebook.com/demo-market-example",
          "instagram": "https://www.instagram.com/demo_market_example"
        },
        "support": "mailto:info@rapidinfosoft.com",
        "legal": [
          "https://www.aros.live/legal/privacy/",
          "https://www.aros.live/legal/terms/"
        ],
        "chatgpt": "https://regulars.aros.live/demo-market/connect/chatgpt",
        "claude": "https://regulars.aros.live/demo-market/connect/claude"
      }
    }
  }'::jsonb
)
ON CONFLICT (tenant_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  timezone = EXCLUDED.timezone,
  currency = EXCLUDED.currency,
  status = EXCLUDED.status,
  pos_provider = EXCLUDED.pos_provider,
  metadata = EXCLUDED.metadata;

INSERT INTO public.pos_inventory_snapshot
  (tenant_id, store_id, sku, name, department, units_on_hand, unit_cost, unit_price, inventory_value, snapshot_at)
VALUES
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','COF-LG','Large Coffee','Hot Beverages', 999, 0.42, 2.49, 419.58, '2026-07-21T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','BAN-01','Banana','Produce', 44, 0.19, 0.79, 8.36, '2026-07-21T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','H2O-24','Spring Water 24pk','Beverages', 18, 3.10, 5.99, 55.80, '2026-07-21T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','ENR-16','Energy Drink 16oz','Beverages', 4, 1.05, 2.99, 4.20, '2026-07-21T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','SND-BLT','BLT Sandwich','Deli', 6, 1.80, 5.49, 10.80, '2026-07-21T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','CHP-REG','Potato Chips','Snacks', 0, 0.85, 1.99, 0.00, '2026-07-21T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','MLK-OAT','Oat Milk Quart','Dairy Alt', 9, 2.10, 4.29, 18.90, '2026-07-21T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','ICE-10','Ice Bag 10lb','Frozen', 25, 0.60, 2.49, 15.00, '2026-07-21T08:00:00Z')
ON CONFLICT (store_id, sku, snapshot_at) DO NOTHING;

INSERT INTO public.public_promotions (id, tenant_id, store_id, title, description, kind, sponsored, starts_at, ends_at, status)
VALUES
  ('dd000000-0000-4000-8000-000000000011','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002',
   '2 energy drinks for $5','Any two 16oz energy drinks','offer', true, '2026-07-21T00:00:00Z','2026-08-31T00:00:00Z','active'),
  ('dd000000-0000-4000-8000-000000000012','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002',
   'Free banana with any coffee','Auto-applies at the register','offer', false, '2026-07-21T00:00:00Z', NULL,'active'),
  ('dd000000-0000-4000-8000-000000000013','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002',
   'Ice 2-for-1 after 6pm','Beat the heat','offer', false, '2026-07-21T00:00:00Z','2026-08-31T00:00:00Z','active')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  kind = EXCLUDED.kind,
  sponsored = EXCLUDED.sponsored,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  status = EXCLUDED.status;
