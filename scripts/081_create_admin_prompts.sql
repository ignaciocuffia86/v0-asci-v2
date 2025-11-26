-- Crear tabla para gestionar prompts de investigación con IA
CREATE TABLE IF NOT EXISTS admin_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key TEXT UNIQUE NOT NULL, -- 'news_research', 'implementations_research'
  prompt_text TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insertar prompts por defecto
INSERT INTO admin_prompts (prompt_key, prompt_text, description) VALUES
(
  'news_research',
  'Busca noticias recientes (últimos 6 meses) sobre {company_name} en {industry}. Enfócate en: expansión, nuevos productos/servicios, partnerships, inversiones tecnológicas, cambios de liderazgo, premios/reconocimientos. Para cada noticia, proporciona: título, resumen breve (2-3 oraciones), fecha, fuente URL, y categoriza con tags relevantes.',
  'Prompt para búsqueda de noticias de empresas con Perplexity'
),
(
  'implementations_research',
  'Busca casos de éxito, implementaciones o proyectos tecnológicos realizados EN {company_name}. Busca menciones de proveedores como Accenture, IBM, Deloitte, consultoras o vendors que hayan implementado soluciones. Para cada caso, proporciona: título del proyecto, proveedor/implementador, tecnología usada, resumen del proyecto, resultados obtenidos, y URL de fuente.',
  'Prompt para búsqueda de implementaciones y casos de éxito'
);

-- RLS: Solo admins pueden gestionar prompts
ALTER TABLE admin_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage prompts" ON admin_prompts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_admin_prompts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_prompts_updated_at
  BEFORE UPDATE ON admin_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_admin_prompts_updated_at();
