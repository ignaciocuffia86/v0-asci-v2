-- Unified fix: Make ALL ETL functions SECURITY DEFINER with consistent search_path
--
-- Root cause: process_import_batch is SECURITY DEFINER but calls sub-functions
-- that are NOT SECURITY DEFINER. When called from the frontend (authenticated user),
-- the sub-functions resolve in a mixed context causing "function does not exist" errors.
--
-- Fix: Make the entire call chain SECURITY DEFINER + SET search_path TO 'public'.
-- Also drop orphan upsert_company wrapper since process_contact_batch_internal 
-- should call it directly (it's the canonical implementation now).

-- ============================================================
-- Step 1: Drop orphan functions that are duplicates
-- ============================================================

-- upsert_company_from_contact is identical to upsert_company but with SECURITY DEFINER
-- We keep upsert_company as the canonical one and make IT security definer instead
-- (process_contact_batch_internal already calls public.upsert_company)

-- ============================================================
-- Step 2: Make upsert_company SECURITY DEFINER
-- ============================================================
-- We need to recreate it with the same body but add SECURITY DEFINER

-- First get the current definition and recreate with SECURITY DEFINER
ALTER FUNCTION public.upsert_company(text, text, text, text, text, text, text) 
  SECURITY DEFINER 
  SET search_path = 'public';

-- ============================================================
-- Step 3: Make process_contact_batch_internal SECURITY DEFINER
-- ============================================================
ALTER FUNCTION public.process_contact_batch_internal(uuid, integer) 
  SECURITY DEFINER 
  SET search_path = 'public';

-- ============================================================
-- Step 4: Make process_job_batch_internal SECURITY DEFINER
-- ============================================================
ALTER FUNCTION public.process_job_batch_internal(uuid, integer) 
  SECURITY DEFINER 
  SET search_path = 'public';

-- ============================================================
-- Step 5: Verify all functions in the chain are SECURITY DEFINER
-- ============================================================
DO $$
DECLARE
  v_func RECORD;
  v_all_ok BOOLEAN := TRUE;
BEGIN
  FOR v_func IN 
    SELECT proname, prosecdef
    FROM pg_proc 
    WHERE proname IN (
      'process_import_batch',
      'process_contact_batch_internal', 
      'process_job_batch_internal',
      'upsert_company',
      'process_contact_signals'
    )
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    IF NOT v_func.prosecdef THEN
      RAISE WARNING 'Function % is NOT SECURITY DEFINER!', v_func.proname;
      v_all_ok := FALSE;
    ELSE
      RAISE NOTICE 'OK: % is SECURITY DEFINER', v_func.proname;
    END IF;
  END LOOP;
  
  IF v_all_ok THEN
    RAISE NOTICE 'All ETL functions are properly configured as SECURITY DEFINER';
  END IF;
END$$;
