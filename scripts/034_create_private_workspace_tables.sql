-- Enable RLS on all new tables to ensure privacy

-- 1. Private Signals (Web Research)
CREATE TABLE IF NOT EXISTS public.user_company_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    company_id UUID REFERENCES public.companies(id) NOT NULL,
    
    -- Content
    title TEXT,
    content TEXT,
    source_url TEXT,
    source_name TEXT,
    signal_type TEXT, -- 'news', 'success_story', 'financial', 'hiring'
    published_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_company_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own signals" ON public.user_company_signals
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


-- 2. Private Contacts (Decision Makers)
CREATE TABLE IF NOT EXISTS public.user_company_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    company_id UUID REFERENCES public.companies(id) NOT NULL,
    
    -- Contact Info
    first_name TEXT,
    last_name TEXT,
    full_name TEXT,
    role TEXT,
    email TEXT,
    linkedin_url TEXT,
    
    -- Metadata
    source TEXT DEFAULT 'system', -- 'apollo', 'manual', 'system'
    status TEXT DEFAULT 'new', -- 'new', 'contacted', 'replied'
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_company_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own contacts" ON public.user_company_contacts
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


-- 3. Private Icebreakers (AI Generated)
CREATE TABLE IF NOT EXISTS public.user_icebreakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    company_id UUID REFERENCES public.companies(id) NOT NULL,
    contact_id UUID REFERENCES public.user_company_contacts(id), -- Optional, can be general for company
    
    -- Content
    generated_text TEXT,
    template_used TEXT,
    tone TEXT, -- 'formal', 'casual', 'direct'
    context_used TEXT, -- Summary of signals used
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_icebreakers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own icebreakers" ON public.user_icebreakers
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_user_company_signals_user_company ON public.user_company_signals(user_id, company_id);
CREATE INDEX idx_user_company_contacts_user_company ON public.user_company_contacts(user_id, company_id);
CREATE INDEX idx_user_icebreakers_user_company ON public.user_icebreakers(user_id, company_id);
