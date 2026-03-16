# Feature: Filtro por Industria en Resultados de Búsqueda

## Resumen

Permitir a los usuarios filtrar los resultados de búsqueda (por tecnología o proceso) por industria, después de haber seleccionado el país. Las 358+ industrias actuales se unificarán en 25 categorías maestras.

## Contexto Actual

### Problema
- La tabla `companies` tiene **358 industrias únicas** con alta fragmentación
- Muchas son variantes del mismo concepto (ej: "IT Services and IT Consulting" vs "Information Technology & Services")
- No existe forma de filtrar resultados por industria después de buscar

### Datos Actuales (Top 20 por volumen)
| Industria Original | Empresas |
|-------------------|----------|
| Information Technology & Services | 3,315 |
| IT Services and IT Consulting | 1,969 |
| Software Development | 1,550 |
| Financial Services | 1,532 |
| Higher Education | 981 |
| Business Consulting and Services | 909 |
| Computer Software | 758 |
| Retail | 693 |
| Construction | 682 |
| Government Administration | 664 |

---

## Diseño de Solución

### 25 Industrias Maestras

```typescript
export const MASTER_INDUSTRIES = [
  { id: 'technology', name: 'Tecnología y Software', icon: 'Monitor' },
  { id: 'financial_services', name: 'Servicios Financieros', icon: 'Landmark' },
  { id: 'banking', name: 'Banca', icon: 'Building2' },
  { id: 'insurance', name: 'Seguros', icon: 'Shield' },
  { id: 'healthcare', name: 'Salud y Farmacéutica', icon: 'Heart' },
  { id: 'education', name: 'Educación', icon: 'GraduationCap' },
  { id: 'retail', name: 'Retail y Comercio', icon: 'ShoppingCart' },
  { id: 'manufacturing', name: 'Manufactura e Industria', icon: 'Factory' },
  { id: 'energy', name: 'Energía y Utilities', icon: 'Zap' },
  { id: 'telecommunications', name: 'Telecomunicaciones', icon: 'Radio' },
  { id: 'construction', name: 'Construcción e Inmobiliario', icon: 'Building' },
  { id: 'transportation', name: 'Transporte y Logística', icon: 'Truck' },
  { id: 'consulting', name: 'Consultoría y Servicios Profesionales', icon: 'Briefcase' },
  { id: 'media', name: 'Medios y Entretenimiento', icon: 'Tv' },
  { id: 'hospitality', name: 'Hotelería y Turismo', icon: 'Hotel' },
  { id: 'food_beverage', name: 'Alimentos y Bebidas', icon: 'UtensilsCrossed' },
  { id: 'agriculture', name: 'Agricultura y Ganadería', icon: 'Wheat' },
  { id: 'mining', name: 'Minería y Recursos Naturales', icon: 'Mountain' },
  { id: 'automotive', name: 'Automotriz', icon: 'Car' },
  { id: 'aerospace', name: 'Aeroespacial y Defensa', icon: 'Plane' },
  { id: 'government', name: 'Gobierno y Sector Público', icon: 'Landmark' },
  { id: 'nonprofit', name: 'ONGs y Organizaciones Civiles', icon: 'Heart' },
  { id: 'legal', name: 'Legal y Jurídico', icon: 'Scale' },
  { id: 'hr_staffing', name: 'Recursos Humanos y Staffing', icon: 'Users' },
  { id: 'other', name: 'Otras Industrias', icon: 'MoreHorizontal' },
] as const;
```

### Mapeo de Industrias (industry_mapping)

```typescript
export const INDUSTRY_MAPPING: Record<string, string> = {
  // === TECNOLOGÍA Y SOFTWARE ===
  'Information Technology & Services': 'technology',
  'IT Services and IT Consulting': 'technology',
  'Software Development': 'technology',
  'Computer Software': 'technology',
  'Technology, Information and Internet': 'technology',
  'Computer and Network Security': 'technology',
  'Computer & Network Security': 'technology',
  'Data Security Software Products': 'technology',
  'Information Services': 'technology',
  'Internet': 'technology',
  'Internet Marketplace Platforms': 'technology',
  'Computer Hardware': 'technology',
  'Computer Hardware Manufacturing': 'technology',
  'Computer Games': 'technology',
  'Semiconductors': 'technology',
  'Semiconductor Manufacturing': 'technology',
  'Blockchain Services': 'technology',
  'Business Intelligence Platforms': 'technology',
  'Data Infrastructure and Analytics': 'technology',
  'Embedded Software Products': 'technology',
  'IT System Custom Software Development': 'technology',
  'IT System Data Services': 'technology',
  'IT System Design Services': 'technology',
  'Desktop Computing Software Products': 'technology',
  'Mobile Computing Software Products': 'technology',
  'Computer Networking Products': 'technology',
  'Computer Networking': 'technology',
  'Computers and Electronics Manufacturing': 'technology',
  'Technology': 'technology',
  'Technology Information and Internet': 'technology',
  'Information Technology and Services': 'technology',

  // === SERVICIOS FINANCIEROS ===
  'Financial Services': 'financial_services',
  'Investment Management': 'financial_services',
  'Investment Banking': 'financial_services',
  'Venture Capital and Private Equity Principals': 'financial_services',
  'Venture Capital & Private Equity': 'financial_services',
  'Capital Markets': 'financial_services',
  'Investment Advice': 'financial_services',
  'Accounting': 'financial_services',
  'Credit Intermediation': 'financial_services',
  'Funds and Trusts': 'financial_services',

  // === BANCA ===
  'Banking': 'banking',

  // === SEGUROS ===
  'Insurance': 'insurance',
  'Claims Adjusting, Actuarial Services': 'insurance',

  // === SALUD Y FARMACÉUTICA ===
  'Hospital & Health Care': 'healthcare',
  'Hospitals and Health Care': 'healthcare',
  'Hospitals': 'healthcare',
  'Pharmaceutical Manufacturing': 'healthcare',
  'Pharmaceuticals': 'healthcare',
  'Medical Device': 'healthcare',
  'Medical Equipment Manufacturing': 'healthcare',
  'Medical Practices': 'healthcare',
  'Medical Practice': 'healthcare',
  'Medical and Diagnostic Laboratories': 'healthcare',
  'Mental Health Care': 'healthcare',
  'Biotechnology': 'healthcare',
  'Biotechnology Research': 'healthcare',
  'Health Wellness & Fitness': 'healthcare',
  'Health, Wellness & Fitness': 'healthcare',
  'Wellness and Fitness Services': 'healthcare',
  'Health and Human Services': 'healthcare',
  'Public Health': 'healthcare',
  'Veterinary Services': 'healthcare',
  'Veterinary': 'healthcare',
  'Dentists': 'healthcare',
  'Physicians': 'healthcare',
  'Alternative Medicine': 'healthcare',
  'Outpatient Care Centers': 'healthcare',
  'Home Health Care Services': 'healthcare',
  'Nursing Homes and Residential Care Facilities': 'healthcare',
  'Ambulance Services': 'healthcare',
  'Nanotechnology Research': 'healthcare',

  // === EDUCACIÓN ===
  'Higher Education': 'education',
  'Education': 'education',
  'Education Management': 'education',
  'Education Administration Programs': 'education',
  'Primary and Secondary Education': 'education',
  'Primary/Secondary Education': 'education',
  'E-Learning Providers': 'education',
  'E-learning': 'education',
  'E-Learning': 'education',
  'Professional Training and Coaching': 'education',
  'Professional Training & Coaching': 'education',
  'Technical and Vocational Training': 'education',
  'Research': 'education',
  'Research Services': 'education',
  'Libraries': 'education',
  'Language Schools': 'education',
  'Fine Arts Schools': 'education',

  // === RETAIL Y COMERCIO ===
  'Retail': 'retail',
  'Retail Apparel and Fashion': 'retail',
  'Apparel & Fashion': 'retail',
  'Retail Luxury Goods and Jewelry': 'retail',
  'Luxury Goods & Jewelry': 'retail',
  'Retail Groceries': 'retail',
  'Retail Motor Vehicles': 'retail',
  'Retail Office Equipment': 'retail',
  'Retail Health and Personal Care Products': 'retail',
  'Retail Pharmacies': 'retail',
  'Retail Furniture and Home Furnishings': 'retail',
  'Retail Appliances, Electrical, and Electronic Equipment': 'retail',
  'Retail Office Supplies and Gifts': 'retail',
  'Retail Art Supplies': 'retail',
  'Retail Books and Printed News': 'retail',
  'Retail Building Materials and Garden Equipment': 'retail',
  'Retail Gasoline': 'retail',
  'Consumer Goods': 'retail',
  'Consumer Electronics': 'retail',
  'Consumer Services': 'retail',
  'Cosmetics': 'retail',
  'Personal Care Product Manufacturing': 'retail',
  'Personal Care Services': 'retail',
  'Wholesale': 'retail',
  'Wholesale Building Materials': 'retail',
  'Wholesale Import and Export': 'retail',
  'Wholesale Drugs and Sundries': 'retail',
  'Wholesale Food and Beverage': 'retail',
  'Wholesale Computer Equipment': 'retail',
  'Wholesale Machinery': 'retail',
  'Wholesale Apparel and Sewing Supplies': 'retail',
  'Wholesale Appliances, Electrical, and Electronics': 'retail',
  'Wholesale Alcoholic Beverages': 'retail',
  'Wholesale Petroleum and Petroleum Products': 'retail',
  'Wholesale Hardware, Plumbing, Heating Equipment': 'retail',
  'Wholesale Metals and Minerals': 'retail',
  'Wholesale Motor Vehicles and Parts': 'retail',
  'Wholesale Paper Products': 'retail',
  'Wholesale Recyclable Materials': 'retail',
  'Wholesale Footwear': 'retail',
  'Import & Export': 'retail',
  'Supermarkets': 'retail',
  'Food and Beverage Retail': 'retail',
  'Online and Mail Order Retail': 'retail',
  'Internet Marketplace Platforms': 'retail',

  // === MANUFACTURA E INDUSTRIA ===
  'Manufacturing': 'manufacturing',
  'Mechanical Or Industrial Engineering': 'manufacturing',
  'Industrial Machinery Manufacturing': 'manufacturing',
  'Industrial Automation': 'manufacturing',
  'Machinery': 'manufacturing',
  'Machinery Manufacturing': 'manufacturing',
  'Appliances, Electrical, and Electronics Manufacturing': 'manufacturing',
  'Electrical & Electronic Manufacturing': 'manufacturing',
  'Electrical Equipment Manufacturing': 'manufacturing',
  'Appliances Electrical and Electronics Manufacturing': 'manufacturing',
  'Electric Lighting Equipment Manufacturing': 'manufacturing',
  'Chemicals': 'manufacturing',
  'Chemical Manufacturing': 'manufacturing',
  'Plastics': 'manufacturing',
  'Plastics Manufacturing': 'manufacturing',
  'Textiles': 'manufacturing',
  'Textile Manufacturing': 'manufacturing',
  'Packaging & Containers': 'manufacturing',
  'Packaging and Containers Manufacturing': 'manufacturing',
  'Paper & Forest Products': 'manufacturing',
  'Paper and Forest Product Manufacturing': 'manufacturing',
  'Building Materials': 'manufacturing',
  'Glass Ceramics & Concrete': 'manufacturing',
  'Glass, Ceramics and Concrete Manufacturing': 'manufacturing',
  'Glass Product Manufacturing': 'manufacturing',
  'Furniture': 'manufacturing',
  'Furniture and Home Furnishings Manufacturing': 'manufacturing',
  'Sporting Goods Manufacturing': 'manufacturing',
  'Sporting Goods': 'manufacturing',
  'Fabricated Metal Products': 'manufacturing',
  'Primary Metal Manufacturing': 'manufacturing',
  'Metal Treatments': 'manufacturing',
  'Metalworking Machinery Manufacturing': 'manufacturing',
  'Architectural and Structural Metal Manufacturing': 'manufacturing',
  'Business Supplies & Equipment': 'manufacturing',
  'Automation Machinery Manufacturing': 'manufacturing',
  'Measuring and Control Instrument Manufacturing': 'manufacturing',
  'Communications Equipment Manufacturing': 'manufacturing',
  'Engines and Power Transmission Equipment Manufacturing': 'manufacturing',
  'HVAC and Refrigeration Equipment Manufacturing': 'manufacturing',
  'Footwear Manufacturing': 'manufacturing',
  'Fashion Accessories Manufacturing': 'manufacturing',
  'Apparel Manufacturing': 'manufacturing',
  'Household Appliance Manufacturing': 'manufacturing',
  'Wood Product Manufacturing': 'manufacturing',
  'Leather Product Manufacturing': 'manufacturing',
  'Paint, Coating, and Adhesive Manufacturing': 'manufacturing',
  'Soap and Cleaning Product Manufacturing': 'manufacturing',
  'Robotics Engineering': 'manufacturing',

  // === ENERGÍA Y UTILITIES ===
  'Utilities': 'energy',
  'Oil & Energy': 'energy',
  'Oil and Gas': 'energy',
  'Oil, Gas, and Mining': 'energy',
  'Renewables & Environment': 'energy',
  'Renewable Energy Power Generation': 'energy',
  'Renewable Energy Semiconductor Manufacturing': 'energy',
  'Renewable Energy Equipment Manufacturing': 'energy',
  'Services for Renewable Energy': 'energy',
  'Environmental Services': 'energy',
  'Electric Power Generation': 'energy',
  'Electric Power Transmission, Control, and Distribution': 'energy',
  'Solar Electric Power Generation': 'energy',
  'Hydroelectric Power Generation': 'energy',
  'Nuclear Electric Power Generation': 'energy',
  'Natural Gas Distribution': 'energy',
  'Utilities Administration': 'energy',
  'Energy Technology': 'energy',
  'Energy & Utilities': 'energy',
  'Climate Technology Product Manufacturing': 'energy',
  'Climate Data and Analytics': 'energy',

  // === TELECOMUNICACIONES ===
  'Telecommunications': 'telecommunications',
  'Telecommunications Carriers': 'telecommunications',
  'Wireless Services': 'telecommunications',
  'Wireless': 'telecommunications',
  'Satellite Telecommunications': 'telecommunications',
  'Telephone Call Centers': 'telecommunications',
  'Media and Telecommunications': 'telecommunications',

  // === CONSTRUCCIÓN E INMOBILIARIO ===
  'Construction': 'construction',
  'Civil Engineering': 'construction',
  'Real Estate': 'construction',
  'Commercial Real Estate': 'construction',
  'Real Estate Agents and Brokers': 'construction',
  'Leasing Non-residential Real Estate': 'construction',
  'Leasing Residential Real Estate': 'construction',
  'Real Estate and Equipment Rental Services': 'construction',
  'Architecture and Planning': 'construction',
  'Architecture & Planning': 'construction',
  'Building Construction': 'construction',
  'Nonresidential Building Construction': 'construction',
  'Residential Building Construction': 'construction',
  'Building Equipment Contractors': 'construction',
  'Highway, Street, and Bridge Construction': 'construction',
  'Utility System Construction': 'construction',
  'Interior Design': 'construction',
  'Facilities Services': 'construction',

  // === TRANSPORTE Y LOGÍSTICA ===
  'Transportation/Trucking/Railroad': 'transportation',
  'Transportation, Logistics, Supply Chain and Storage': 'transportation',
  'Transportation Logistics Supply Chain and Storage': 'transportation',
  'Logistics & Supply Chain': 'transportation',
  'Truck Transportation': 'transportation',
  'Rail Transportation': 'transportation',
  'Railroad Equipment Manufacturing': 'transportation',
  'Railroad Manufacture': 'transportation',
  'Maritime Transportation': 'transportation',
  'Maritime': 'transportation',
  'Shipbuilding': 'transportation',
  'Airlines/Aviation': 'transportation',
  'Airlines and Aviation': 'transportation',
  'Ground Passenger Transportation': 'transportation',
  'Urban Transit Services': 'transportation',
  'Package/Freight Delivery': 'transportation',
  'Freight and Package Transportation': 'transportation',
  'Warehousing and Storage': 'transportation',
  'Warehousing': 'transportation',
  'Sightseeing Transportation': 'transportation',
  'Transportation Programs': 'transportation',

  // === CONSULTORÍA Y SERVICIOS PROFESIONALES ===
  'Business Consulting and Services': 'consulting',
  'Management Consulting': 'consulting',
  'Professional Services': 'consulting',
  'Outsourcing/Offshoring': 'consulting',
  'Outsourcing and Offshoring Consulting': 'consulting',
  'Strategic Management Services': 'consulting',
  'Operations Consulting': 'consulting',
  'Engineering Services': 'consulting',
  'Design': 'consulting',
  'Design Services': 'consulting',
  'Graphic Design': 'consulting',
  'Market Research': 'consulting',
  'Administrative and Support Services': 'consulting',
  'Consulting': 'consulting',
  'Executive Search Services': 'consulting',

  // === MEDIOS Y ENTRETENIMIENTO ===
  'Entertainment': 'media',
  'Entertainment Providers': 'media',
  'Media Production': 'media',
  'Broadcast Media': 'media',
  'Broadcast Media Production and Distribution': 'media',
  'Radio and Television Broadcasting': 'media',
  'Online Media': 'media',
  'Online Audio and Video Media': 'media',
  'Internet Publishing': 'media',
  'Internet News': 'media',
  'Book and Periodical Publishing': 'media',
  'Publishing': 'media',
  'Newspaper Publishing': 'media',
  'Newspapers': 'media',
  'Music': 'media',
  'Musicians': 'media',
  'Movies, Videos, and Sound': 'media',
  'Movies and Sound Recording': 'media',
  'Animation': 'media',
  'Animation and Post-production': 'media',
  'Spectator Sports': 'media',
  'Sports': 'media',
  'Sports Teams and Clubs': 'media',
  'Sports and Recreation Instruction': 'media',
  'Gambling Facilities and Casinos': 'media',
  'Gambling & Casinos': 'media',
  'Performing Arts': 'media',
  'Performing Arts and Spectator Sports': 'media',
  'Fine Art': 'media',
  'Arts and Crafts': 'media',
  'Photography': 'media',
  'Writing and Editing': 'media',
  'Writing & Editing': 'media',
  'Recreational Facilities': 'media',
  'Recreational Facilities & Services': 'media',
  'Museums, Historical Sites, and Zoos': 'media',
  'Museums & Institutions': 'media',
  'Museums': 'media',
  'Mobile Gaming Apps': 'media',
  'Social Networking Platforms': 'media',
  'Racetracks': 'media',

  // === HOTELERÍA Y TURISMO ===
  'Hospitality': 'hospitality',
  'Restaurants': 'hospitality',
  'Travel Arrangements': 'hospitality',
  'Leisure Travel & Tourism': 'hospitality',
  'Leisure, Travel & Tourism': 'hospitality',
  'Events Services': 'hospitality',
  'Accommodation and Food Services': 'hospitality',

  // === ALIMENTOS Y BEBIDAS ===
  'Food & Beverages': 'food_beverage',
  'Food Production': 'food_beverage',
  'Food and Beverage Services': 'food_beverage',
  'Food and Beverage Manufacturing': 'food_beverage',
  'Beverage Manufacturing': 'food_beverage',
  'Wine & Spirits': 'food_beverage',
  'Wine and Spirits': 'food_beverage',
  'Wineries': 'food_beverage',
  'Dairy Product Manufacturing': 'food_beverage',
  'Dairy': 'food_beverage',
  'Meat Products Manufacturing': 'food_beverage',
  'Sugar and Confectionery Product Manufacturing': 'food_beverage',
  'Animal Feed Manufacturing': 'food_beverage',
  'Tobacco': 'food_beverage',

  // === AGRICULTURA Y GANADERÍA ===
  'Farming': 'agriculture',
  'Farming, Ranching, Forestry': 'agriculture',
  'Ranching': 'agriculture',
  'Fishery': 'agriculture',
  'Fisheries': 'agriculture',
  'Forestry and Logging': 'agriculture',
  'Agricultural Chemical Manufacturing': 'agriculture',
  'Agriculture, Construction, Mining Machinery Manufacturing': 'agriculture',

  // === MINERÍA Y RECURSOS NATURALES ===
  'Mining': 'mining',
  'Mining & Metals': 'mining',

  // === AUTOMOTRIZ ===
  'Automotive': 'automotive',
  'Motor Vehicle Manufacturing': 'automotive',
  'Motor Vehicle Parts Manufacturing': 'automotive',
  'Vehicle Repair and Maintenance': 'automotive',

  // === AEROESPACIAL Y DEFENSA ===
  'Aviation & Aerospace': 'aerospace',
  'Aviation and Aerospace Component Manufacturing': 'aerospace',
  'Defense & Space': 'aerospace',
  'Defense and Space Manufacturing': 'aerospace',
  'Space Research and Technology': 'aerospace',
  'Military': 'aerospace',
  'Military and International Affairs': 'aerospace',
  'Armed Forces': 'aerospace',

  // === GOBIERNO Y SECTOR PÚBLICO ===
  'Government Administration': 'government',
  'Executive Offices': 'government',
  'Executive Office': 'government',
  'Public Policy Offices': 'government',
  'Public Policy': 'government',
  'Legislative Offices': 'government',
  'Judiciary': 'government',
  'Administration of Justice': 'government',
  'Courts of Law': 'government',
  'Law Enforcement': 'government',
  'Public Safety': 'government',
  'Fire Protection': 'government',
  'International Trade and Development': 'government',
  'International Trade & Development': 'government',
  'International Affairs': 'government',
  'Government Relations Services': 'government',
  'Government Relations': 'government',
  'Think Tanks': 'government',

  // === ONGS Y ORGANIZACIONES CIVILES ===
  'Civic and Social Organizations': 'nonprofit',
  'Civic & Social Organization': 'nonprofit',
  'Non-profit Organizations': 'nonprofit',
  'Non-profit Organization Management': 'nonprofit',
  'Individual & Family Services': 'nonprofit',
  'Individual and Family Services': 'nonprofit',
  'Philanthropic Fundraising Services': 'nonprofit',
  'Philanthropy': 'nonprofit',
  'Fundraising': 'nonprofit',
  'Religious Institutions': 'nonprofit',
  'Political Organizations': 'nonprofit',
  'Political Organization': 'nonprofit',
  'Conservation Programs': 'nonprofit',
  'Community Services': 'nonprofit',
  'Emergency and Relief Services': 'nonprofit',
  'Housing and Community Development': 'nonprofit',
  'Program Development': 'nonprofit',

  // === LEGAL Y JURÍDICO ===
  'Law Practice': 'legal',
  'Legal Services': 'legal',
  'Alternative Dispute Resolution': 'legal',

  // === RECURSOS HUMANOS Y STAFFING ===
  'Human Resources': 'hr_staffing',
  'Human Resources Services': 'hr_staffing',
  'Staffing and Recruiting': 'hr_staffing',
  'Staffing & Recruiting': 'hr_staffing',
  'Temporary Help Services': 'hr_staffing',

  // === MARKETING Y PUBLICIDAD (→ Consulting) ===
  'Advertising Services': 'consulting',
  'Marketing & Advertising': 'consulting',
  'Marketing Services': 'consulting',
  'Public Relations and Communications Services': 'consulting',
  'Public Relations & Communications': 'consulting',
  'Translation and Localization': 'consulting',
  'Translation & Localization': 'consulting',
  'Digital Accessibility Services': 'consulting',

  // === SEGURIDAD (→ Consulting) ===
  'Security and Investigations': 'consulting',
  'Security & Investigations': 'consulting',
  'Security Systems Services': 'consulting',
  'Security Guards and Patrol Services': 'consulting',

  // === OTROS / SIN MAPEAR ===
  'Pet Services': 'other',
  'Printing Services': 'other',
  'Printing': 'other',
  'Repair and Maintenance': 'other',
  'Commercial and Industrial Machinery Maintenance': 'other',
  'Commercial and Industrial Equipment Rental': 'other',
  'Equipment Rental Services': 'other',
  'Office Administration': 'other',
  'Professional Organizations': 'other',
  'Industry Associations': 'other',
  'Holding Companies': 'other',
  'Business Content': 'other',
};
```

---

## Modelo de Datos

### Opción A: Tabla de Mapeo en DB (Recomendada)

```sql
-- Nueva tabla para mapeo de industrias
CREATE TABLE industry_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_industry TEXT NOT NULL UNIQUE,
  master_industry_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas rápidas
CREATE INDEX idx_industry_mapping_original ON industry_mapping(original_industry);
CREATE INDEX idx_industry_mapping_master ON industry_mapping(master_industry_id);

-- Tabla de industrias maestras (referencia)
CREATE TABLE master_industries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_es TEXT NOT NULL,
  icon TEXT NOT NULL,
  display_order INT NOT NULL
);
```

### Opción B: Constante en Código (Más simple)

Mantener el mapeo como constante TypeScript en `lib/constants/industries.ts` y hacer el mapeo en runtime.

**Recomendación**: Usar **Opción B** inicialmente por simplicidad, con posibilidad de migrar a DB si se necesita edición dinámica.

---

## Cambios en Schema

### companies (sin cambios estructurales)

El campo `industry` mantiene el valor original de LinkedIn/Apollo. El mapeo se hace en runtime.

### Alternativa: Agregar columna computed

```sql
-- Agregar columna para industria normalizada (opcional, para performance)
ALTER TABLE companies ADD COLUMN master_industry_id TEXT;

-- Backfill con función
UPDATE companies c
SET master_industry_id = get_master_industry(c.industry);
```

---

## API Design

### Endpoint: GET /api/search/industries

Retorna las industrias disponibles para un resultado de búsqueda específico.

```typescript
// Request
GET /api/search/industries?country=AR&filterType=technology&filterId=xxx

// Response
{
  "industries": [
    { "id": "technology", "name": "Tecnología y Software", "count": 45 },
    { "id": "banking", "name": "Banca", "count": 23 },
    { "id": "healthcare", "name": "Salud y Farmacéutica", "count": 18 },
    // ... solo las que tienen resultados
  ]
}
```

### Modificar: searchCompaniesV2

```typescript
// Agregar parámetro industryIds al search
export async function searchCompaniesV2(params: {
  country: string;
  filterType: 'technology' | 'process';
  filterId: string;
  industryIds?: string[];  // NUEVO: filtro de industrias
  page?: number;
  limit?: number;
}): Promise<SearchResult> {
  // ...
}
```

---

## UI/UX Flow

### 1. Flujo de Búsqueda Actual
```
[Buscar por Tecnología/Proceso] → [Seleccionar País] → [Ver Resultados]
```

### 2. Flujo Propuesto
```
[Buscar por Tecnología/Proceso] → [Seleccionar País] → [Filtrar por Industria (opcional)] → [Ver Resultados]
```

### 3. Componente de Filtro

```tsx
// components/search/industry-filter.tsx
interface IndustryFilterProps {
  availableIndustries: Array<{
    id: string;
    name: string;
    count: number;
  }>;
  selectedIndustries: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function IndustryFilter({ 
  availableIndustries, 
  selectedIndustries, 
  onSelectionChange 
}: IndustryFilterProps) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Filtrar por Industria</Label>
      <div className="flex flex-wrap gap-2">
        {availableIndustries.map((industry) => (
          <Badge
            key={industry.id}
            variant={selectedIndustries.includes(industry.id) ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => toggleIndustry(industry.id)}
          >
            {industry.name} ({industry.count})
          </Badge>
        ))}
      </div>
    </div>
  );
}
```

### 4. Ubicación del Filtro

**En la página de resultados de búsqueda:**
- Sidebar izquierdo (desktop)
- Drawer/Sheet (mobile)
- Chips sobre la tabla de resultados (ambos)

---

## Implementación por Fases

### Fase 1: Infraestructura (Backend)
1. Crear `lib/constants/industries.ts` con mapeo completo
2. Crear función `getMasterIndustry(originalIndustry: string): string`
3. Crear función `getAvailableIndustries(companyIds: string[]): IndustryCount[]`
4. Modificar `searchCompaniesV2` para aceptar filtro de industrias

### Fase 2: API
1. Crear endpoint `/api/search/industries`
2. Agregar parámetro `industryIds` a la búsqueda existente

### Fase 3: UI
1. Crear componente `IndustryFilter`
2. Integrar en página de resultados de búsqueda
3. Persistir selección en URL params para compartir

### Fase 4: Optimización (Opcional)
1. Agregar columna `master_industry_id` a `companies`
2. Backfill datos existentes
3. Trigger para nuevas companies
4. Índice para búsquedas

---

## Consideraciones

### Performance
- El mapeo en runtime es O(1) con un Map/Record
- Para 10k+ resultados, considerar agregar columna computed

### Mantenimiento
- Nuevas industrias de LinkedIn/Apollo se mapean a "other"
- Revisar periódicamente industrias en "other" para reclasificar

### Internacionalización
- Nombres de industrias en español (mercado principal)
- Fácil agregar traducciones a otras lenguas

### Casos Edge
- `industry = null` → No aparece en filtros
- `industry = ""` → No aparece en filtros
- Industria no mapeada → Cuenta como "Otras Industrias"

---

## Métricas de Éxito

1. **Adopción**: % de búsquedas que usan filtro de industria
2. **Conversión**: % de búsquedas con filtro que generan bookmarks
3. **Cobertura**: % de companies con industria mapeada (no "other")
