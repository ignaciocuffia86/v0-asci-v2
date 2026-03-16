-- ============================================
-- FASE 2: Seed de Industry Mappings
-- ============================================
-- Este script inserta los mapeos de industrias originales a maestras
-- para companies (source_type = 'company') y document_tags (source_type = 'document')

-- ============================================
-- PARTE 1: Mapeos para Companies
-- ============================================

INSERT INTO industry_mappings (original_value, master_industry_id, source_type) VALUES
-- TECHNOLOGY & SOFTWARE
('Information Technology & Services', 'technology', 'company'),
('Information Technology and Services', 'technology', 'company'),
('Computer Software', 'technology', 'company'),
('Internet', 'technology', 'company'),
('Computer & Network Security', 'technology', 'company'),
('Computer Networking', 'technology', 'company'),
('Computer Hardware', 'technology', 'company'),
('Semiconductors', 'technology', 'company'),
('Information Services', 'technology', 'company'),
('IT Services and IT Consulting', 'technology', 'company'),
('Software Development', 'technology', 'company'),
('Technology, Information and Internet', 'technology', 'company'),
('IT System Custom Software Development', 'technology', 'company'),
('Computer Games', 'technology', 'company'),
('E-Learning', 'technology', 'company'),
('Nanotechnology', 'technology', 'company'),

-- FINANCIAL SERVICES
('Financial Services', 'financial_services', 'company'),
('Investment Banking', 'financial_services', 'company'),
('Investment Management', 'financial_services', 'company'),
('Venture Capital & Private Equity', 'financial_services', 'company'),
('Capital Markets', 'financial_services', 'company'),
('Accounting', 'financial_services', 'company'),

-- BANKING
('Banking', 'banking', 'company'),
('Banca', 'banking', 'company'),

-- INSURANCE
('Insurance', 'insurance', 'company'),
('Seguros', 'insurance', 'company'),

-- HEALTHCARE & PHARMACEUTICALS
('Hospital & Health Care', 'healthcare', 'company'),
('Medical Devices', 'healthcare', 'company'),
('Medical Practice', 'healthcare', 'company'),
('Pharmaceuticals', 'healthcare', 'company'),
('Biotechnology', 'healthcare', 'company'),
('Health, Wellness & Fitness', 'healthcare', 'company'),
('Mental Health Care', 'healthcare', 'company'),
('Alternative Medicine', 'healthcare', 'company'),
('Veterinary', 'healthcare', 'company'),
('Hospitals and Health Care', 'healthcare', 'company'),

-- EDUCATION
('Education Management', 'education', 'company'),
('Higher Education', 'education', 'company'),
('Primary/Secondary Education', 'education', 'company'),
('E-learning', 'education', 'company'),
('Professional Training & Coaching', 'education', 'company'),
('Education', 'education', 'company'),

-- RETAIL & COMMERCE
('Retail', 'retail', 'company'),
('Apparel & Fashion', 'retail', 'company'),
('Consumer Goods', 'retail', 'company'),
('Luxury Goods & Jewelry', 'retail', 'company'),
('Sporting Goods', 'retail', 'company'),
('Cosmetics', 'retail', 'company'),
('Furniture', 'retail', 'company'),
('Consumer Electronics', 'retail', 'company'),
('Wholesale', 'retail', 'company'),
('Wine and Spirits', 'retail', 'company'),
('Supermarkets', 'retail', 'company'),

-- MANUFACTURING & INDUSTRY
('Mechanical or Industrial Engineering', 'manufacturing', 'company'),
('Industrial Automation', 'manufacturing', 'company'),
('Machinery', 'manufacturing', 'company'),
('Electrical/Electronic Manufacturing', 'manufacturing', 'company'),
('Plastics', 'manufacturing', 'company'),
('Paper & Forest Products', 'manufacturing', 'company'),
('Packaging and Containers', 'manufacturing', 'company'),
('Building Materials', 'manufacturing', 'company'),
('Glass, Ceramics & Concrete', 'manufacturing', 'company'),
('Chemicals', 'manufacturing', 'company'),
('Textiles', 'manufacturing', 'company'),
('Manufacturing', 'manufacturing', 'company'),

-- ENERGY & UTILITIES
('Oil & Energy', 'energy', 'company'),
('Renewables & Environment', 'energy', 'company'),
('Utilities', 'energy', 'company'),
('Mining & Metals', 'energy', 'company'),
('Oil and Gas', 'energy', 'company'),

-- TELECOMMUNICATIONS
('Telecommunications', 'telecommunications', 'company'),
('Wireless', 'telecommunications', 'company'),

-- CONSTRUCTION & REAL ESTATE
('Construction', 'construction', 'company'),
('Real Estate', 'construction', 'company'),
('Architecture & Planning', 'construction', 'company'),
('Civil Engineering', 'construction', 'company'),
('Commercial Real Estate', 'construction', 'company'),

-- TRANSPORTATION & LOGISTICS
('Transportation/Trucking/Railroad', 'transportation', 'company'),
('Logistics and Supply Chain', 'transportation', 'company'),
('Airlines/Aviation', 'transportation', 'company'),
('Maritime', 'transportation', 'company'),
('Package/Freight Delivery', 'transportation', 'company'),
('Warehousing', 'transportation', 'company'),
('Railroad Manufacture', 'transportation', 'company'),
('Truck Transportation', 'transportation', 'company'),

-- CONSULTING & PROFESSIONAL SERVICES
('Management Consulting', 'consulting', 'company'),
('Human Resources', 'consulting', 'company'),
('Staffing and Recruiting', 'consulting', 'company'),
('Business Supplies and Equipment', 'consulting', 'company'),
('Outsourcing/Offshoring', 'consulting', 'company'),
('Professional Services', 'consulting', 'company'),
('Research', 'consulting', 'company'),
('Market Research', 'consulting', 'company'),
('Design', 'consulting', 'company'),
('Graphic Design', 'consulting', 'company'),
('Translation and Localization', 'consulting', 'company'),

-- MEDIA & ENTERTAINMENT
('Media Production', 'media', 'company'),
('Broadcast Media', 'media', 'company'),
('Entertainment', 'media', 'company'),
('Music', 'media', 'company'),
('Motion Pictures and Film', 'media', 'company'),
('Publishing', 'media', 'company'),
('Newspapers', 'media', 'company'),
('Online Media', 'media', 'company'),
('Writing and Editing', 'media', 'company'),
('Photography', 'media', 'company'),
('Printing', 'media', 'company'),
('Events Services', 'media', 'company'),
('Performing Arts', 'media', 'company'),
('Fine Art', 'media', 'company'),
('Animation', 'media', 'company'),
('Museums and Institutions', 'media', 'company'),
('Arts and Crafts', 'media', 'company'),
('Libraries', 'media', 'company'),

-- HOSPITALITY & TOURISM
('Hospitality', 'hospitality', 'company'),
('Leisure, Travel & Tourism', 'hospitality', 'company'),
('Restaurants', 'hospitality', 'company'),
('Food & Beverages', 'hospitality', 'company'),
('Gambling & Casinos', 'hospitality', 'company'),
('Recreational Facilities and Services', 'hospitality', 'company'),
('Sports', 'hospitality', 'company'),

-- FOOD & BEVERAGE
('Food Production', 'food_beverage', 'company'),
('Food & Beverage', 'food_beverage', 'company'),
('Dairy', 'food_beverage', 'company'),
('Fishery', 'food_beverage', 'company'),

-- AGRICULTURE
('Farming', 'agriculture', 'company'),
('Ranching', 'agriculture', 'company'),
('Agriculture', 'agriculture', 'company'),

-- MINING & NATURAL RESOURCES
('Mining & Metals', 'mining', 'company'),

-- AUTOMOTIVE
('Automotive', 'automotive', 'company'),
('Motor Vehicle Manufacturing', 'automotive', 'company'),

-- AEROSPACE & DEFENSE
('Aviation & Aerospace', 'aerospace', 'company'),
('Defense & Space', 'aerospace', 'company'),
('Military', 'aerospace', 'company'),

-- GOVERNMENT & PUBLIC SECTOR
('Government Administration', 'government', 'company'),
('Government Relations', 'government', 'company'),
('Public Policy', 'government', 'company'),
('Public Safety', 'government', 'company'),
('Political Organization', 'government', 'company'),
('Judiciary', 'government', 'company'),
('Legislative Office', 'government', 'company'),
('Executive Office', 'government', 'company'),
('International Affairs', 'government', 'company'),
('International Trade and Development', 'government', 'company'),

-- NON-PROFIT
('Nonprofit Organization Management', 'nonprofit', 'company'),
('Philanthropy', 'nonprofit', 'company'),
('Civic & Social Organization', 'nonprofit', 'company'),
('Religious Institutions', 'nonprofit', 'company'),
('Fund-Raising', 'nonprofit', 'company'),
('Think Tanks', 'nonprofit', 'company'),
('Non-profit Organizations', 'nonprofit', 'company'),

-- LEGAL
('Legal Services', 'legal', 'company'),
('Law Practice', 'legal', 'company'),
('Alternative Dispute Resolution', 'legal', 'company'),
('Law Enforcement', 'legal', 'company'),

-- HR & STAFFING
('Human Resources', 'hr_staffing', 'company'),
('Staffing and Recruiting', 'hr_staffing', 'company'),

-- OTHER (catch-all for unmapped)
('Other', 'other', 'company'),
('Individual & Family Services', 'other', 'company'),
('Import and Export', 'other', 'company'),
('Program Development', 'other', 'company'),
('Security and Investigations', 'other', 'company'),
('Facilities Services', 'other', 'company'),
('Environmental Services', 'other', 'company')

ON CONFLICT (original_value, source_type) DO NOTHING;

-- ============================================
-- PARTE 2: Mapeos para Document Tags
-- ============================================
-- Reutilizamos los mismos mapeos pero con source_type = 'document'

INSERT INTO industry_mappings (original_value, master_industry_id, source_type)
SELECT original_value, master_industry_id, 'document'
FROM industry_mappings 
WHERE source_type = 'company'
ON CONFLICT (original_value, source_type) DO NOTHING;

-- ============================================
-- PARTE 3: Normalizar Companies existentes
-- ============================================
-- Actualizar master_industry_id en companies basándose en los mapeos

UPDATE companies c
SET master_industry_id = im.master_industry_id
FROM industry_mappings im
WHERE LOWER(TRIM(c.industry)) = LOWER(TRIM(im.original_value))
  AND im.source_type = 'company'
  AND c.master_industry_id IS NULL;

-- ============================================
-- PARTE 4: Normalizar Document Tags existentes
-- ============================================
-- Actualizar master_industry_id en document_tags basándose en los mapeos

UPDATE document_tags dt
SET master_industry_id = im.master_industry_id
FROM industry_mappings im
WHERE dt.tag_type = 'industry'
  AND LOWER(TRIM(dt.tag_value)) = LOWER(TRIM(im.original_value))
  AND im.source_type = 'document'
  AND dt.master_industry_id IS NULL;

-- ============================================
-- PARTE 5: Estadísticas post-migración
-- ============================================

-- Ver cuántas companies quedaron normalizadas
SELECT 
  'companies_con_master_industry' as metric,
  COUNT(*) as count
FROM companies 
WHERE master_industry_id IS NOT NULL
UNION ALL
SELECT 
  'companies_sin_master_industry',
  COUNT(*)
FROM companies 
WHERE master_industry_id IS NULL AND industry IS NOT NULL AND industry != ''
UNION ALL
SELECT 
  'document_tags_con_master_industry',
  COUNT(*)
FROM document_tags 
WHERE tag_type = 'industry' AND master_industry_id IS NOT NULL
UNION ALL
SELECT 
  'document_tags_sin_master_industry',
  COUNT(*)
FROM document_tags 
WHERE tag_type = 'industry' AND master_industry_id IS NULL
UNION ALL
SELECT 
  'total_mappings',
  COUNT(*)
FROM industry_mappings;
