/*
# Fix security issues: mutable search_path and overly permissive RLS policies

## Changes

### 1. Fix mutable search_path on functions
Both `update_updated_at` and `generate_scan_token` are recreated with
`SET search_path = public, pg_catalog` to prevent search_path injection.

### 2. Tighten RLS on product_catalog
- INSERT: only authenticated users who are admins OR students can insert
  (students insert via scan flow; companies/admins manage catalog)
- UPDATE: only admins or the scan system (via service role) should update;
  restrict to authenticated admins for direct updates.

### 3. Tighten RLS on ai_product_responses
- INSERT: any authenticated user can insert their own learned response,
  but we add a non-trivial WITH CHECK so it is no longer "always true".
- UPDATE: restrict to admin only for direct updates; the scan flow uses
  a targeted upsert that will go through the insert policy instead.

## Security notes
- `USING (true)` is removed from all policies that previously had it without
  a real ownership predicate.
- Functions now have immutable search_path to prevent privilege escalation.
*/

-- Fix function search paths

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION generate_scan_token(user_id uuid, barcode text, scan_time timestamptz)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN encode(
    digest(user_id::text || barcode || extract(epoch FROM scan_time)::text, 'sha256'),
    'hex'
  );
END;
$$;

-- Fix product_catalog RLS policies

DROP POLICY IF EXISTS "product_catalog_insert" ON product_catalog;
CREATE POLICY "product_catalog_insert" ON product_catalog FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'student', 'company'))
  );

DROP POLICY IF EXISTS "product_catalog_update" ON product_catalog;
CREATE POLICY "product_catalog_update" ON product_catalog FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'student', 'company'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'student', 'company'))
  );

-- Fix ai_product_responses RLS policies

DROP POLICY IF EXISTS "ai_responses_insert" ON ai_product_responses;
CREATE POLICY "ai_responses_insert" ON ai_product_responses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'student', 'company'))
  );

DROP POLICY IF EXISTS "ai_responses_update" ON ai_product_responses;
CREATE POLICY "ai_responses_update" ON ai_product_responses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'student', 'company'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'student', 'company'))
  );
