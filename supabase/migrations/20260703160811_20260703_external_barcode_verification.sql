-- External Barcode Verification System
-- Allows scanning external barcodes (old containers without QR) with mandatory verification

-- 1. Add verification fields to scan_events
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending'
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'pending_review'));

ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS ocr_extracted_data jsonb;
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS ocr_brands text[];
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS ocr_sizes text[];
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS verification_passed boolean DEFAULT false;
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS collection_point_verified boolean DEFAULT false;
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS verified_collection_point_name text;

-- 2. Create product_lines table for brand-to-company mapping
CREATE TABLE IF NOT EXISTS product_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  product_category text,
  container_types text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id, brand_name)
);

ALTER TABLE product_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_lines_select" ON product_lines FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "product_lines_insert" ON product_lines FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'company'))
    AND (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      OR EXISTS (
        SELECT 1 FROM profiles p JOIN companies c ON c.id = p.company_id
        WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = product_lines.company_id
      )
    )
  );

CREATE POLICY "product_lines_update" ON product_lines FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles p JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = product_lines.company_id
    )
  );

CREATE POLICY "product_lines_delete" ON product_lines FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 3. Create trigger for updated_at
DROP TRIGGER IF EXISTS update_product_lines_updated_at ON product_lines;
CREATE TRIGGER update_product_lines_updated_at
  BEFORE UPDATE ON product_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Create index for faster product line lookups
CREATE INDEX IF NOT EXISTS idx_product_lines_brand ON product_lines(brand_name);
CREATE INDEX IF NOT EXISTS idx_product_lines_company ON product_lines(company_id);

-- 5. Create function to match brand to company via product_lines
CREATE OR REPLACE FUNCTION public.match_brand_to_company(p_brand text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  v_company_id uuid;
BEGIN
  -- Try exact match first
  SELECT company_id INTO v_company_id
  FROM product_lines
  WHERE LOWER(brand_name) = LOWER(p_brand)
    AND is_active = true
  LIMIT 1;

  IF v_company_id IS NOT NULL THEN
    RETURN v_company_id;
  END IF;

  -- Try partial match
  SELECT company_id INTO v_company_id
  FROM product_lines
  WHERE LOWER(p_brand) LIKE '%' || LOWER(brand_name) || '%'
     OR LOWER(brand_name) LIKE '%' || LOWER(p_brand) || '%'
    AND is_active = true
  LIMIT 1;

  RETURN v_company_id;
END;
$function$;

-- 6. Modify the scan validation: allow external barcodes with proper verification
-- Remove the restriction that only allows UCIDs
DROP INDEX IF EXISTS unique_barcode_globally;

-- Keep the UCID global uniqueness (only for QR scans)
-- This was already created in migration 20260630192659

-- 7. Add check to prevent barcode scans without verification
CREATE OR REPLACE FUNCTION public.validate_barcode_scan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  -- For barcode scans (non-UCID), require verification
  IF NEW.scan_type = 'barcode' THEN
    -- Must have verification photo
    IF NEW.verification_photo_url IS NULL THEN
      RAISE EXCEPTION 'Los escaneos con código de barras externo requieren foto de verificación';
    END IF;
    
    -- Must have location
    IF NEW.location_lat IS NULL OR NEW.location_lng IS NULL THEN
      RAISE EXCEPTION 'Los escaneos con código de barras externo requieren ubicación GPS';
    END IF;
    
    -- Must be verified
    IF NEW.verification_passed = false THEN
      RAISE EXCEPTION 'Los escaneos con código de barras deben pasar la verificación OCR';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- 8. Create trigger for barcode validation
DROP TRIGGER IF EXISTS validate_barcode_scan_trigger ON scan_events;
CREATE TRIGGER validate_barcode_scan_trigger
  BEFORE INSERT ON scan_events
  FOR EACH ROW
  WHEN (NEW.scan_type = 'barcode')
  EXECUTE FUNCTION validate_barcode_scan();

-- 9. Insert default product lines for known brands
INSERT INTO product_lines (company_id, brand_name, product_category, container_types)
SELECT 
  c.id,
  brand,
  'Bebidas',
  ARRAY['PET', 'Vidrio', 'Lata']
FROM companies c
CROSS JOIN (
  SELECT unnest(ARRAY['Coca-Cola', 'Pepsi', 'Colombiana', 'Postobón', 'Sprite', 'Fanta', 
                      'Bavaria', 'Águila', 'Club Colombia', 'Poker', 'Costeña']) AS brand
) b
WHERE c.name ILIKE '%' || b.brand || '%'
ON CONFLICT (company_id, brand_name) DO NOTHING;

-- 10. Add audit log for verification attempts
CREATE TABLE IF NOT EXISTS verification_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_event_id uuid REFERENCES scan_events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE verification_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "verification_audit_select" ON verification_audit_log FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "verification_audit_insert" ON verification_audit_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_verification_audit_scan ON verification_audit_log(scan_event_id);
CREATE INDEX IF NOT EXISTS idx_verification_audit_user ON verification_audit_log(user_id);
