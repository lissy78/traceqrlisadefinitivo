-- UCID (Unique Container Identifier) System
-- Each container gets a unique SHA3-512 identifier that cannot be duplicated

-- Batches of UCIDs purchased by companies
CREATE TABLE IF NOT EXISTS ucid_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  batch_name text NOT NULL,
  quantity integer NOT NULL,
  ucid_prefix text NOT NULL, -- Short prefix for human readability (e.g., "TRQ-A1B2C")
  price_per_ucid integer NOT NULL DEFAULT 45, -- COP cents
  total_price integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'printed', 'active', 'exhausted')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  generated_at timestamptz,
  printed_at timestamptz,
  notes text
);

ALTER TABLE ucid_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucid_batches_select" ON ucid_batches FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "ucid_batches_insert" ON ucid_batches FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'company'))
  );

CREATE POLICY "ucid_batches_update" ON ucid_batches FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "ucid_batches_delete" ON ucid_batches FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Individual UCIDs (unique container identifiers)
CREATE TABLE IF NOT EXISTS ucids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES ucid_batches(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id uuid REFERENCES product_catalog(id) ON DELETE SET NULL,
  
  -- The unique identifier: 128 chars hex (SHA3-512 equivalent entropy)
  ucid_hash text NOT NULL UNIQUE,
  
  -- Short display code for printing (8 chars, human-readable)
  short_code text NOT NULL,
  
  -- QR code data (the full URL to scan)
  qr_data text NOT NULL,
  
  -- Status tracking
  status text NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'scanned', 'invalidated')),
  scanned_at timestamptz,
  scan_event_id uuid REFERENCES scan_events(id) ON DELETE SET NULL,
  
  -- Product info for this specific container
  product_name text,
  product_brand text,
  container_type text DEFAULT 'PET',
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ucids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucids_select" ON ucids FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
    OR status = 'scanned' AND scan_event_id IN (SELECT id FROM scan_events WHERE user_id = auth.uid())
  );

CREATE POLICY "ucids_update" ON ucids FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ucid_batches_company ON ucid_batches(company_id);
CREATE INDEX IF NOT EXISTS idx_ucids_batch ON ucids(batch_id);
CREATE INDEX IF NOT EXISTS idx_ucids_company ON ucids(company_id);
CREATE INDEX IF NOT EXISTS idx_ucids_hash ON ucids(ucid_hash);
CREATE INDEX IF NOT EXISTS idx_ucids_short_code ON ucids(short_code);
CREATE INDEX IF NOT EXISTS idx_ucids_status ON ucids(status);

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS update_ucids_updated_at ON ucids;
CREATE TRIGGER update_ucids_updated_at BEFORE UPDATE ON ucids
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to check if a UCID is valid and unused
CREATE OR REPLACE FUNCTION validate_ucid(p_ucid_hash text)
RETURNS jsonb AS $$
DECLARE
  ucid_record RECORD;
  result jsonb;
BEGIN
  SELECT * INTO ucid_record FROM ucids WHERE ucid_hash = p_ucid_hash LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'UCID no encontrado');
  END IF;
  
  IF ucid_record.status = 'scanned' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'UCID ya escaneado', 'scanned_at', ucid_record.scanned_at);
  END IF;
  
  IF ucid_record.status = 'invalidated' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'UCID invalidado');
  END IF;
  
  RETURN jsonb_build_object(
    'valid', true,
    'ucid_id', ucid_record.id,
    'company_id', ucid_record.company_id,
    'product_name', ucid_record.product_name,
    'product_brand', ucid_record.product_brand,
    'container_type', ucid_record.container_type,
    'short_code', ucid_record.short_code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;