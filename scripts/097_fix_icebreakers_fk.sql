-- Eliminar FK constraint de contact_id para permitir contactos de cualquier tabla
ALTER TABLE user_icebreakers 
DROP CONSTRAINT IF EXISTS user_icebreakers_contact_id_fkey;

-- Agregar columna contact_source para saber de qué tabla viene el contacto
ALTER TABLE user_icebreakers 
ADD COLUMN IF NOT EXISTS contact_source TEXT DEFAULT 'private';

-- Agregar columna contact_name para guardar el nombre del contacto (útil para historial)
ALTER TABLE user_icebreakers 
ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- Actualizar registros existentes con el nombre del contacto
UPDATE user_icebreakers ui
SET contact_name = ucc.full_name
FROM user_company_contacts ucc
WHERE ui.contact_id = ucc.id
AND ui.contact_name IS NULL;
