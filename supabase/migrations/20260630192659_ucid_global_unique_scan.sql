-- Make UCID scans globally unique: a bottle (UCID) can only be scanned ONCE across all users.
-- Regular barcodes keep the (user_id, barcode) constraint so different users can scan the same product.
-- UCIDs are unique containers, so the barcode (which is the ucid_hash) must be globally unique in scan_events.

-- Add a partial unique index: only applies to QR scans (scan_type = 'qr'), enforcing one scan per UCID globally.
CREATE UNIQUE INDEX IF NOT EXISTS unique_ucid_scan_globally
  ON scan_events (barcode)
  WHERE scan_type = 'qr';
