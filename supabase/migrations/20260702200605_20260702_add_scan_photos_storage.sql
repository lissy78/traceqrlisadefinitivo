-- Create storage bucket for scan verification photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('scan-photos', 'scan-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload scan photos
CREATE POLICY "scan_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'scan-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow public read access
CREATE POLICY "scan_photos_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'scan-photos');

-- Add verification_photo column to scan_events
ALTER TABLE scan_events ADD COLUMN IF NOT EXISTS verification_photo_url text;

-- Add index for faster photo lookups
CREATE INDEX IF NOT EXISTS idx_scan_events_photo ON scan_events(verification_photo_url) WHERE verification_photo_url IS NOT NULL;