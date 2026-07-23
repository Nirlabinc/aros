-- Approval request queue for RapidRMS BOS timecard corrections.
--
-- This table is intentionally non-executable: it records pending human review
-- requests for payroll-impacting corrections, but cannot enable a POS write.

CREATE TABLE IF NOT EXISTS public.store_timecard_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  reviewed_by uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
  source text NOT NULL DEFAULT 'RapidRMS BOS',
  draft_id text NOT NULL,
  correction_type text NOT NULL
    CHECK (correction_type IN ('missing_clock_out','voided_punch_review','zero_hour_punch','long_shift_review')),
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  proposed_action text NOT NULL CHECK (proposed_action IN ('edit','review')),
  employee_id text,
  employee_name text,
  clock_id text,
  clock_date text,
  clock_in text,
  clock_out text,
  current_hours numeric,
  proposed_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  write_enabled boolean NOT NULL DEFAULT false CHECK (write_enabled = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_timecard_correction_requests_tenant_status
  ON public.store_timecard_correction_requests(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS store_timecard_correction_requests_tenant_draft
  ON public.store_timecard_correction_requests(tenant_id, draft_id);

ALTER TABLE public.store_timecard_correction_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_timecard_correction_requests_member_select
  ON public.store_timecard_correction_requests;
CREATE POLICY store_timecard_correction_requests_member_select
  ON public.store_timecard_correction_requests FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

DROP POLICY IF EXISTS store_timecard_correction_requests_admin_insert
  ON public.store_timecard_correction_requests;
CREATE POLICY store_timecard_correction_requests_admin_insert
  ON public.store_timecard_correction_requests FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner','admin')
    )
    AND write_enabled = false
  );

GRANT SELECT, INSERT ON public.store_timecard_correction_requests TO authenticated;
