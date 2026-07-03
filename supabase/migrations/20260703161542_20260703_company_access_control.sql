-- ============================================================================
-- COMPANY ACCESS CONTROL: Restrict companies to ONLY their own data
-- ============================================================================

-- 1. Drop existing policies that might be too permissive
DROP POLICY IF EXISTS "scan_events_select" ON scan_events;
DROP POLICY IF EXISTS "product_catalog_select" ON product_catalog;
DROP POLICY IF EXISTS "ucids_select" ON ucids;

-- 2. Recreate scan_events SELECT policy - companies ONLY see their own data
CREATE POLICY "scan_events_select" ON scan_events FOR SELECT
  TO authenticated USING (
    -- User can see their own scans
    auth.uid() = user_id
    -- Admin can see everything
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    -- Company can ONLY see scans where they are the company_id AND company is approved
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() 
        AND p.role = 'company' 
        AND c.id = scan_events.company_id 
        AND c.is_approved = true
    )
  );

-- 3. Recreate product_catalog SELECT policy - companies see global + their own
CREATE POLICY "product_catalog_select" ON product_catalog FOR SELECT
  TO authenticated USING (
    -- Global products (no company)
    company_id IS NULL
    -- Admin sees all
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    -- Company sees only their own products (if approved)
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() 
        AND p.role = 'company' 
        AND c.id = product_catalog.company_id
        AND c.is_approved = true
    )
    -- Students can see all products for scanning
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'student')
  );

-- 4. UCIDs SELECT policy - companies see only their own UCIDs
CREATE POLICY "ucids_select" ON ucids FOR SELECT
  TO authenticated USING (
    -- Admin sees all
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    -- Company sees only their own UCIDs (if approved)
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() 
        AND p.role = 'company' 
        AND c.id = ucids.company_id
        AND c.is_approved = true
    )
  );

-- 5. Companies cannot self-approve - only admin can approve
DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update" ON companies FOR UPDATE
  TO authenticated USING (
    -- Admin can update any company including is_approved
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    -- Creator can update their own company (except is_approved) - only if not approved yet
    OR (
      created_by = auth.uid()
      AND is_approved = false
    )
    -- Linked company user can view (but not change is_approved)
    OR (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() 
          AND p.role = 'company' 
          AND p.company_id = companies.id
      )
    )
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR (
      created_by = auth.uid()
      AND is_approved = false
    )
  );

-- 6. Add audit log for company approvals
CREATE TABLE IF NOT EXISTS company_approval_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('approved', 'rejected', 'revoked', 'created')),
  actor_id uuid REFERENCES auth.users(id),
  previous_state jsonb,
  new_state jsonb,
  reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE company_approval_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_approval_log_select" ON company_approval_log FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "company_approval_log_insert" ON company_approval_log FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_company_approval_company ON company_approval_log(company_id);

-- 7. Create function to approve company (admin only)
CREATE OR REPLACE FUNCTION public.approve_company(
  p_company_id uuid,
  p_reason text DEFAULT null
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_old_state jsonb;
  v_new_state jsonb;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Solo administradores pueden aprobar empresas';
  END IF;

  -- Get current state
  SELECT to_jsonb(c.*) INTO v_old_state
  FROM companies c WHERE c.id = p_company_id;

  -- Update company
  UPDATE companies
  SET is_approved = true,
      approved_by = auth.uid(),
      approved_at = now()
  WHERE id = p_company_id
  RETURNING to_jsonb(companies.*) INTO v_new_state;

  -- Log the action
  INSERT INTO company_approval_log (company_id, action, actor_id, previous_state, new_state, reason)
  VALUES (p_company_id, 'approved', auth.uid(), v_old_state, v_new_state, p_reason);

  RETURN true;
END;
$function$;

-- 8. Create function to reject/revoke company approval
CREATE OR REPLACE FUNCTION public.revoke_company_approval(
  p_company_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_old_state jsonb;
  v_new_state jsonb;
BEGIN
  -- Check if user is admin
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Solo administradores pueden revocar aprobaciones';
  END IF;

  -- Get current state
  SELECT to_jsonb(c.*) INTO v_old_state
  FROM companies c WHERE c.id = p_company_id;

  -- Update company
  UPDATE companies
  SET is_approved = false,
      approved_by = null,
      approved_at = null
  WHERE id = p_company_id
  RETURNING to_jsonb(companies.*) INTO v_new_state;

  -- Log the action
  INSERT INTO company_approval_log (company_id, action, actor_id, previous_state, new_state, reason)
  VALUES (p_company_id, 'revoked', auth.uid(), v_old_state, v_new_state, p_reason);

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_company(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_company_approval(uuid, text) TO authenticated;
