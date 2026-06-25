/*
# Seed recycling locations for Colombia

## Overview
Seeds a set of recycling drop-off points across major Colombian cities for the geolocation map feature.

## Data
- 15 recycling locations in Bogotá, Medellín, and Cali
- Includes puntos verdes, ecoparques, and supermarkets with recycling bins
*/

INSERT INTO recycling_locations (name, address, lat, lng, location_type, city, schedule, phone) VALUES
  ('Punto Verde Parque El Virrey', 'Carrera 15 con Calle 88, Bogotá', 4.6733, -74.0479, 'punto_verde', 'Bogotá', 'Lun-Dom 7am-7pm', '+57 1 3680000'),
  ('Punto Verde Parque 93', 'Calle 93A con Carrera 11A, Bogotá', 4.6762, -74.0478, 'punto_verde', 'Bogotá', 'Lun-Dom 8am-6pm', '+57 1 3680000'),
  ('Ecoparque Tunal', 'Carrera 20 con Calle 48 Sur, Bogotá', 4.5766, -74.1268, 'ecoparque', 'Bogotá', 'Mar-Dom 9am-5pm', '+57 1 3638000'),
  ('Punto Verde 7-Eleven Chapinero', 'Calle 67 con Carrera 7, Bogotá', 4.6540, -74.0615, 'supermercado', 'Bogotá', 'Lun-Sab 8am-8pm', null),
  ('Centro de Reciclaje La Alquería', 'Carrera 53 No. 2-30 Sur, Bogotá', 4.5908, -74.1202, 'ecoparque', 'Bogotá', 'Lun-Vie 7am-4pm', '+57 1 7472929'),
  ('Punto Verde Plaza de Bolívar', 'Cra. 8 #10-66, Bogotá', 4.5981, -74.0760, 'punto_verde', 'Bogotá', 'Lun-Dom 6am-8pm', null),
  ('Punto Verde Parque Laureles', 'Carrera 80 con Calle 34, Medellín', 6.2451, -75.5985, 'punto_verde', 'Medellín', 'Lun-Dom 7am-7pm', '+57 4 3856000'),
  ('Ecoparque Cerro El Volador', 'Carrera 80 Barrio Robledo, Medellín', 6.2697, -75.5978, 'ecoparque', 'Medellín', 'Mar-Dom 8am-5pm', null),
  ('Punto Verde El Poblado', 'Calle 10 con Carrera 43, Medellín', 6.2073, -75.5681, 'punto_verde', 'Medellín', 'Lun-Sab 8am-6pm', null),
  ('Centro Reciclaje Manrique', 'Calle 75 No. 47-50, Medellín', 6.2718, -75.5558, 'ecoparque', 'Medellín', 'Lun-Vie 7am-4pm', '+57 4 3856000'),
  ('Punto Verde Parque de la Salud', 'Carrera 38 con Calle 5, Cali', 3.4372, -76.5305, 'punto_verde', 'Cali', 'Lun-Dom 7am-7pm', '+57 2 8853000'),
  ('Ecoparque Los Chorros', 'Via al Mar Km 18, Cali', 3.4985, -76.6201, 'ecoparque', 'Cali', 'Sab-Dom 9am-4pm', null),
  ('Punto Verde Unicentro Cali', 'Avenida Roosevelt con Calle 9, Cali', 3.4523, -76.5285, 'supermercado', 'Cali', 'Lun-Dom 9am-9pm', null),
  ('Punto Verde Plaza Mayor', 'Calle 19 con Carrera 5, Bogotá', 4.6013, -74.0710, 'punto_verde', 'Bogotá', 'Lun-Dom 6am-8pm', null),
  ('Punto Verde Parque Nacional', 'Calle 37 con Carrera 7, Bogotá', 4.6360, -74.0664, 'punto_verde', 'Bogotá', 'Lun-Dom 6am-8pm', null)
ON CONFLICT DO NOTHING;
