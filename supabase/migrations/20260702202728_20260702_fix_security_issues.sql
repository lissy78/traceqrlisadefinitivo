-- ============================================================================
-- SECURITY FIX: Function Search Path and Permissions
-- ============================================================================

-- 1. Fix search_path for all functions (without IF EXISTS)
DO $$
BEGIN
  BEGIN
    ALTER FUNCTION public.validate_ucid(text) SET search_path = '';
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER FUNCTION public.log_ucid_action(uuid, text, uuid, text, jsonb) SET search_path = '';
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER FUNCTION public.increment_user_points_on_scan() SET search_path = '';
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER FUNCTION public.decrement_user_points_on_redemption() SET search_path = '';
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER FUNCTION public.validate_company_user_link() SET search_path = '';
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER FUNCTION public.update_updated_at() SET search_path = '';
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- 2. Revoke execute permissions on SECURITY DEFINER functions from anon
REVOKE EXECUTE ON FUNCTION public.validate_ucid(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_ucid_action(uuid, text, uuid, text, jsonb) FROM anon;

-- 3. Fix the scan-photos bucket policy to prevent listing
DROP POLICY IF EXISTS scan_photos_read ON storage.objects;

-- Create a more restrictive policy
CREATE POLICY scan_photos_read ON storage.objects
  FOR SELECT TO public
  USING (
    bucket_id = 'scan-photos' 
    AND auth.uid() IS NOT NULL
  );

-- ============================================================================
-- SECURITY FIX: Recreate functions with SECURITY INVOKER
-- ============================================================================

-- Drop existing functions
DROP FUNCTION IF EXISTS public.validate_ucid(text);
DROP FUNCTION IF EXISTS public.log_ucid_action(uuid, text, uuid, text, jsonb);

-- Recreate validate_ucid as SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.validate_ucid(p_ucid_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ucid RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Usuario no autenticado');
  END IF;

  SELECT id, status, company_id, product_name, product_brand, container_type, scanned_at, short_code
  INTO v_ucid
  FROM public.ucids
  WHERE ucid_hash = lower(p_ucid_hash)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'UCID no encontrado');
  END IF;

  IF v_ucid.status = 'scanned' THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'error', 'Este envase ya fue escaneado anteriormente',
      'scanned_at', v_ucid.scanned_at
    );
  END IF;

  IF v_ucid.status = 'invalidated' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'UCID invalidado');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'ucid_id', v_ucid.id,
    'company_id', v_ucid.company_id,
    'product_name', v_ucid.product_name,
    'product_brand', v_ucid.product_brand,
    'container_type', v_ucid.container_type,
    'short_code', v_ucid.short_code
  );
END;
$$;

-- Recreate log_ucid_action as SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.log_ucid_action(
  p_ucid_id uuid,
  p_action text,
  p_actor_id uuid,
  p_actor_role text,
  p_details jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_actor_id != auth.uid() THEN
    RAISE EXCEPTION 'Actor ID does not match authenticated user';
  END IF;

  INSERT INTO public.ucid_audit_log (
    ucid_id, action, actor_id, actor_role, details
  ) VALUES (
    p_ucid_id, p_action, p_actor_id, p_actor_role, p_details
  );
END;
$$;

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION public.validate_ucid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_ucid_action(uuid, text, uuid, text, jsonb) TO authenticated;