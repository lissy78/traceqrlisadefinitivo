ALTER TABLE public.ucid_batches
ADD COLUMN IF NOT EXISTS batch_hash text;

ALTER TABLE public.ucid_batches
ADD COLUMN IF NOT EXISTS generated_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.ucid_batches
ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.ucid_batches
ADD COLUMN IF NOT EXISTS product_brand text;

ALTER TABLE public.ucid_batches
ADD COLUMN IF NOT EXISTS container_type text DEFAULT 'PET';

ALTER TABLE public.ucid_batches
ADD COLUMN IF NOT EXISTS qr_strategy text NOT NULL DEFAULT 'batch_hash';

CREATE INDEX IF NOT EXISTS idx_ucid_batches_batch_hash
ON public.ucid_batches(batch_hash);

CREATE INDEX IF NOT EXISTS idx_ucid_batches_prefix
ON public.ucid_batches(ucid_prefix);

COMMENT ON COLUMN public.ucid_batches.batch_hash IS
'Hash maestro del lote. Los QR individuales se derivan desde este valor sin guardar cada QR en ucids.';

COMMENT ON COLUMN public.ucid_batches.qr_strategy IS
'Estrategia de generación QR. batch_hash significa que los QR se derivan desde el lote.';