-- Enable RLS
create table if not exists public.user_company_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  company_id uuid references public.companies(id) on delete cascade not null,
  target_summary text,
  recommended_pitch text,
  website_content_snapshot text, -- To store what we scraped (optional, but good for debug)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, company_id) -- One strategy per user per company
);

alter table public.user_company_strategies enable row level security;

create policy "Users can manage their own strategies"
  on public.user_company_strategies
  for all
  using (auth.uid() = user_id);
