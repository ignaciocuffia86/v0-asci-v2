-- cp_country: enforce that companies.country_normalized holds a country NAME,
-- never an ISO code.
--
-- Why: v2 exports and country facets read country_normalized as a full name
-- (produced by the normalize_country() trigger). If an ISO-2/3 code is written
-- there, those exports break silently. A live audit found the column is 100%
-- names today (0 ISO values), and normalize_country() never emits a value
-- shorter than 4 chars (it returns a canonical name or NULL) — so this CHECK
-- passes for all current data and for every trigger output. Its job is to make
-- a future ISO write fail loudly instead of corrupting exports.
--
-- The route app/api/v3/admin/normalize-country-phase5 used to write ISO here;
-- it is disabled in the same change.

ALTER TABLE public.companies
  ADD CONSTRAINT companies_country_normalized_is_name
  CHECK (
    country_normalized IS NULL
    OR char_length(btrim(country_normalized)) >= 4
  );

COMMENT ON COLUMN public.companies.country_normalized IS
  'Nombre de país canónico en inglés (p. ej. "Argentina"), producido por normalize_country(). NUNCA un código ISO: los exports de v2 dependen del nombre. El CHECK companies_country_normalized_is_name rechaza valores de <=3 chars.';
