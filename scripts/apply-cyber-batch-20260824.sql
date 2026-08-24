-- Lote 3 del diccionario — Ciberseguridad, identidad y gestion de endpoint.
-- Ejecutado el 24/08/2026. Respaldo previo en dictionary_backup_20260824.
--
-- Ocho productos: Microsoft Sentinel, Microsoft Defender, Palo Alto Networks,
-- SentinelOne, Check Point, Microsoft Purview, Microsoft Intune, Microsoft Entra.
-- Resultado: 331 -> 181 keywords, -640 senales falsas, 55 jobs add_keyword.

-- ---------------------------------------------------------------------------
-- 0. CORRECCION de la propuesta original: "Palo Alto" se queda
-- ---------------------------------------------------------------------------
-- En la auditoria propuse sacarla porque matchea la ciudad de California.
-- Medido sobre sus 474 senales antes de aplicar nada:
--   365 (77%) mencionan un firewall o marca de seguridad en el mismo snippet
--              (Fortinet, Cisco, Check Point, NGFW, VPN, Panorama, Prisma, Cortex)
--    14  (3%) mencionan California, Stanford, Silicon Valley o una universidad
-- Son ingenieros de redes enumerando marcas de firewall. Sacarla habria dejado
-- al producto con 66 senales en vez de 540.
--
--   select count(*) total,
--     count(*) filter (where snippet ~* '\y(firewall|fortinet|checkpoint|check point|cisco|ngfw|vpn|panorama|prisma|cortex|sophos|watchguard|juniper|ciberseguridad|cybersecurity)\y') as marcas,
--     count(*) filter (where snippet ~* '\y(california|stanford|silicon valley|university|universidad)\y') as ciudad
--   from signals where signal_type='technology' and lower(keyword_matched)='palo alto';
--
-- Leccion: "esta palabra podria ser ambigua" no es evidencia. PAN resulto 85%
-- "Pan American Energy" y Palo Alto resulto 77% firewalls, y las dos parecian
-- igual de sospechosas antes de medir.

-- ---------------------------------------------------------------------------
-- 1. Los seis falsos positivos, verificados contra snippets
-- ---------------------------------------------------------------------------
--  Defender                  Microsoft Defender  308  verbo espanol. Solo 88 de 308
--                                                     tenian contexto de seguridad:
--                                                     "exponer y defender la propuesta"
--  SITs                      Purview             147  la palabra inglesa "sits":
--                                                     "Evaluacion de sits costo"
--  Sentinel                  Microsoft Sentinel   86  el buro de credito peruano:
--                                                     "Verificacion de clientes nuevos en SENTINEL"
--  Singularity               SentinelOne          44  Singularity University. Estaba
--                                                     ademas duplicada en el array.
--  Entra                     Microsoft Entra      25  verbo espanol: "todo producto que entra",
--                                                     "lo que no entra en un curriculum"
--  Mobile Device Management  Intune               24  la categoria, no el producto. Puede ser
--                                                     Jamf, Workspace ONE o MobileIron.
-- mas ASIM (2, nombre de pila comun), Mobile Application Management (2) y
-- Mobile Threat Defense (2). Total: 640 senales.
--
-- Efecto sobre las cuentas: Microsoft Sentinel figuraba con 84 cuentas y quedan 8.
-- Las otras 76 nunca tuvieron el SIEM: la senal venia de consultar un buro de credito.

-- ---------------------------------------------------------------------------
-- 2. Las nubes se reemplazaron enteras (no keyword por keyword)
-- ---------------------------------------------------------------------------
-- En Sentinel (92 de 97 sin senal), Purview (70 de 74) e Intune (76 de 86) el
-- array era casi todo combinatoria "producto + sustantivo" que nadie escribe
-- (Syslog Sentinel, CEF Sentinel, Azure Resource Logs Sentinel, Purview Alerts,
-- iOS Intune Management...). Reemplazar el array completo por la nube curada es
-- mas claro que enumerar 200 bajas.
--
-- update dictionary_products set keywords = array[...], updated_at = now()
--   where name = 'Microsoft Sentinel';   -- 27 keywords
-- ... idem Microsoft Defender (23), Palo Alto Networks (20), Sentinel One (14),
--     Check Point (18), Purview (26), Intune (32), Microsoft Entra (21)

-- Criterios aplicados, iguales a los del lote ERP:
--   - Formas cortas sin marca solo cuando son inequivocas: "Defender for Endpoint",
--     "Entra ID", "Intune" a secas. Nadie las usa hablando de otra cosa.
--   - Certificaciones: son la senal mas limpia de LinkedIn, nadie las pone sin
--     haber rendido el examen. PCNSE, PCNSA, CCSA, CCSE, SC-200, SC-300, SC-400, MD-102.
--   - Jerga exclusiva del producto aunque tenga 0 senales: SmartConsole, Gaia OS,
--     Storyline, Purple AI, Ranger IoT, VM-Series.
--   - Fuera las siglas de tres letras que colisionan: MDE (Defender), OAC.
--     Se dejo KQL: son tres letras pero no choca con ninguna palabra comun,
--     solo con el KQL de Elastic, marginal en este corpus.
--   - Variantes de escritura que faltaban: "CheckPoint" sin espacio es como lo
--     escribe buena parte de los perfiles y no se detectaba.

-- ---------------------------------------------------------------------------
-- 3. Limpieza de senales que quedaron sin keyword
-- ---------------------------------------------------------------------------
delete from signals s using dictionary_products p
where s.signal_id = p.id and s.signal_type = 'technology'
  and not exists (select 1 from unnest(p.keywords) k where lower(k) = lower(s.keyword_matched));

-- ---------------------------------------------------------------------------
-- 4. Encolar las keywords nuevas
-- ---------------------------------------------------------------------------
insert into dictionary_jobs (job_type, signal_id, signal_type, keyword, status, created_by)
select 'add_keyword', p.id, 'technology', k.kw, 'pending', 'lote-ciberseguridad-20260824'
from dictionary_products p cross join lateral unnest(p.keywords) k(kw)
where p.name in ('Microsoft Sentinel','Microsoft Defender','Palo Alto Networks','Sentinel One',
                 'Check Point','Purview','Intune','Microsoft Entra')
  and not exists (select 1 from signals s where s.signal_id = p.id and s.signal_type = 'technology'
                    and lower(s.keyword_matched) = lower(k.kw))
  and not exists (select 1 from dictionary_jobs j where j.signal_id = p.id
                    and j.job_type = 'add_keyword' and lower(j.keyword) = lower(k.kw));
-- 55 jobs. El cron process-dictionary corre cada minuto y los procesa solo.
