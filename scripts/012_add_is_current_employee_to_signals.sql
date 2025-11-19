-- Add is_current_employee column to signals table
-- This allows distinguishing between current employees and alumni (ex-employees)

ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS is_current_employee BOOLEAN DEFAULT FALSE;

-- Add index for performance when filtering by employment status
CREATE INDEX IF NOT EXISTS idx_signals_is_current_employee 
ON public.signals(company_id, is_current_employee);

-- Add comment to document the column
COMMENT ON COLUMN public.signals.is_current_employee IS 
'TRUE if signal comes from current position, FALSE if from previous position (alumni)';
