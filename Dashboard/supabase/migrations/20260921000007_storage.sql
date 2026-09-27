-- ==========================================================
-- 7) STORAGE — fotos dos produtos
-- Bucket público para leitura (a loja mostra as fotos) e escrita
-- só por administradores. Tipo e tamanho são limitados no bucket.
-- ==========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 4194304, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "admin envia fotos de produtos" on storage.objects
  for insert to authenticated with check (bucket_id = 'produtos' and public.e_admin());

create policy "admin troca fotos de produtos" on storage.objects
  for update to authenticated using (bucket_id = 'produtos' and public.e_admin()) with check (bucket_id = 'produtos' and public.e_admin());

create policy "admin apaga fotos de produtos" on storage.objects
  for delete to authenticated using (bucket_id = 'produtos' and public.e_admin());
