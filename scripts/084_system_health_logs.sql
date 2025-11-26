-- Create table for health check history
CREATE TABLE IF NOT EXISTS system_health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'warning', 'critical')),
  alerts JSONB DEFAULT '[]'::jsonb,
  metrics JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying recent logs
CREATE INDEX IF NOT EXISTS idx_health_logs_created_at ON system_health_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_status ON system_health_logs(status);

-- RLS policies
ALTER TABLE system_health_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first to make script idempotent
DROP POLICY IF EXISTS "Admins can view health logs" ON system_health_logs;
DROP POLICY IF EXISTS "Service can insert health logs" ON system_health_logs;

-- Only admins can view health logs
CREATE POLICY "Admins can view health logs" ON system_health_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Service role can insert
CREATE POLICY "Service can insert health logs" ON system_health_logs
  FOR INSERT
  WITH CHECK (true);

-- Cleanup old logs (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_health_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM system_health_logs 
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
