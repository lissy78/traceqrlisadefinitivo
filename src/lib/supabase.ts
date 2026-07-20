import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface Company {
  id: string
  name: string
  email: string
  industry: string | null
  description: string | null
  is_approved: boolean
  created_at: string
}

export interface UCIDBatch {
  id: string
  company_id: string
  batch_name: string
  quantity: number
  ucid_prefix: string
  price_per_ucid: number
  total_price: number
  status: string
  created_by: string | null
  created_at: string
  generated_at: string | null
  printed_at: string | null
  notes: string | null
  generated_count: number
  product_name: string | null
  product_brand: string | null
  container_type: string
}

export interface UCID {
  id: string
  batch_id: string
  company_id: string
  ucid_hash: string
  short_code: string
  qr_data: string
  status: string
  scanned_at: string | null
  product_name: string | null
  product_brand: string | null
  container_type: string
  created_at: string
  updated_at: string
}

export interface ScanEvent {
  id: string
  user_id: string
  product_id: string | null
  barcode: string
  scan_type: string
  acquisition_source: string | null
  location_name: string | null
  points_earned: number
  token_hash: string
  company_id: string | null
  scan_data: Record<string, unknown> | null
  created_at: string
}

export interface ProductCatalog {
  id: string
  barcode: string
  name: string
  brand: string | null
  category: string | null
  company_id: string | null
  material: string
  scan_count: number
  created_at: string
}
