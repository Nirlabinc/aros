-- ── Regulars Phase 1: synthetic marketplace demo tenant (demo-market) ──────
-- The tenant the gateway's demo narrative uses. All responses for this slug
-- are labeled source=synthetic_demo by the API layer. Idempotent.

INSERT INTO public.tenants (id, slug, name, timezone, currency, status)
VALUES ('dd000000-0000-4000-8000-000000000001', 'demo-market', 'Demo Market (synthetic)', 'America/New_York', 'USD', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.stores (id, tenant_id, name, slug, address, timezone, currency, status, pos_provider, metadata)
VALUES (
  'dd000000-0000-4000-8000-000000000002',
  'dd000000-0000-4000-8000-000000000001',
  'Demo Market — Main St', 'main-st', '100 Main St, Calhoun, GA 30701',
  'America/New_York', 'USD', 'active', 'synthetic',
  '{"synthetic": true, "hours": {"mon":"06:00-22:00","tue":"06:00-22:00","wed":"06:00-22:00","thu":"06:00-22:00","fri":"06:00-23:00","sat":"07:00-23:00","sun":"07:00-21:00"}}'::jsonb
)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- Catalog snapshot (single consistent snapshot_at so DISTINCT ON is stable)
INSERT INTO public.pos_inventory_snapshot
  (tenant_id, store_id, sku, name, department, units_on_hand, unit_cost, unit_price, inventory_value, snapshot_at)
VALUES
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','COF-LG','Large Coffee','Hot Beverages', 999, 0.42, 2.49, 419.58, '2026-07-17T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','BAN-01','Banana','Produce', 44, 0.19, 0.79, 8.36, '2026-07-17T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','H2O-24','Spring Water 24pk','Beverages', 18, 3.10, 5.99, 55.80, '2026-07-17T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','ENR-16','Energy Drink 16oz','Beverages', 4, 1.05, 2.99, 4.20, '2026-07-17T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','SND-BLT','BLT Sandwich','Deli', 6, 1.80, 5.49, 10.80, '2026-07-17T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','CHP-REG','Potato Chips','Snacks', 0, 0.85, 1.99, 0.00, '2026-07-17T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','MLK-OAT','Oat Milk Quart','Dairy Alt', 9, 2.10, 4.29, 18.90, '2026-07-17T08:00:00Z'),
  ('dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','ICE-10','Ice Bag 10lb','Frozen', 25, 0.60, 2.49, 15.00, '2026-07-17T08:00:00Z')
ON CONFLICT (store_id, sku, snapshot_at) DO NOTHING;

INSERT INTO public.public_promotions (id, tenant_id, store_id, title, description, kind, sponsored, starts_at, ends_at, status)
VALUES
  ('dd000000-0000-4000-8000-000000000011','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002',
   '2 energy drinks for $5','Any two 16oz energy drinks','offer', true, '2026-07-14T00:00:00Z','2026-07-21T00:00:00Z','active'),
  ('dd000000-0000-4000-8000-000000000012','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002',
   'Free banana with any coffee','Auto-applies at the register','offer', false, '2026-07-01T00:00:00Z', NULL,'active'),
  ('dd000000-0000-4000-8000-000000000013','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002',
   'Ice 2-for-1 after 6pm','Beat the heat','offer', false, '2026-07-01T00:00:00Z','2026-08-31T00:00:00Z','active')
ON CONFLICT (id) DO NOTHING;
