-- =============================================
-- FIX: Recrear políticas RLS para tablas de digest
-- Ejecutar si el script 102 falló por políticas existentes
-- =============================================

-- 1. Eliminar políticas existentes de user_notification_preferences
DROP POLICY IF EXISTS "Users can view own preferences" ON user_notification_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON user_notification_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON user_notification_preferences;

-- 2. Recrear políticas de user_notification_preferences
CREATE POLICY "Users can view own preferences" ON user_notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" ON user_notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON user_notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- 3. Eliminar políticas existentes de user_digest_sent_items
DROP POLICY IF EXISTS "Users can view own sent items" ON user_digest_sent_items;
DROP POLICY IF EXISTS "Service role can manage sent items" ON user_digest_sent_items;

-- 4. Recrear políticas de user_digest_sent_items
CREATE POLICY "Users can view own sent items" ON user_digest_sent_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage sent items" ON user_digest_sent_items
  FOR ALL USING (true);

-- 5. Eliminar políticas existentes de digest_send_log
DROP POLICY IF EXISTS "Users can view own digest log" ON digest_send_log;
DROP POLICY IF EXISTS "Service role can manage digest log" ON digest_send_log;

-- 6. Recrear políticas de digest_send_log
CREATE POLICY "Users can view own digest log" ON digest_send_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage digest log" ON digest_send_log
  FOR ALL USING (true);
