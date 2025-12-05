-- =============================================
-- DIGEST SYSTEM - Tablas para email digest mensual
-- =============================================

-- 1. Agregar campos a company_news si no existen
ALTER TABLE company_news 
ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS published_at DATE;

-- 2. Agregar campos a company_implementations si no existen
ALTER TABLE company_implementations 
ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS published_at DATE;

-- 3. Crear tabla de preferencias de notificación
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  digest_enabled BOOLEAN DEFAULT true,
  digest_frequency TEXT DEFAULT 'monthly' CHECK (digest_frequency IN ('weekly', 'monthly', 'never')),
  last_digest_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Crear tabla de items ya enviados en digest (evita duplicados)
CREATE TABLE IF NOT EXISTS user_digest_sent_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('news', 'implementation')),
  item_id UUID NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, item_type, item_id)
);

-- 5. Crear tabla de log de digests enviados
CREATE TABLE IF NOT EXISTS digest_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items_count INTEGER NOT NULL DEFAULT 0,
  companies_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT
);

-- 6. Índices para performance
CREATE INDEX IF NOT EXISTS idx_company_news_published_at ON company_news(published_at);
CREATE INDEX IF NOT EXISTS idx_company_news_requested_by ON company_news(requested_by);
CREATE INDEX IF NOT EXISTS idx_company_news_company_id ON company_news(company_id);
CREATE INDEX IF NOT EXISTS idx_company_implementations_published_at ON company_implementations(published_at);
CREATE INDEX IF NOT EXISTS idx_company_implementations_requested_by ON company_implementations(requested_by);
CREATE INDEX IF NOT EXISTS idx_company_implementations_company_id ON company_implementations(company_id);
CREATE INDEX IF NOT EXISTS idx_user_digest_sent_items_user ON user_digest_sent_items(user_id);
CREATE INDEX IF NOT EXISTS idx_digest_send_log_user ON digest_send_log(user_id, sent_at);

-- Agregar DROP POLICY IF EXISTS antes de crear políticas para evitar errores de duplicados

-- 7. RLS para user_notification_preferences
ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own preferences" ON user_notification_preferences;
CREATE POLICY "Users can view own preferences" ON user_notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own preferences" ON user_notification_preferences;
CREATE POLICY "Users can insert own preferences" ON user_notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON user_notification_preferences;
CREATE POLICY "Users can update own preferences" ON user_notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- 8. RLS para user_digest_sent_items
ALTER TABLE user_digest_sent_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sent items" ON user_digest_sent_items;
CREATE POLICY "Users can view own sent items" ON user_digest_sent_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage sent items" ON user_digest_sent_items;
CREATE POLICY "Service role can manage sent items" ON user_digest_sent_items
  FOR ALL USING (true);

-- 9. RLS para digest_send_log
ALTER TABLE digest_send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own digest log" ON digest_send_log;
CREATE POLICY "Users can view own digest log" ON digest_send_log
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage digest log" ON digest_send_log;
CREATE POLICY "Service role can manage digest log" ON digest_send_log
  FOR ALL USING (true);

-- 10. Función para inicializar preferencias de usuario
CREATE OR REPLACE FUNCTION initialize_user_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Trigger para crear preferencias automáticamente al crear usuario
DROP TRIGGER IF EXISTS on_auth_user_created_notification_prefs ON auth.users;
CREATE TRIGGER on_auth_user_created_notification_prefs
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION initialize_user_notification_preferences();
