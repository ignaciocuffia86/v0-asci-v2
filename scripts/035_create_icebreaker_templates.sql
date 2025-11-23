-- Tabla para templates de icebreakers administrados desde el panel de admin
CREATE TABLE IF NOT EXISTS public.icebreaker_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- Nombre del template (ej: "Mención de Tecnología", "Caso de Éxito")
  description TEXT, -- Descripción del propósito del template
  prompt_template TEXT NOT NULL, -- El prompt que usará la IA. Puede incluir variables como {{company_name}}, {{signal}}, {{contact_name}}
  tone TEXT NOT NULL, -- El tono del mensaje (ej: "profesional", "casual", "directo")
  is_active BOOLEAN DEFAULT true, -- Si el template está disponible para usar
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) -- Usuario admin que lo creó
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_icebreaker_templates_active ON public.icebreaker_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_icebreaker_templates_tone ON public.icebreaker_templates(tone);

-- Row Level Security: Solo superadmins pueden gestionar templates
ALTER TABLE public.icebreaker_templates ENABLE ROW LEVEL SECURITY;

-- Política: Todos los usuarios autenticados pueden VER templates activos
CREATE POLICY "Everyone can view active templates"
  ON public.icebreaker_templates
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Política: Solo superadmins pueden gestionar (crear, editar, eliminar) templates
CREATE POLICY "Superadmins can manage templates"
  ON public.icebreaker_templates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_icebreaker_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_icebreaker_templates_updated_at
  BEFORE UPDATE ON public.icebreaker_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_icebreaker_templates_updated_at();

-- Insertar algunos templates por defecto para empezar
INSERT INTO public.icebreaker_templates (name, description, prompt_template, tone) VALUES
(
  'Mención de Tecnología',
  'Mensaje que menciona una tecnología específica que usa el prospecto',
  'Genera un mensaje de LinkedIn para {{contact_name}} que trabaja en {{company_name}} como {{contact_role}}. Menciona que notaste que usan {{signal}} y explica cómo nuestra solución puede complementar esa tecnología. Tono: {{tone}}.',
  'profesional'
),
(
  'Caso de Éxito Relevante',
  'Mensaje que conecta con un caso de éxito similar',
  'Genera un mensaje de LinkedIn para {{contact_name}} en {{company_name}}. Menciona que trabajamos con empresas similares en {{industry}} y que logramos resultados en {{use_case}}. Tono: {{tone}}.',
  'consultivo'
),
(
  'Directo al Valor',
  'Mensaje directo enfocado en el valor que podemos entregar',
  'Genera un mensaje breve y directo para {{contact_name}} en {{company_name}}. Explica en una línea cómo ayudamos a empresas de {{industry}} a mejorar {{pain_point}}. Tono: {{tone}}.',
  'directo'
);
