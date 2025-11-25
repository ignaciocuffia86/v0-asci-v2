-- =====================================================
-- Script 056: Parse relative dates from postedTime
-- =====================================================
-- El campo postedTime contiene texto relativo como:
-- "4 days ago", "2 weeks ago", "1 month ago", etc.
-- Este script parsea ese texto y calcula la fecha real

-- Función para parsear texto relativo a intervalo
CREATE OR REPLACE FUNCTION parse_relative_time(p_text TEXT)
RETURNS INTERVAL AS $$
DECLARE
    v_num INTEGER;
    v_unit TEXT;
    v_result INTERVAL;
BEGIN
    IF p_text IS NULL OR p_text = '' THEN
        RETURN NULL;
    END IF;
    
    -- Normalizar texto (minúsculas, sin espacios extra)
    p_text := lower(trim(p_text));
    
    -- Extraer número y unidad usando regex
    -- Patrones: "4 days ago", "2 weeks ago", "1 month ago", "3 hours ago"
    IF p_text ~ '(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*(ago)?' THEN
        v_num := (regexp_match(p_text, '(\d+)'))[1]::INTEGER;
        v_unit := (regexp_match(p_text, '(second|minute|hour|day|week|month|year)'))[1];
        
        CASE v_unit
            WHEN 'second' THEN v_result := (v_num || ' seconds')::INTERVAL;
            WHEN 'minute' THEN v_result := (v_num || ' minutes')::INTERVAL;
            WHEN 'hour' THEN v_result := (v_num || ' hours')::INTERVAL;
            WHEN 'day' THEN v_result := (v_num || ' days')::INTERVAL;
            WHEN 'week' THEN v_result := (v_num || ' weeks')::INTERVAL;
            WHEN 'month' THEN v_result := (v_num || ' months')::INTERVAL;
            WHEN 'year' THEN v_result := (v_num || ' years')::INTERVAL;
            ELSE v_result := NULL;
        END CASE;
        
        RETURN v_result;
    -- Casos especiales en inglés
    ELSIF p_text LIKE '%just now%' OR p_text LIKE '%moments ago%' THEN
        RETURN '0 seconds'::INTERVAL;
    ELSIF p_text LIKE '%yesterday%' THEN
        RETURN '1 day'::INTERVAL;
    ELSIF p_text LIKE '%last week%' THEN
        RETURN '1 week'::INTERVAL;
    ELSIF p_text LIKE '%last month%' THEN
        RETURN '1 month'::INTERVAL;
    -- Casos en español
    ELSIF p_text ~ '(\d+)\s*(segundo|minuto|hora|día|dia|semana|mes|año)s?' THEN
        v_num := (regexp_match(p_text, '(\d+)'))[1]::INTEGER;
        v_unit := (regexp_match(p_text, '(segundo|minuto|hora|día|dia|semana|mes|año)'))[1];
        
        CASE v_unit
            WHEN 'segundo' THEN v_result := (v_num || ' seconds')::INTERVAL;
            WHEN 'minuto' THEN v_result := (v_num || ' minutes')::INTERVAL;
            WHEN 'hora' THEN v_result := (v_num || ' hours')::INTERVAL;
            WHEN 'día', 'dia' THEN v_result := (v_num || ' days')::INTERVAL;
            WHEN 'semana' THEN v_result := (v_num || ' weeks')::INTERVAL;
            WHEN 'mes' THEN v_result := (v_num || ' months')::INTERVAL;
            WHEN 'año' THEN v_result := (v_num || ' years')::INTERVAL;
            ELSE v_result := NULL;
        END CASE;
        
        RETURN v_result;
    ELSIF p_text LIKE '%hace un momento%' OR p_text LIKE '%ahora%' THEN
        RETURN '0 seconds'::INTERVAL;
    ELSIF p_text LIKE '%ayer%' THEN
        RETURN '1 day'::INTERVAL;
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Actualizar posted_at basándose en el texto relativo
-- Usamos created_at (cuando se insertó) menos el intervalo relativo
DO $$
DECLARE
    v_updated INTEGER := 0;
    v_job RECORD;
    v_posted_time TEXT;
    v_interval INTERVAL;
    v_calculated_date TIMESTAMPTZ;
BEGIN
    RAISE NOTICE 'Iniciando actualización de fechas de job postings...';
    
    FOR v_job IN 
        SELECT 
            id, 
            created_at,
            source_data->>'postedTime' AS posted_time_text,
            source_data->'_original'->>'postedTime' AS posted_time_original
        FROM job_postings
        WHERE source_data IS NOT NULL
    LOOP
        -- Intentar obtener postedTime de diferentes lugares
        v_posted_time := COALESCE(
            v_job.posted_time_text,
            v_job.posted_time_original
        );
        
        IF v_posted_time IS NOT NULL AND v_posted_time != '' THEN
            v_interval := parse_relative_time(v_posted_time);
            
            IF v_interval IS NOT NULL THEN
                -- Calcular fecha: created_at - intervalo relativo
                v_calculated_date := v_job.created_at - v_interval;
                
                UPDATE job_postings
                SET posted_at = v_calculated_date
                WHERE id = v_job.id;
                
                v_updated := v_updated + 1;
                
                IF v_updated % 100 = 0 THEN
                    RAISE NOTICE 'Procesados: % job postings', v_updated;
                END IF;
            END IF;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Actualización completada. Total actualizados: %', v_updated;
END $$;

-- Verificar resultados
SELECT 
    title,
    source_data->>'postedTime' AS posted_time_text,
    created_at AS fecha_insercion,
    posted_at AS fecha_calculada,
    created_at - posted_at AS diferencia
FROM job_postings
LIMIT 10;
