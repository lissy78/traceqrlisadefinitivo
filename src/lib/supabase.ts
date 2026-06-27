import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Role = 'admin' | 'company' | 'student';

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  company_id: string | null;
  total_points: number;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  company_is_approved?: boolean;
}

export interface Company {
  id: string;
  name: string;
  email: string;
  logo_url: string | null;
  industry: string;
  description: string | null;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductCatalog {
  id: string;
  barcode: string;
  name: string;
  brand: string | null;
  category: string | null;
  company_id: string | null;
  image_url: string | null;
  description: string | null;
  material: string;
  weight_grams: number | null;
  off_data: Record<string, unknown> | null;
  ai_confidence: number;
  scan_count: number;
  created_at: string;
  updated_at: string;
}

export interface ScanEvent {
  id: string;
  user_id: string;
  product_id: string | null;
  barcode: string;
  scan_type: 'barcode' | 'qr';
  acquisition_source: string | null;
  location_lat: number | null;
  location_lng: number | null;
  location_name: string | null;
  points_earned: number;
  token_hash: string;
  company_id: string | null;
  scan_data: Record<string, unknown> | null;
  created_at: string;
}

export interface RecyclingLocation {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  location_type: 'punto_verde' | 'ecoparque' | 'supermercado' | 'hospital' | 'punto_acopio' | 'otro';
  city: string | null;
  department: string;
  schedule: string | null;
  phone: string | null;
  notes: string | null;
  company_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Redemption {
  id: string;
  user_id: string;
  points_used: number;
  reward_type: string;
  redeemed_at: string;
  company_id: string | null;
  stock_id: string | null;
  created_at: string;
}

export interface AIProductResponse {
  id: string;
  barcode: string;
  question_key: string;
  answer: string;
  confidence: number;
  vote_count: number;
  created_at: string;
  updated_at: string;
}

export interface RewardStock {
  id: string;
  company_id: string | null;
  reward_type: string;
  total_stock: number;
  remaining_stock: number;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UCIDBatch {
  id: string;
  company_id: string;
  batch_name: string;
  quantity: number;
  ucid_prefix: string;
  price_per_ucid: number;
  total_price: number;
  status: string;
  created_by: string | null;
  created_at: string;
  generated_at: string | null;
  printed_at: string | null;
  notes: string | null;
}

export interface UCID {
  id: string;
  batch_id: string;
  company_id: string;
  product_id: string | null;
  ucid_hash: string;
  short_code: string;
  qr_data: string;
  status: string;
  scanned_at: string | null;
  scan_event_id: string | null;
  product_name: string | null;
  product_brand: string | null;
  container_type: string;
  created_at: string;
  updated_at: string;
}
