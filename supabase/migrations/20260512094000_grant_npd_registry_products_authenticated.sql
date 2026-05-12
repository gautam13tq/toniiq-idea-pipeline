revoke all on table public.npd_registry_products from anon;
revoke all on table public.npd_registry_products from authenticated;

grant select, insert, update on table public.npd_registry_products to authenticated;
