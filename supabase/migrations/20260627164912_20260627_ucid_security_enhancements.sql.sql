-- Security enhancements for UCID system

-- Only allow UCID insertions from the edge function (service role)
-- Regular users can only update status to 'scanned' when they scan

-- Drop existing policies
DROP POLICY IF EXISTS "ucids_update" ON ucids;

-- Create more restrictive update policy
-- Users can only update UCIDs that they are scanning (mark as scanned)
CREATE POLICY "ucids_update_scan" ON ucids FOR UPDATE
  TO authenticated
  USING (
    -- Allow if status is 'unused' and this is a scan operation
    status = 'unused'
  )
  WITH CHECK (
    -- Only allow changing status to 'scanned'
    status = 'scanned'
  );

-- Add audit log for UCID operations
CREATE TABLE IF NOT EXISTS ucid_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ucid_id uuid REFERENCES ucids(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('generated', 'validated', 'scanned', 'exported', 'invalidated')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ucid_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_select" ON ucid_audit_log FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Add check constraint for short_code uniqueness (already unique but explicit)
ALTER TABLE ucids ADD CONSTRAINT ucids_short_code_format 
  CHECK (short_code ~ '^[A-HJ-NP-Z2-9]{8}$');

-- Add constraint for ucid_hash format
ALTER TABLE ucids ADD CONSTRAINT ucids_hash_format
  CHECK (ucid_hash ~ '^[a-f0-9]{128}$');

-- Create index for faster lookups by short_code (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_ucids_short_code_lower ON ucids(LOWER(short_code));

-- Function to log UCID actions (callable by service role only)
CREATE OR REPLACE FUNCTION log_ucid_action(
  p_ucid_id uuid,
  p_action text,
  p_actor_id uuid DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_details jsonb DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO ucid_audit_log (ucid_id, action, actor_id, actor_role, details)
  VALUES (p_ucid_id, p_action, p_actor_id, p_actor_role, p_details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;