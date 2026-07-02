
-- Fix search_path on trigger functions that reference public.profiles
-- The empty search_path caused "relation profiles does not exist" errors

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_company_user_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
DECLARE
  user_role text;
  user_current_company_id uuid;
BEGIN
  -- Get user's current role and company
  SELECT role, company_id INTO user_role, user_current_company_id
  FROM profiles WHERE id = NEW.id;

  -- If user is company role and trying to change company_id
  IF user_role = 'company' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    -- Only allow if the new company_id was created by this user OR is approved by admin
    IF NOT EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = NEW.company_id
      AND (c.created_by = NEW.id OR c.is_approved = true)
    ) THEN
      RAISE EXCEPTION 'No tienes permiso para vinculararte a esta empresa. La empresa debe ser aprobada por el administrador.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
