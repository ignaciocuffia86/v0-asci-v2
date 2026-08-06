-- 436: Borra el workspace de test que dejo el harness del MCP y que rompia el login de /v3
--
-- CONTEXTO
-- El harness de test del MCP creo '[TEST v0] harness workspace B' (dominio .invalid)
-- y dejo adentro al usuario real como miembro activo. A partir de ahi el usuario
-- tenia 2 membresias activas, y getWorkspaceForUser usaba .single(), que en
-- supabase-js falla con PGRST116 cuando hay MAS de una fila (no solo con cero).
-- Resultado: /v3 mostraba "no tenes workspace" aunque los datos estaban intactos.
-- El panel de admin seguia funcionando porque api-key-access.ts usa
-- .limit(1).maybeSingle(), que tolera duplicados.
--
-- VERIFICADO ANTES DE BORRAR (dry run)
--   - Las 26 FK que apuntan a v3.workspaces son CASCADE (salvo ai_usage_log, SET NULL).
--   - El CASCADE alcanza solo 3 filas: 2 mcp_api_keys + 1 workspace_members.
--     Las dos keys son del harness ('[TEST v0] harness MCP UX B' y '[TEST v0] capability search').
--   - 0 followed_accounts, 0 workspace_documents, 0 ai_usage_log.
--   - La key real del usuario ('Claude', asci_217b7d7) vive en 'Bigua' y NO se toca.
--
-- Se borra por id resuelto por nombre + dominio .invalid para no depender de un uuid
-- hardcodeado, y se aborta si aparece mas de un candidato.

DO $$
DECLARE
  ws_id uuid;
  candidatos int;
  cuentas int;
  docs int;
BEGIN
  SELECT count(*) INTO candidatos
    FROM v3.workspaces
   WHERE name = '[TEST v0] harness workspace B' AND domain LIKE '%.invalid';

  IF candidatos = 0 THEN
    RAISE NOTICE 'Nada que hacer: el workspace de test ya no existe.';
    RETURN;
  END IF;

  IF candidatos > 1 THEN
    RAISE EXCEPTION 'Se esperaba 1 workspace de test y hay %. Abortado por seguridad.', candidatos;
  END IF;

  SELECT id INTO ws_id
    FROM v3.workspaces
   WHERE name = '[TEST v0] harness workspace B' AND domain LIKE '%.invalid';

  -- Guardrail: si el workspace de test tuviera datos reales, abortamos.
  SELECT count(*) INTO cuentas FROM v3.followed_accounts WHERE workspace_id = ws_id;
  SELECT count(*) INTO docs    FROM v3.workspace_documents WHERE workspace_id = ws_id;

  IF cuentas > 0 OR docs > 0 THEN
    RAISE EXCEPTION 'El workspace % tiene datos (% cuentas, % docs). Abortado: revisar a mano.',
      ws_id, cuentas, docs;
  END IF;

  RAISE NOTICE 'Borrando workspace de test % (0 cuentas, 0 docs)', ws_id;

  -- El resto (mcp_api_keys, workspace_members) cae por CASCADE.
  DELETE FROM v3.workspaces WHERE id = ws_id;

  RAISE NOTICE 'Borrado OK.';
END $$;

-- Verificacion: el usuario tiene que quedar con EXACTAMENTE 1 membresia activa.
SELECT u.email,
       count(*) AS membresias_activas,
       string_agg(w.name, ', ') AS workspaces
FROM v3.workspace_members wm
JOIN v3.workspaces w ON w.id = wm.workspace_id
LEFT JOIN auth.users u ON u.id = wm.user_id
WHERE wm.status = 'active'
GROUP BY u.email
HAVING count(*) > 1;
-- Si esta consulta no devuelve filas, ya no hay ningun usuario con membresias duplicadas.
