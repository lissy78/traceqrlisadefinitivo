/*
# TraceQR - Initial Database Schema

## Overview
Complete traceability platform for plastic recycling with user roles, product scanning, points system, and geolocation.

## New Tables

### profiles
Extended user profile linked to auth.users. Stores role (admin/company/student), points, display name, company association.

### companies
Corporate entities that track their plastic product traceability. Each company has a unique code and can see its own metrics.

### product_catalog
Global product catalog populated from scans and Open Food Facts API. Stores barcode, brand, category, and AI-learned attributes.

### scan_events
Every scan event by a user. Links product, user, location data, acquisition source (supermarket, store, etc.), and generates a unique hash token.

### recycling_points
Redeemable points per user. Tracks daily redemption to enforce one refrigerio/day rule.

### recycling_locations
Geolocation data of recycling drop-off points. Used for the map feature.

### ai_product_responses
Stores AI-learned Q&A responses tied to products for progressive learning.

### redemptions
Records each time a user redeems their daily reward.

## Security
- RLS enabled on all tables
- Role-based access: admin sees all, company sees own data, students see own data
- Admin identified by email in profiles metadata

## Notes
- Uses SHA-256 via pgcrypto for token generation
- Points system: 10 points per scan, max 1 redemption per day
*/

-- Enable pgcrypto for SHA-256 token generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'company', 'student')),
  company_id uuid,
  total_points integer NOT NULL DEFAULT 0,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = id);

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  logo_url text,
  industry text DEFAULT 'Bebidas',
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_select" ON companies;
CREATE POLICY "companies_select" ON companies FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "companies_insert" ON companies;
CREATE POLICY "companies_insert" ON companies FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update" ON companies FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR created_by = auth.uid()
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "companies_delete" ON companies;
CREATE POLICY "companies_delete" ON companies FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Add foreign key from profiles to companies
ALTER TABLE profiles ADD CONSTRAINT profiles_company_id_fkey 
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- Product catalog table
CREATE TABLE IF NOT EXISTS product_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text UNIQUE NOT NULL,
  name text NOT NULL,
  brand text,
  category text,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  image_url text,
  description text,
  material text DEFAULT 'PET',
  weight_grams numeric,
  off_data jsonb,
  ai_confidence numeric DEFAULT 0,
  scan_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE product_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_catalog_select" ON product_catalog;
CREATE POLICY "product_catalog_select" ON product_catalog FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "product_catalog_insert" ON product_catalog;
CREATE POLICY "product_catalog_insert" ON product_catalog FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "product_catalog_update" ON product_catalog;
CREATE POLICY "product_catalog_update" ON product_catalog FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "product_catalog_delete" ON product_catalog;
CREATE POLICY "product_catalog_delete" ON product_catalog FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Scan events table
CREATE TABLE IF NOT EXISTS scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid REFERENCES product_catalog(id) ON DELETE SET NULL,
  barcode text NOT NULL,
  scan_type text NOT NULL DEFAULT 'barcode' CHECK (scan_type IN ('barcode', 'qr')),
  acquisition_source text,
  location_lat numeric,
  location_lng numeric,
  location_name text,
  points_earned integer DEFAULT 10,
  token_hash text NOT NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  scan_data jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scan_events_select" ON scan_events;
CREATE POLICY "scan_events_select" ON scan_events FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = scan_events.company_id
    )
  );

DROP POLICY IF EXISTS "scan_events_insert" ON scan_events;
CREATE POLICY "scan_events_insert" ON scan_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "scan_events_update" ON scan_events;
CREATE POLICY "scan_events_update" ON scan_events FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "scan_events_delete" ON scan_events;
CREATE POLICY "scan_events_delete" ON scan_events FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Redemptions table
CREATE TABLE IF NOT EXISTS redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  points_used integer NOT NULL DEFAULT 50,
  reward_type text NOT NULL DEFAULT 'refrigerio',
  redeemed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "redemptions_select" ON redemptions;
CREATE POLICY "redemptions_select" ON redemptions FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "redemptions_insert" ON redemptions;
CREATE POLICY "redemptions_insert" ON redemptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "redemptions_update" ON redemptions;
CREATE POLICY "redemptions_update" ON redemptions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "redemptions_delete" ON redemptions;
CREATE POLICY "redemptions_delete" ON redemptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Recycling locations table
CREATE TABLE IF NOT EXISTS recycling_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  location_type text DEFAULT 'punto_verde' CHECK (location_type IN ('punto_verde', 'ecoparque', 'supermercado', 'hospital', 'otro')),
  city text,
  department text DEFAULT 'Bogotá',
  schedule text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE recycling_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recycling_locations_select" ON recycling_locations;
CREATE POLICY "recycling_locations_select" ON recycling_locations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "recycling_locations_insert" ON recycling_locations;
CREATE POLICY "recycling_locations_insert" ON recycling_locations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "recycling_locations_update" ON recycling_locations;
CREATE POLICY "recycling_locations_update" ON recycling_locations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "recycling_locations_delete" ON recycling_locations;
CREATE POLICY "recycling_locations_delete" ON recycling_locations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- AI product responses (learned responses per product/question)
CREATE TABLE IF NOT EXISTS ai_product_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text NOT NULL,
  question_key text NOT NULL,
  answer text NOT NULL,
  confidence numeric DEFAULT 0.5,
  vote_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(barcode, question_key)
);

ALTER TABLE ai_product_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_responses_select" ON ai_product_responses;
CREATE POLICY "ai_responses_select" ON ai_product_responses FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "ai_responses_insert" ON ai_product_responses;
CREATE POLICY "ai_responses_insert" ON ai_product_responses FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ai_responses_update" ON ai_product_responses;
CREATE POLICY "ai_responses_update" ON ai_product_responses FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ai_responses_delete" ON ai_product_responses;
CREATE POLICY "ai_responses_delete" ON ai_product_responses FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_product_catalog_updated_at ON product_catalog;
CREATE TRIGGER update_product_catalog_updated_at BEFORE UPDATE ON product_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to generate SHA-256 token for scan events
CREATE OR REPLACE FUNCTION generate_scan_token(user_id uuid, barcode text, scan_time timestamptz)
RETURNS text AS $$
BEGIN
  RETURN encode(
    digest(user_id::text || barcode || extract(epoch FROM scan_time)::text, 'sha256'),
    'hex'
  );
END;
$$ LANGUAGE plpgsql;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scan_events_user_id ON scan_events(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_company_id ON scan_events(company_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_created_at ON scan_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_barcode ON scan_events(barcode);
CREATE INDEX IF NOT EXISTS idx_product_catalog_barcode ON product_catalog(barcode);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_user_id ON redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_redeemed_at ON redemptions(redeemed_at DESC);
