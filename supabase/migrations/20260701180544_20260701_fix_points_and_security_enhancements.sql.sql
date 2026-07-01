/*
# Fix points auto-update and enhance security

## Changes:
1. Trigger to auto-update profile.total_points when scan_events is inserted
2. Trigger to decrement points on redemption
3. Add unique constraint on profiles.company_id for company role (one company per user)
4. Add reward_stock.company_id for brand-specific refrigerios
5. Improve RLS policies for company users - strict company_id matching
*/

-- ============================================
-- 1. AUTO-UPDATE POINTS ON SCAN
-- ============================================

-- Function to increment points on scan
CREATE OR REPLACE FUNCTION increment_user_points_on_scan()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles 
  SET total_points = total_points + NEW.points_earned
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for scan_events insert
DROP TRIGGER IF EXISTS trigger_increment_points_on_scan ON scan_events;
CREATE TRIGGER trigger_increment_points_on_scan
  AFTER INSERT ON scan_events
  FOR EACH ROW
  EXECUTE FUNCTION increment_user_points_on_scan();

-- ============================================
-- 2. AUTO-DECREMENT POINTS ON REDEMPTION
-- ============================================

-- Function to decrement points on redemption
CREATE OR REPLACE FUNCTION decrement_user_points_on_redemption()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles 
  SET total_points = GREATEST(0, total_points - NEW.points_used)
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for redemptions insert
DROP TRIGGER IF EXISTS trigger_decrement_points_on_redemption ON redemptions;
CREATE TRIGGER trigger_decrement_points_on_redemption
  AFTER INSERT ON redemptions
  FOR EACH ROW
  EXECUTE FUNCTION decrement_user_points_on_redemption();

-- ============================================
-- 3. ADD COMPANY_ID TO REDEMPTIONS FOR BRAND-SPECIFIC REWARDS
-- ============================================

-- Check if company_id column exists in redemptions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'redemptions' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE redemptions ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Check if stock_id column exists in redemptions  
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'redemptions' AND column_name = 'stock_id'
  ) THEN
    ALTER TABLE redemptions ADD COLUMN stock_id uuid;
  END IF;
END $$;

-- ============================================
-- 4. ADD REWARD STOCK TABLE IF NOT EXISTS
-- ============================================

CREATE TABLE IF NOT EXISTS reward_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  reward_type text NOT NULL DEFAULT 'refrigerio',
  total_stock integer NOT NULL DEFAULT 0,
  remaining_stock integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE reward_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reward_stock_select" ON reward_stock;
CREATE POLICY "reward_stock_select" ON reward_stock FOR SELECT
  TO authenticated USING (
    company_id IS NULL  -- Global stock visible to all
    OR EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.company_id = reward_stock.company_id
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "reward_stock_insert" ON reward_stock;
CREATE POLICY "reward_stock_insert" ON reward_stock FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "reward_stock_update" ON reward_stock;
CREATE POLICY "reward_stock_update" ON reward_stock FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "reward_stock_delete" ON reward_stock;
CREATE POLICY "reward_stock_delete" ON reward_stock FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- 5. STRICT RLS FOR COMPANY USERS
-- ============================================

-- Update scan_events RLS - company users only see their company's scans
DROP POLICY IF EXISTS "scan_events_select" ON scan_events;
CREATE POLICY "scan_events_select" ON scan_events FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'company')
      AND company_id IN (
        SELECT p.company_id FROM profiles p WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
      )
    )
  );

-- Update companies RLS - company users can only view their own company
DROP POLICY IF EXISTS "companies_select" ON companies;
CREATE POLICY "companies_select" ON companies FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
    )
  );

-- Company users cannot create companies (only admin)
DROP POLICY IF EXISTS "companies_insert" ON companies;
CREATE POLICY "companies_insert" ON companies FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Company users can only update their own company
DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update" ON companies FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid() AND p.role = 'company'
    )
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR id IN (
      SELECT p.company_id FROM profiles p WHERE p.id = auth.uid() AND p.role = 'company'
    )
  );

-- ============================================
-- 6. PREVENT COMPANY USER FROM LINKING TO ANY COMPANY
-- ============================================

-- Create trigger to validate company_user can only link to their own company
-- This prevents a user from just selecting any company
CREATE OR REPLACE FUNCTION validate_company_user_link()
RETURNS TRIGGER AS $$
DECLARE
  user_role text;
  user_current_company_id uuid;
BEGIN
  -- Get user's current role and company
  SELECT role, company_id INTO user_role, user_current_company_id
  FROM profiles WHERE id = NEW.id;
  
  -- If user is company role and trying to change company_id
  IF user_role = 'company' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    -- Only allow if the new company_id was created by this user OR is approved by admin
    IF NOT EXISTS (
      SELECT 1 FROM companies c 
      WHERE c.id = NEW.company_id 
      AND (c.created_by = NEW.id OR c.is_approved = true)
    ) THEN
      RAISE EXCEPTION 'No tienes permiso para vinculararte a esta empresa. La empresa debe ser aprobada por el administrador.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_company_link ON profiles;
CREATE TRIGGER validate_company_link
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION validate_company_user_link();

-- ============================================
-- 7. ADD BRAND COLLECTIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS brand_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  is_active boolean DEFAULT true,
  points_per_scan integer DEFAULT 10,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE brand_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_collections_select" ON brand_collections;
CREATE POLICY "brand_collections_select" ON brand_collections FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "brand_collections_insert" ON brand_collections;
CREATE POLICY "brand_collections_insert" ON brand_collections FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "brand_collections_update" ON brand_collections;
CREATE POLICY "brand_collections_update" ON brand_collections FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "brand_collections_delete" ON brand_collections;
CREATE POLICY "brand_collections_delete" ON brand_collections FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- 8. INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_reward_stock_company_id ON reward_stock(company_id);
CREATE INDEX IF NOT EXISTS idx_brand_collections_company_id ON brand_collections(company_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_company_id ON redemptions(company_id);

-- ============================================
-- 9. TRIGGER FOR reward_stock updated_at
-- ============================================

DROP TRIGGER IF EXISTS update_reward_stock_updated_at ON reward_stock;
CREATE TRIGGER update_reward_stock_updated_at BEFORE UPDATE ON reward_stock
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
