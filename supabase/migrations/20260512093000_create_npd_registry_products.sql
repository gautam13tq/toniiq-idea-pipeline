create table if not exists public.npd_registry_products (
  id uuid primary key default gen_random_uuid(),
  product text not null unique,
  queue text not null check (queue in (
    'Active Development',
    'Greenlight Bench',
    'Selective Hold',
    'Shelved / Parked',
    'Idea Backlog'
  )),
  state text not null default '',
  priority text not null default 'normal' check (priority in ('high', 'medium', 'normal', 'parked')),
  lv_score numeric,
  lv_score_note text,
  lv_band text,
  confidence text check (confidence in ('High', 'Med', 'Low')),
  last_updated date,
  today_action text,
  decision_needed text,
  blocker_risk text,
  reactivation_trigger text,
  local_folder_path text,
  concept_id uuid references public.product_concepts(id) on delete set null,
  registry_anchor text,
  detail_markdown text,
  sort_order integer not null default 999,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists npd_registry_products_queue_sort_idx
  on public.npd_registry_products (queue, sort_order, product);

create index if not exists npd_registry_products_concept_id_idx
  on public.npd_registry_products (concept_id);

create or replace function public.touch_npd_registry_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_npd_registry_products_updated_at on public.npd_registry_products;
create trigger touch_npd_registry_products_updated_at
before update on public.npd_registry_products
for each row
execute function public.touch_npd_registry_products_updated_at();

alter table public.npd_registry_products enable row level security;

drop policy if exists "Authenticated users can read NPD registry products"
  on public.npd_registry_products;
create policy "Authenticated users can read NPD registry products"
  on public.npd_registry_products
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert NPD registry products"
  on public.npd_registry_products;
create policy "Authenticated users can insert NPD registry products"
  on public.npd_registry_products
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update NPD registry products"
  on public.npd_registry_products;
create policy "Authenticated users can update NPD registry products"
  on public.npd_registry_products
  for update
  to authenticated
  using (true)
  with check (true);
