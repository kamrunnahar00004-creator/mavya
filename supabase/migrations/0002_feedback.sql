-- Feedback / contact / complaint submissions.
-- Run in the Supabase SQL editor after 0001_init.sql.

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  email      text,
  category   text not null default 'other'
             check (category in ('bug', 'complaint', 'feature', 'other')),
  message    text not null,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_at_idx on public.feedback(created_at desc);

alter table public.feedback enable row level security;

-- A signed-in user may submit feedback tied to their own account. There is no
-- select policy, so users cannot read submissions; the founder reads them in the
-- Supabase dashboard (Table Editor) or via the service role.
create policy "feedback_insert_own" on public.feedback
  for insert with check (user_id = auth.uid());
