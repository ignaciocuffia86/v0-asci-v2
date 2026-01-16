-- Create table to track users synced to Resend
CREATE TABLE IF NOT EXISTS public.resend_audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  resend_contact_id TEXT, -- ID del contacto en Resend
  sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Índices
CREATE INDEX idx_resend_audiences_user_id ON resend_audiences(user_id);
CREATE INDEX idx_resend_audiences_email ON resend_audiences(email);
CREATE INDEX idx_resend_audiences_sync_status ON resend_audiences(sync_status);

-- RLS
ALTER TABLE resend_audiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own resend audience"
  ON resend_audiences FOR SELECT
  USING (user_id = auth.uid());
