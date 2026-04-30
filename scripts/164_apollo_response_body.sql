-- Migration 164: agregar columna response_body para diagnostico de Apollo.
--
-- Contexto: hasta ahora apollo_api_calls solo guardaba request_body y
-- response_status. Cuando un call devolvia 200 pero sin datos esperados (ej.
-- phone reveal sin phone_numbers ni request_id), no teniamos forma de saber
-- que respondio Apollo realmente. Esto nos costo dias de debug ciego.
--
-- Esta migracion agrega response_body como JSONB. El logger trunca el body
-- a los primeros ~10KB para evitar inflar la tabla con respuestas masivas
-- (ej. /mixed_people/api_search devuelve listas grandes).

ALTER TABLE public.apollo_api_calls
  ADD COLUMN IF NOT EXISTS response_body JSONB;

-- Indice opcional sobre el endpoint para acelerar queries de diagnostico.
-- Se chequea conditionalmente.
CREATE INDEX IF NOT EXISTS idx_apollo_api_calls_endpoint_created
  ON public.apollo_api_calls(endpoint, created_at DESC);

COMMENT ON COLUMN public.apollo_api_calls.response_body IS
  'Body JSON de la respuesta de Apollo (truncado a ~10KB). Critico para diagnostico cuando el response_status es 200 pero el comportamiento no es el esperado.';
