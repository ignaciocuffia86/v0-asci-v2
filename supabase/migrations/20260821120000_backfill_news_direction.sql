-- ═══════════════════════════════════════════════════════════
-- Fase 8: backfill one-off de `company_news.direction` (capa L1).
--
-- La columna existe desde el baseline pero estaba prácticamente sin usar: al
-- empezar la fase 8 había 4 filas clasificadas de 1.141. Sin dirección, el
-- radar no puede distinguir "se expande, tiene recursos" de "está en
-- contracción, el CAPEX se frena", que es la lectura de negocio que pide el
-- informe.
--
-- ⚠️ Esto es un backfill de datos históricos, NO la fuente de verdad. El
-- vocabulario vive en `lib/v3/services/news-rules.ts` (NEWS_EVENT_RULES) y las
-- noticias nuevas se clasifican al ingerir con `classifyNewsEvent`. Los
-- patrones de acá son la traducción a regex de Postgres de esas mismas reglas
-- al 21-ago-2026; si el vocabulario cambia, se cambia en el módulo TS y esta
-- migración NO se toca (ya corrió).
--
-- El orden importa igual que en el módulo: contracción primero, porque comparte
-- vocabulario con expansión ("vende la unidad de negocio" contiene "negocio").
-- ═══════════════════════════════════════════════════════════

update public.company_news
set direction = case
  when (coalesce(title,'') || ' ' || coalesce(summary,'')) ~*
    '(cierre de (planta|f[aá]brica|operaciones)|cierra su|despido|desvincula|reestructuraci[oó]n|(venta|vende|vendi[oó]|desprende)\s+(de\s+)?(la\s+|su\s+)?(unidad|divisi[oó]n|negocio|filial|participaci[oó]n)|desinversi[oó]n|se retira de|salida de(l)? (pa[ií]s|mercado)|abandona el mercado|default|concurso de acreedores|quiebra|suspensi[oó]n de pagos|aumento de (la )?deuda|endeudamiento|p[eé]rdidas|ca[ií]da de (ventas|ingresos)|recorte)'
    then 'contraccion'
  when (coalesce(title,'') || ' ' || coalesce(summary,'')) ~*
    '(expansi[oó]n|inversi[oó]n|invierte|planta|f[aá]brica|apertura|inaugura|nuevo mercado|adquisici[oó]n|adquiere|adquiri[oó]|compra (la )?(empresa|competidor|participaci[oó]n)|fusi[oó]n|se fusiona|m&a|centro de distribuci[oó]n|licitaci[oó]n|rfp)'
    then 'expansion'
  when (coalesce(title,'') || ' ' || coalesce(summary,'')) ~*
    '(\ycio\y|\ycto\y|\ycdo\y|\ycfo\y|\yceo\y|nombramiento|nuevo director|nueva director|gerente de|ejecutiv)'
    then 'neutro'
  when (coalesce(title,'') || ' ' || coalesce(summary,'')) ~*
    '(implementaci[oó]n|migraci[oó]n|moderniza|transformaci[oó]n digital|innovaci[oó]n|erp|crm|sap|oracle|cloud|nube|datacenter|data center)'
    then 'expansion'
  else 'neutro'
end
where direction is null;
