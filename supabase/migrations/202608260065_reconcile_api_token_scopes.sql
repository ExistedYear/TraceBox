-- Forward-only repair for hosted schema drift: the migration ledger contains
-- the 11-scope contract from 040, but the live constraint was later observed
-- at the older eight-scope definition. Never rewrite or replay 040.

alter table public.api_tokens drop constraint if exists api_tokens_scopes_check;
alter table public.api_tokens add constraint api_tokens_scopes_check check (
  cardinality(scopes) between 1 and 11
  and scopes <@ array[
    'read', 'write', 'projects:read', 'issues:read', 'issues:write',
    'comments:write', 'milestones:read', 'search:read',
    'integrations:read', 'github_links:read', 'github_links:write'
  ]::text[]
);

comment on constraint api_tokens_scopes_check on public.api_tokens is
  'Canonical public API scopes; reconciled forward after hosted constraint drift.';
