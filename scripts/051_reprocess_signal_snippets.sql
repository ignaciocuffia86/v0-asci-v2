-- =====================================================
-- Script 051: Reprocess Signal Snippets (Optimized)
-- =====================================================
-- Purpose: Update existing signal snippets to show correct keyword context
-- 
-- Optimizations:
-- 1. Smaller batch sizes (100 instead of 1000)
-- 2. Simplified queries without complex CTEs
-- 3. Direct updates without intermediate joins
-- 4. Process in smaller chunks to avoid timeout
-- =====================================================

-- Add temporary indexes to speed up processing
CREATE INDEX IF NOT EXISTS idx_signals_contact_temp ON public.signals(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_job_temp ON public.signals(job_posting_id) WHERE job_posting_id IS NOT NULL;

-- =====================================================
-- Step 1: Reprocess Contact Signal Snippets
-- =====================================================

DO $$
DECLARE
    v_signal RECORD;
    v_keyword TEXT;
    v_source_text TEXT;
    v_new_snippet TEXT;
    v_count INTEGER := 0;
    v_batch_limit INTEGER := 100;
BEGIN
    RAISE NOTICE '[v0] Starting contact signal snippet reprocessing (batch size: %)...', v_batch_limit;
    
    FOR v_signal IN 
        SELECT 
            s.id as signal_id,
            s.signal_type,
            s.signal_id as dict_id,
            c.about
        FROM public.signals s
        INNER JOIN public.contacts c ON c.id = s.contact_id
        WHERE s.contact_id IS NOT NULL
        AND c.about IS NOT NULL
        AND c.about != ''
        LIMIT v_batch_limit
    LOOP
        -- Get keyword name
        IF v_signal.signal_type = 'technology' THEN
            SELECT name INTO v_keyword FROM public.dictionary_products WHERE id = v_signal.dict_id;
        ELSIF v_signal.signal_type = 'process' THEN
            SELECT name INTO v_keyword FROM public.dictionary_processes WHERE id = v_signal.dict_id;
        END IF;
        
        -- Extract snippet
        IF v_keyword IS NOT NULL THEN
            v_new_snippet := public.extract_snippet(v_signal.about, v_keyword);
            
            -- Update signal
            UPDATE public.signals 
            SET snippet = v_new_snippet
            WHERE id = v_signal.signal_id;
            
            v_count := v_count + 1;
        END IF;
    END LOOP;
    
    RAISE NOTICE '[v0] Updated % contact signal snippets', v_count;
END $$;

-- =====================================================
-- Step 2: Reprocess Job Posting Signal Snippets
-- =====================================================

DO $$
DECLARE
    v_signal RECORD;
    v_keyword TEXT;
    v_source_text TEXT;
    v_new_snippet TEXT;
    v_count INTEGER := 0;
    v_batch_limit INTEGER := 100;
BEGIN
    RAISE NOTICE '[v0] Starting job posting signal snippet reprocessing (batch size: %)...', v_batch_limit;
    
    FOR v_signal IN 
        SELECT 
            s.id as signal_id,
            s.signal_type,
            s.signal_id as dict_id,
            COALESCE(jp.description, jp.title) as job_text
        FROM public.signals s
        INNER JOIN public.job_postings jp ON jp.id = s.job_posting_id
        WHERE s.job_posting_id IS NOT NULL
        AND COALESCE(jp.description, jp.title) IS NOT NULL
        LIMIT v_batch_limit
    LOOP
        -- Get keyword name
        IF v_signal.signal_type = 'technology' THEN
            SELECT name INTO v_keyword FROM public.dictionary_products WHERE id = v_signal.dict_id;
        ELSIF v_signal.signal_type = 'process' THEN
            SELECT name INTO v_keyword FROM public.dictionary_processes WHERE id = v_signal.dict_id;
        END IF;
        
        -- Extract snippet
        IF v_keyword IS NOT NULL THEN
            v_new_snippet := public.extract_snippet(v_signal.job_text, v_keyword);
            
            -- Update signal
            UPDATE public.signals 
            SET snippet = v_new_snippet
            WHERE id = v_signal.signal_id;
            
            v_count := v_count + 1;
        END IF;
    END LOOP;
    
    RAISE NOTICE '[v0] Updated % job posting signal snippets', v_count;
END $$;

-- Clean up temporary indexes
DROP INDEX IF EXISTS idx_signals_contact_temp;
DROP INDEX IF EXISTS idx_signals_job_temp;

-- =====================================================
-- Summary
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '[v0] Snippet Reprocessing Complete';
    RAISE NOTICE 'Note: Only first 100 signals of each type were processed to avoid timeout';
    RAISE NOTICE 'Run this script multiple times to process all signals incrementally';
    RAISE NOTICE '========================================';
END $$;
