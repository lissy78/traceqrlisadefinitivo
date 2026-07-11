-- Register user's home in Barrio Lleras, Yumbo as a collection point
-- so the scanner's GPS proximity check recognizes it as a valid location.
INSERT INTO recycling_locations (name, address, lat, lng, location_type, city, schedule, phone)
VALUES (
  'Punto Verde Barrio Lleras - Yumbo',
  'CR6N#8-34 Barrio Lleras, Yumbo, Valle del Cauca',
  3.58884,
  -76.49184,
  'punto_acopio',
  'Yumbo',
  'Lun-Dom 24 horas',
  NULL
)
ON CONFLICT DO NOTHING;
