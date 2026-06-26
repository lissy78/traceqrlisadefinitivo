-- Add is_approved column to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Create temporary table with IDs to keep (first scan per barcode)
CREATE TEMP TABLE scans_to_keep AS
SELECT id FROM (
  SELECT id, barcode, created_at,
         ROW_NUMBER() OVER (PARTITION BY barcode ORDER BY created_at ASC) as rn
  FROM scan_events
) ranked
WHERE rn = 1;

-- Delete duplicate scans keeping only the first one per barcode
DELETE FROM scan_events
WHERE id NOT IN (SELECT id FROM scans_to_keep);

DROP TABLE scans_to_keep;

-- Add global unique constraint on barcode in scan_events
-- This prevents the same barcode from being scanned by ANY user (one scan per container globally)
CREATE UNIQUE INDEX IF NOT EXISTS unique_barcode_globally ON scan_events(barcode);

-- Update RLS policies for companies table
DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update" ON companies FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = companies.id
    )
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = companies.id
    )
  );

-- Approve existing companies by default
UPDATE companies SET is_approved = true WHERE is_approved = false;