-- =============================================
-- REMOVER FUNCIONALIDAD DE DIGEST
-- =============================================

-- 1. Eliminar el trigger que causa el error al crear usuarios
DROP TRIGGER IF EXISTS on_auth_user_created_notification_prefs ON auth.users;

-- 2. Eliminar la función del trigger
DROP FUNCTION IF EXISTS initialize_user_notification_preferences();

-- 3. Eliminar tablas de digest (opcional, solo si quieren limpiar completamente)
-- Descomentar las siguientes líneas si quieren eliminar las tablas:

-- DROP TABLE IF EXISTS digest_send_log CASCADE;
-- DROP TABLE IF EXISTS user_digest_sent_items CASCADE;
-- DROP TABLE IF EXISTS user_notification_preferences CASCADE;

-- 4. Eliminar columnas de digest de company_news y company_implementations (opcional)
-- Descomentar las siguientes líneas si quieren eliminar estas columnas:

-- ALTER TABLE company_news 
-- DROP COLUMN IF EXISTS requested_at,
-- DROP COLUMN IF EXISTS requested_by;

-- ALTER TABLE company_implementations 
-- DROP COLUMN IF EXISTS requested_at,
-- DROP COLUMN IF EXISTS requested_by;

-- Notas:
-- - Solo eliminamos el trigger para permitir crear usuarios sin error
-- - Las tablas y columnas se dejan por si en el futuro quieren reactivar digests
-- - Si quieren limpiar completamente, descomenten las secciones 3 y 4
