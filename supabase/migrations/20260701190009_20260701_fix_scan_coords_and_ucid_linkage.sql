/*
# Fix scan_events coordinates and UCID linkage

1. Data Updates
- Extract lat/lng from scan_data->>'location' text field (format: "lat, lng (±Xm)")
  into location_lat / location_lng numeric columns on scan_events.
- Link existing scan_events to their corresponding UCIDs by matching the
  short_code embedded in the barcode field (format: "https://traceqr.app/s/SHORTCODE/...")
  or by matching the 128-char ucid_hash. Sets ucids.scan_event_id and ucids.status='scanned'.
- Set location_name from scan_data->>'collection_point' where location_name is null.

2. Security
- No RLS or schema changes. Only data updates.
*/

-- Extract coordinates from scan_data->>'location' into numeric columns
UPDATE scan_events
SET
  location_lat = CAST(split_part(regexp_replace(scan_data->>'location', '\s*\(.*\)$', ''), ',', 1) AS double precision),
  location_lng = CAST(split_part(regexp_replace(scan_data->>'location', '\s*\(.*\)$', ''), ',', 2) AS double precision)
WHERE scan_data->>'location' IS NOT NULL
  AND location_lat IS NULL
  AND scan_data->>'location' ~ '^\s*-?[0-9]+\.?[0-9]*,\s*-?[0-9]+\.?[0-9]*';

-- Set location_name from collection_point
UPDATE scan_events
SET location_name = scan_data->>'collection_point'
WHERE location_name IS NULL
  AND scan_data->>'collection_point' IS NOT NULL;

-- Link scan_events to UCIDs by short_code in barcode URL
UPDATE ucids u
SET
  scan_event_id = se.id,
  status = 'scanned',
  scanned_at = se.created_at
FROM scan_events se
WHERE se.barcode LIKE '%/s/' || u.short_code || '/%'
  AND u.scan_event_id IS NULL;

-- Link scan_events to UCIDs by full 128-char hash in barcode
UPDATE ucids u
SET
  scan_event_id = se.id,
  status = 'scanned',
  scanned_at = se.created_at
FROM scan_events se
WHERE se.barcode = u.ucid_hash
  AND u.scan_event_id IS NULL;
