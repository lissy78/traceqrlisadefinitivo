
-- Fix remaining trigger functions with empty search_path that cause "relation does not exist" errors

CREATE OR REPLACE FUNCTION public.increment_user_points_on_scan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  UPDATE profiles
  SET total_points = total_points + NEW.points_earned
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_user_points_on_redemption()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  UPDATE profiles
  SET total_points = GREATEST(0, total_points - NEW.points_used)
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_ucid(p_ucid_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  v_ucid RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Usuario no autenticado');
  END IF;

  SELECT id, status, company_id, product_name, product_brand, container_type, scanned_at, short_code
  INTO v_ucid
  FROM ucids
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
$function$;

CREATE OR REPLACE FUNCTION public.log_ucid_action(p_ucid_id uuid, p_action text, p_actor_id uuid, p_actor_role text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO public, pg_catalog
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_actor_id != auth.uid() THEN
    RAISE EXCEPTION 'Actor ID does not match authenticated user';
  END IF;

  INSERT INTO ucid_audit_log (
    ucid_id, action, actor_id, actor_role, details
  ) VALUES (
    p_ucid_id, p_action, p_actor_id, p_actor_role, p_details
  );
END;
$function$;
