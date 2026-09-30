-- ==========================================================
-- 24) MULTILOJA — várias lojas no mesmo banco.
--
-- Cada tabela ganha `loja_id`. As funções da API passam a rodar com o
-- papel `forminha_app`, que NÃO enxerga linhas de outra loja (política
-- de RLS em todas as tabelas): mesmo um descuido numa função não mostra
-- nem altera dados de outra loja. As ligações entre tabelas passam a
-- incluir a loja (um produto não aponta para a categoria de outra loja).
--
-- A loja da vez vem, nesta ordem:
--   1. forminha.loja — a Central, ao preparar ou cuidar de uma loja;
--   2. o cabeçalho x-loja — o site manda o código da loja ou o endereço;
--   3. a única loja do banco — bancos de uma loja só (como os antigos).
-- Um banco de uma loja só continua funcionando sem mudar nada no site.
--
-- REGRAS PARA AS PRÓXIMAS MIGRAÇÕES (os testes conferem):
--   • tabela nova: coluna loja_id (default public._loja_atual()), a
--     política "so_da_loja" e chaves únicas com loja_id;
--   • função nova com "security definer": alter function … owner to forminha_app (entre
--     "grant create on schema public to forminha_app" e o "revoke" do mesmo);
--   • dentro das funções: public._uid() no lugar de auth.uid(), e
--     "on conflict (loja_id, chave)" nas tabelas da loja.
-- ==========================================================

/* ---------- 1. As lojas ---------- */
create table public.lojas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique check (codigo ~ '^[A-Za-z0-9-]{3,40}$'),
  nome           text not null default '',
  prefixo_pedido text not null default 'P' check (prefixo_pedido ~ '^[A-Z]{1,4}$'),
  ultimo_pedido  bigint not null default 1000,
  criada_em      timestamptz not null default now()
);
-- os endereços de cada loja (loja e painel): o site manda o endereço no cabeçalho x-loja
create table public.loja_enderecos (
  host    text primary key check (host ~ '^[a-z0-9.-]+$'),
  loja_id uuid not null references public.lojas (id) on delete cascade
);
create index loja_enderecos_loja_idx on public.loja_enderecos (loja_id);
alter table public.lojas enable row level security;
alter table public.loja_enderecos enable row level security;
revoke all on public.lojas, public.loja_enderecos from anon, authenticated;

-- a loja que já mora neste banco: os códigos dos pedidos continuam de onde estavam (LA1001, LA1002…)
insert into public.lojas (codigo, nome, prefixo_pedido, ultimo_pedido)
values ('principal', coalesce((select valor ->> 'nome' from public.configuracoes where chave = 'loja'), ''), 'LA',
        greatest(1000, coalesce((select max(id) from public.pedidos), 1000)));

/* ---------- 2. Qual é a loja da vez ---------- */
/** A loja pelo código (x6u-BC4-4Bz) ou pelo endereço (anadoces.forminha.com.br). Vazio = a única loja do banco. */
create function public._loja_de(ref text) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r text := btrim(coalesce(ref, '')); l uuid;
begin
  if r = '' then
    if (select count(*) from (select 1 from public.lojas limit 2) x) = 1 then select id into l from public.lojas; end if;
    return l;
  end if;
  select id into l from public.lojas where codigo = r;
  if l is null then select loja_id into l from public.loja_enderecos where host = lower(split_part(r, ':', 1)); end if;
  return l;
end $$;

create function public._loja() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text := nullif(current_setting('forminha.loja', true), ''); h jsonb;
begin
  if v is not null then return v::uuid; end if;
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  return public._loja_de(h ->> 'x-loja');
end $$;

/** A loja da vez, ou 404 com texto claro (é o valor padrão de loja_id em todas as tabelas). */
create function public._loja_atual() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l uuid := public._loja();
begin
  if l is null then perform public._falha(404, 'Loja não encontrada. Confira o endereço.'); end if;
  return l;
end $$;

/** Quem está chamando (o mesmo que auth.uid(), sem depender das permissões do esquema auth). */
create function public._uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;

/** Código do pedido: numeração própria de cada loja (LA1001, AD1001…). */
create function public._codigo_pedido() returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare l public.lojas;
begin
  update public.lojas set ultimo_pedido = ultimo_pedido + 1 where id = public._loja_atual() returning * into l;
  return l.prefixo_pedido || l.ultimo_pedido;
end $$;

/* ---------- 3. O papel das funções ---------- */
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'forminha_app') then
    create role forminha_app nologin noinherit;
  end if;
end $$;
grant forminha_app to current_user; -- para poder passar as funções para ele

/* ---------- 4. loja_id em todas as tabelas ---------- */
do $$
declare
  t text; principal uuid := (select id from public.lojas where codigo = 'principal');
  tabelas text[] := array['perfis', 'enderecos', 'categorias', 'produtos', 'favoritos', 'cupons', 'zonas_entrega', 'pedidos',
    'pedido_itens', 'pedido_historico', 'avaliacoes', 'configuracoes', 'datas_bloqueadas', 'pagamentos_pedido', 'auditoria',
    'limites', 'avisos_log', 'ingredientes', 'receitas', 'ficha_itens', 'estoque_movimentos', 'estoque_baixas', 'estoque_config',
    'preparos', 'preparo_itens', 'estoque_lotes', 'ingrediente_precos', 'estoque_avisos', 'convites'];
  fk record; pai_unico text;
begin
  -- toda tabela da loja precisa estar na lista (tabela nova sem loja_id = erro aqui, não vazamento depois)
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename <> all (tabelas || array['lojas', 'loja_enderecos'])) then
    raise exception 'Tabela sem loja: %', (select string_agg(tablename, ', ') from pg_tables
      where schemaname = 'public' and tablename <> all (tabelas || array['lojas', 'loja_enderecos']));
  end if;

  foreach t in array tabelas loop
    execute format('alter table public.%I add column loja_id uuid', t);
    execute format('update public.%I set loja_id = %L', t, principal);
    execute format('alter table public.%I alter column loja_id set default public._loja_atual(), alter column loja_id set not null', t);
    execute format('alter table public.%I add constraint %I foreign key (loja_id) references public.lojas (id) on delete cascade', t, t || '_loja_fkey');
    execute format('create index %I on public.%I (loja_id)', t || '_loja_idx', t);
  end loop;

  -- guarda as ligações entre tabelas da loja e tira (voltam logo abaixo, com a loja junto)
  create temp table _ligacoes on commit drop as
    select c.conname, filha.relname::text as filha, pai.relname::text as pai, c.confdeltype as ao_apagar,
           (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as colunas,
           (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) as colunas_pai
      from pg_constraint c
      join pg_class filha on filha.oid = c.conrelid
      join pg_class pai on pai.oid = c.confrelid
     where c.contype = 'f' and filha.relnamespace = 'public'::regnamespace and pai.relnamespace = 'public'::regnamespace
       and pai.relname::text = any (tabelas);
  for fk in select * from _ligacoes loop
    execute format('alter table public.%I drop constraint %I', fk.filha, fk.conname);
  end loop;

  -- chaves que eram únicas no banco inteiro passam a ser únicas em cada loja
  alter table public.perfis drop constraint perfis_pkey;
  alter table public.perfis add primary key (loja_id, id);
  drop index public.perfis_email_idx;
  create unique index perfis_email_idx on public.perfis (loja_id, lower(email));
  alter table public.configuracoes drop constraint configuracoes_pkey;
  alter table public.configuracoes add primary key (loja_id, chave);
  alter table public.datas_bloqueadas drop constraint datas_bloqueadas_pkey;
  alter table public.datas_bloqueadas add primary key (loja_id, data);
  alter table public.limites drop constraint limites_pkey;
  alter table public.limites add primary key (loja_id, chave);
  alter table public.estoque_config drop constraint estoque_config_pkey;
  alter table public.estoque_config add primary key (loja_id);
  alter table public.pedidos drop constraint pedidos_codigo_key;
  alter table public.pedidos add constraint pedidos_codigo_key unique (loja_id, codigo);
  drop index public.cupons_codigo_idx;
  create unique index cupons_codigo_idx on public.cupons (loja_id, upper(codigo));
  drop index public.ingredientes_nome_idx;
  create unique index ingredientes_nome_idx on public.ingredientes (loja_id, lower(nome));
  drop index public.preparos_nome_idx;
  create unique index preparos_nome_idx on public.preparos (loja_id, lower(nome));
  drop index public.pagamentos_id_externo_idx;
  create unique index pagamentos_id_externo_idx on public.pagamentos_pedido (loja_id, id_externo) where id_externo is not null;

  -- as ligações de volta, agora (loja_id, coluna) -> (loja_id, coluna)
  for fk in select * from _ligacoes loop
    pai_unico := fk.pai || '_loja_' || array_to_string(fk.colunas_pai, '_') || '_key';
    if not exists (select 1 from pg_constraint k where k.conrelid = format('public.%I', fk.pai)::regclass and k.contype in ('p', 'u')
                   and (select array_agg(a.attname::text order by a.attname::text) from unnest(k.conkey) n join pg_attribute a on a.attrelid = k.conrelid and a.attnum = n)
                     = (select array_agg(x order by x) from unnest(array['loja_id'] || fk.colunas_pai) x)) then
      execute format('alter table public.%I add constraint %I unique (loja_id, %s)', fk.pai, pai_unico,
        (select string_agg(quote_ident(x), ', ') from unnest(fk.colunas_pai) x));
    end if;
    execute format('alter table public.%I add constraint %I foreign key (loja_id, %s) references public.%I (loja_id, %s) on delete %s',
      fk.filha, fk.conname,
      (select string_agg(quote_ident(x), ', ') from unnest(fk.colunas) x), fk.pai,
      (select string_agg(quote_ident(x), ', ') from unnest(fk.colunas_pai) x),
      case fk.ao_apagar
        when 'c' then 'cascade'
        when 'r' then 'restrict'
        when 'n' then format('set null (%s)', (select string_agg(quote_ident(x), ', ') from unnest(fk.colunas) x))
        when 'd' then format('set default (%s)', (select string_agg(quote_ident(x), ', ') from unnest(fk.colunas) x))
        else 'no action' end);
  end loop;

  -- cada tabela: o papel das funções só vê (e só grava) linhas da loja da vez
  foreach t in array tabelas loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy so_da_loja on public.%I for all to forminha_app using (loja_id = (select public._loja())) with check (loja_id = (select public._loja()))', t);
  end loop;
end $$;

/* ---------- 5. Permissões do papel das funções ---------- */
grant usage on schema public to forminha_app;
grant select, insert, update, delete on all tables in schema public to forminha_app;
revoke all on public.lojas, public.loja_enderecos from forminha_app;
grant usage, select on all sequences in schema public to forminha_app;
grant execute on all functions in schema public to forminha_app;
alter default privileges in schema public grant select, insert, update, delete on tables to forminha_app;
alter default privileges in schema public grant usage, select on sequences to forminha_app;
alter default privileges in schema public grant execute on functions to forminha_app;

/* ---------- 6. As funções entendem a loja ---------- */
-- Troca, em todas as funções da API: auth.uid() por public._uid(); "on conflict (chave)" e "(data)" pela chave da loja;
-- o código do pedido pela numeração da loja; e a trava de agenda passa a ser por loja.
do $$
declare f record; novo text;
begin
  for f in
    select p.oid, pg_get_functiondef(p.oid) as def from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and p.proname not in ('_uid', '_loja', '_loja_de', '_loja_atual', '_codigo_pedido')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    novo := f.def;
    novo := replace(novo, 'auth.uid()', 'public._uid()');
    novo := replace(novo, 'on conflict (chave)', 'on conflict (loja_id, chave)');
    novo := replace(novo, 'on conflict (data)', 'on conflict (loja_id, data)');
    novo := replace(novo, '''LA'' || pid', 'public._codigo_pedido()');
    novo := replace(novo, 'hashtext(''agenda:'' || ', 'hashtext(''agenda:'' || public._loja()::text || '':'' || ');
    if novo <> f.def then execute novo; end if;
  end loop;
end $$;

-- Conta que já existe (criada em outra loja) entrando nesta: o perfil nasce na hora, como cliente.
create function public._garantir_perfil() returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c jsonb; e text;
begin
  if public._uid() is null or exists (select 1 from public.perfis where id = public._uid()) then return; end if;
  begin c := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then c := null; end;
  e := lower(btrim(coalesce(c ->> 'email', '')));
  if e = '' then return; end if;
  insert into public.perfis (id, nome, email, telefone)
  values (public._uid(), left(coalesce(nullif(btrim(coalesce(c #>> '{user_metadata,nome}', '')), ''), split_part(e, '@', 1)), 80), e,
          nullif(left(regexp_replace(coalesce(c #>> '{user_metadata,telefone}', ''), '\D', '', 'g'), 11), ''))
  on conflict do nothing;
end $$;

create or replace function public._base_perfil_atual(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis;
begin
  if public._uid() is null then return null; end if;
  perform public._garantir_perfil();
  select * into u from public.perfis where id = public._uid();
  if not found then return null; end if;
  update public.perfis set ultimo_acesso = now()
   where id = u.id and (ultimo_acesso is null or ultimo_acesso < now() - interval '10 minutes');
  return public._perfil_json(u);
end $$;

create or replace function public.convite_aceitar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.convites; u public.perfis;
begin
  if pg_column_size(p) > 4096 then perform public._falha(413, 'Os dados enviados são grandes demais.'); end if;
  perform public._limitar('convite', 20, 600);
  if public._uid() is null then perform public._falha(401, 'Crie sua conta ou entre para aceitar o convite.'); end if;
  c := public._convite_valido(p ->> 'codigo', true);
  perform public._garantir_perfil();
  select * into u from public.perfis where id = public._uid();
  if not found then perform public._falha(401, 'Crie sua conta ou entre para aceitar o convite.'); end if;
  if c.email is not null and lower(u.email) <> c.email then
    perform public._falha(403, 'Este convite foi feito para outro e-mail (' || c.email || '). Entre com esse e-mail.');
  end if;
  update public.perfis set papel = c.papel, ativo = true where id = u.id;
  update public.convites set usado_em = now(), usado_por = u.id where id = c.id;
  return jsonb_build_object('papel', c.papel);
end $$;

-- Conta nova no Auth: o perfil nasce na loja onde a pessoa se cadastrou (o site manda a loja nos dados do cadastro).
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare l uuid := public._loja_de(new.raw_user_meta_data ->> 'loja');
begin
  if l is null then return new; end if; -- sem loja: o perfil nasce no primeiro acesso a uma loja
  insert into public.perfis (loja_id, id, nome, email, telefone, aceite_termos_em)
  values (
    l, new.id,
    left(coalesce(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nome', '')), ''), split_part(coalesce(new.email, ''), '@', 1)), 80),
    coalesce(new.email, ''),
    nullif(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefone', ''), '\D', '', 'g'), 11), ''),
    case when new.raw_user_meta_data ->> 'aceite' = 'true' then now() end
  )
  on conflict do nothing;
  return new;
end $$;

-- Apagar a conta numa loja apaga o perfil DESSA loja; a conta de login só some quando não sobra loja nenhuma.
create function public._apagar_login_sem_lojas(uid uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.perfis where id = uid) then delete from auth.users where id = uid; end if;
end $$;

create or replace function public._base_cliente_excluir_conta(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  if exists (select 1 from public.pedidos where usuario_id = u.id and status not in ('entregue', 'cancelado')) then
    perform public._falha(409, 'Você tem pedidos em andamento. Depois que forem entregues (ou cancelados), poderá excluir a conta.');
  end if;
  update public.pedidos set usuario_id = null, cliente_nome = 'Cliente removido', cliente_telefone = null, endereco = null,
         lat = null, lng = null, observacoes = null where usuario_id = u.id;
  update public.pedido_historico set usuario_id = null where usuario_id = u.id;
  delete from public.perfis where id = u.id; -- leva junto os endereços, os favoritos e as avaliações desta loja
  perform public._apagar_login_sem_lojas(u.id);
  return jsonb_build_object('ok', true);
end $$;

/* ---------- 7. Fotos e imagens: cada loja na sua pasta (<loja_id>/arquivo) ---------- */
/** Quem envia é administradora da loja dona da pasta? (Arquivo solto, sem pasta = a única loja do banco.) */
create function public.e_admin_do_arquivo(nome text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare pasta text := case when position('/' in coalesce(nome, '')) > 0 then split_part(nome, '/', 1) end; l uuid;
begin
  if pasta is null then l := public._loja_de(null);
  elsif pasta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then l := pasta::uuid;
  end if;
  return l is not null and exists (select 1 from public.perfis where loja_id = l and id = public._uid() and papel = 'admin' and ativo);
end $$;
grant execute on function public.e_admin_do_arquivo(text) to authenticated;

drop policy if exists "admin envia fotos de produtos" on storage.objects;
drop policy if exists "admin troca fotos de produtos" on storage.objects;
drop policy if exists "admin apaga fotos de produtos" on storage.objects;
drop policy if exists "admin envia imagens do site" on storage.objects;
drop policy if exists "admin troca imagens do site" on storage.objects;
drop policy if exists "admin apaga imagens do site" on storage.objects;
create policy "admin envia fotos de produtos" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and public.e_admin_do_arquivo(name));
create policy "admin troca fotos de produtos" on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and public.e_admin_do_arquivo(name)) with check (bucket_id = 'produtos' and public.e_admin_do_arquivo(name));
create policy "admin apaga fotos de produtos" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and public.e_admin_do_arquivo(name));
create policy "admin envia imagens do site" on storage.objects for insert to authenticated
  with check (bucket_id = 'site' and public.e_admin_do_arquivo(name));
create policy "admin troca imagens do site" on storage.objects for update to authenticated
  using (bucket_id = 'site' and public.e_admin_do_arquivo(name)) with check (bucket_id = 'site' and public.e_admin_do_arquivo(name));
create policy "admin apaga imagens do site" on storage.objects for delete to authenticated
  using (bucket_id = 'site' and public.e_admin_do_arquivo(name));

/* ---------- 8. Donas das funções ---------- */
-- Toda função "security definer" da API passa para forminha_app (sujeito às políticas da loja).
-- Ficam com o dono do banco só as que precisam ver além de uma loja: achar a loja, numerar pedidos,
-- criar o perfil no cadastro, apagar o login e conferir a pasta das imagens.
-- (O Postgres só passa uma função para um papel que pode criar no esquema: a permissão vale só aqui e sai logo depois.)
grant create on schema public to forminha_app;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and p.proname not in ('_loja', '_loja_de', '_loja_atual', '_codigo_pedido', 'novo_usuario', '_apagar_login_sem_lojas', 'e_admin_do_arquivo')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s owner to forminha_app', f.assinatura);
  end loop;
end $$;
revoke create on schema public from forminha_app;
revoke execute on function public._loja(), public._loja_de(text), public._loja_atual(), public._codigo_pedido(),
  public._apagar_login_sem_lojas(uuid), public._garantir_perfil() from public, anon, authenticated;
grant execute on function public._loja(), public._loja_de(text), public._loja_atual(), public._codigo_pedido(),
  public._apagar_login_sem_lojas(uuid), public._garantir_perfil(), public._uid() to forminha_app;
