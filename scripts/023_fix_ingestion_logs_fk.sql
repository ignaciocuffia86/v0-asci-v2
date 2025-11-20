-- Fix foreign key relationship for ingestion_logs to allow joining with profiles
-- Currently it references auth.users, but we need it to reference public.profiles
-- for PostgREST to allow the join in the client query.

DO $$
BEGIN
    -- Drop the existing foreign key if it exists
    -- We need to find the name of the constraint first or just try to drop it by column
    -- Usually it's ingestion_logs_uploaded_by_fkey
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'ingestion_logs_uploaded_by_fkey' 
        AND table_name = 'ingestion_logs'
    ) THEN
        ALTER TABLE public.ingestion_logs DROP CONSTRAINT ingestion_logs_uploaded_by_fkey;
    END IF;

    -- Add the new foreign key referencing profiles
    ALTER TABLE public.ingestion_logs
    ADD CONSTRAINT ingestion_logs_uploaded_by_fkey
    FOREIGN KEY (uploaded_by)
    REFERENCES public.profiles(id);

END $$;
