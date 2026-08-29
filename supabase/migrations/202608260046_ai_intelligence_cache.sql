-- Trace Intelligence cache: viewer-scoped, permission-safe AI results.
create extension if not exists pgcrypto;

create table if not exists public.ai_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  feature text not null check (feature in ('TRIAGE', 'SEARCH', 'RELEASE')),
  issue_id uuid references public.issues (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete cascade,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  model text not null,
  result jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  expires_at timestamptz,
  unique (viewer_id, feature, project_id, input_hash)
);

create index if not exists ai_analysis_cache_viewer_feature_project_idx
  on public.ai_analysis_cache (viewer_id, feature, project_id);
create index if not exists ai_analysis_cache_issue_idx
  on public.ai_analysis_cache (issue_id);
create index if not exists ai_analysis_cache_milestone_idx
  on public.ai_analysis_cache (milestone_id);

alter table public.ai_analysis_cache enable row level security;

drop policy if exists "Users can read own AI cache" on public.ai_analysis_cache;
create policy "Users can read own AI cache"
  on public.ai_analysis_cache for select to authenticated
  using (viewer_id = auth.uid());

drop policy if exists "Users can insert own AI cache" on public.ai_analysis_cache;
create policy "Users can insert own AI cache"
  on public.ai_analysis_cache for insert to authenticated
  with check (viewer_id = auth.uid());

drop policy if exists "Users can update own AI cache" on public.ai_analysis_cache;
create policy "Users can update own AI cache"
  on public.ai_analysis_cache for update to authenticated
  using (viewer_id = auth.uid())
  with check (viewer_id = auth.uid());

drop policy if exists "Users can delete own AI cache" on public.ai_analysis_cache;
create policy "Users can delete own AI cache"
  on public.ai_analysis_cache for delete to authenticated
  using (viewer_id = auth.uid());

revoke delete on public.ai_analysis_cache from anon, public;
