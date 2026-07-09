-- Mavya — initial schema for auth + multi-product dashboard.
-- Apply in the Supabase SQL editor (or `supabase db push`). Idempotent-ish:
-- safe to read top to bottom once on a fresh project.
--
-- Model: one product == one Etsy listing. Each product has one main photo and
-- N supporting photos; each photo has audits (latest = current). Free-tier quota
-- counters live on profiles and are enforced server-side in the API routes.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Created automatically by the trigger below.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique,
  plan          text not null default 'free',      -- 'free' | paid (later)
  ratings_used  integer not null default 0,        -- free cap: 3
  improves_used integer not null default 0,        -- free cap: 1
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text,                                  -- null => UI shows "Product N"
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_user_id_idx on public.products(user_id);

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------
create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  role         text not null check (role in ('main','supporting')),
  storage_path text not null,
  mime         text,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists photos_product_id_idx on public.photos(product_id);

-- ---------------------------------------------------------------------------
-- audits (latest row per photo = current audit)
-- ---------------------------------------------------------------------------
create table if not exists public.audits (
  id            uuid primary key default gen_random_uuid(),
  photo_id      uuid not null references public.photos(id) on delete cascade,
  kind          text not null check (kind in ('main','supporting')),
  rubric        jsonb not null,
  overall_score numeric,
  created_at    timestamptz not null default now()
);
create index if not exists audits_photo_id_idx on public.audits(photo_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.photos   enable row level security;
alter table public.audits   enable row level security;

-- profiles: a user sees and edits only their own row.
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- products: full CRUD scoped to the owner.
create policy "products_select_own" on public.products
  for select using (user_id = auth.uid());
create policy "products_insert_own" on public.products
  for insert with check (user_id = auth.uid());
create policy "products_update_own" on public.products
  for update using (user_id = auth.uid());
create policy "products_delete_own" on public.products
  for delete using (user_id = auth.uid());

-- photos: ownership via the parent product.
create policy "photos_select_own" on public.photos
  for select using (exists (
    select 1 from public.products p
    where p.id = photos.product_id and p.user_id = auth.uid()
  ));
create policy "photos_insert_own" on public.photos
  for insert with check (exists (
    select 1 from public.products p
    where p.id = photos.product_id and p.user_id = auth.uid()
  ));
create policy "photos_delete_own" on public.photos
  for delete using (exists (
    select 1 from public.products p
    where p.id = photos.product_id and p.user_id = auth.uid()
  ));

-- audits: ownership via photo -> product.
create policy "audits_select_own" on public.audits
  for select using (exists (
    select 1 from public.photos ph
    join public.products p on p.id = ph.product_id
    where ph.id = audits.photo_id and p.user_id = auth.uid()
  ));
create policy "audits_insert_own" on public.audits
  for insert with check (exists (
    select 1 from public.photos ph
    join public.products p on p.id = ph.product_id
    where ph.id = audits.photo_id and p.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up. Reads an optional
-- username from the signup metadata.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'username', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Storage: private bucket for product photos. Objects are namespaced by user id
-- as the first path segment: `${auth.uid()}/${product_id}/${photo_id}.ext`.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', false)
on conflict (id) do nothing;

create policy "product_photos_select_own" on storage.objects
  for select using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "product_photos_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "product_photos_delete_own" on storage.objects
  for delete using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
