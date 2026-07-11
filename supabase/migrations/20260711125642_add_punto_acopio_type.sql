ALTER TABLE recycling_locations DROP CONSTRAINT IF EXISTS recycling_locations_location_type_check;
ALTER TABLE recycling_locations ADD CONSTRAINT recycling_locations_location_type_check 
  CHECK (location_type = ANY (ARRAY['punto_verde'::text, 'ecoparque'::text, 'supermercado'::text, 'hospital'::text, 'punto_acopio'::text, 'otro'::text]));
