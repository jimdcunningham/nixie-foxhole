-- Minimal local schema for executing the moderation migration in PGlite/Postgres.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(),bucket_id text,name text,updated_at timestamptz default now(),metadata jsonb default '{}');
create table public.blueprints (
    id uuid primary key,version uuid,name text,description text,authors text,game text default 'foxhole',privacy text default 'public',
    approved boolean,deleted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()
);
create table public.bp_versions (id uuid primary key,blueprint_id uuid references public.blueprints(id),version text,changelog text,created_at timestamptz default now());
create table public.tags (id uuid primary key,name text,key text);
create table public.bp_tags (blueprint_id uuid references public.blueprints(id),tag_id uuid references public.tags(id));
create table public.bp_subscriptions (blueprint_id uuid);
create table public.nixie_registry_listings (id uuid,public_id text,title text,description text,updated_at timestamptz,publisher_user_id uuid,default_release_id uuid,type text,visibility text,status text);
create table public.nixie_registry_releases (id uuid,listing_id uuid,published_at timestamptz);
create table public.nixie_registry_subscriptions (listing_public_id text);
create table public.user_profiles (user_id uuid,username text);
grant select,insert,update on public.blueprints to authenticated;
