/*
# Add coordinates to companies table

1. Modified Tables
- `companies`: Added `lat` (double precision, nullable) and `lng` (double precision, nullable) columns
  to store the company's production plant / HQ geographic coordinates.
  These are used by the UCID tracking map to show the real origin point of each container
  instead of a hardcoded default location.

2. Data Updates
- Set Coca-Cola FEMSA Colombia (id = 0a8fdc5a-d4c7-4334-8dc7-ff8001ccd60b) coordinates
  to their Yumbo, Valle del Cauca plant location (lat: 3.5915, lng: -76.4981).

3. Security
- No RLS policy changes. Existing policies on `companies` remain unchanged.
*/

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

UPDATE companies
SET lat = 3.5915, lng = -76.4981
WHERE id = '0a8fdc5a-d4c7-4334-8dc7-ff8001ccd60b'
  AND lat IS NULL;
