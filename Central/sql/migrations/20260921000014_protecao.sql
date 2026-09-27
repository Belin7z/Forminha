-- ==========================================================
-- 14) PROTEÇÃO CONTRA FLOOD E ABUSO
--     Limite de chamadas por pessoa (logada) ou por IP, recusa de
--     pedidos gigantes, teto de pedidos em aberto por cliente e
--     índices para o banco aguentar mais carga.
--
--     Observação: uma chamada que termina em erro desfaz tudo o que
--     fez, inclusive a contagem. Por isso o limite pega quem repete
--     chamadas que dão certo (o caro); erros de validação são baratos.
-- ==========================================================

/* ---------- Quem está chamando ---------- */
-- Logado: o id da conta. Visitante: o IP que a Cloudflare do Supabase informa (cf-connecting-ip);
-- sem ele, o ÚLTIMO endereço de x-forwarded-for (o primeiro pode ser inventado pelo visitante).
create function public._quem() returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); h jsonb; ip text;
begin
  if uid is not null then return 'u:' || uid::text; end if;
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  ip := nullif(btrim(coalesce(h ->> 'cf-connecting-ip', '')), '');
  if ip is null then ip := nullif(btrim(regexp_replace(coalesce(h ->> 'x-forwarded-for', ''), '^.*,', '')), ''); end if;
  if ip is null then ip := nullif(btrim(coalesce(h ->> 'x-real-ip', '')), ''); end if;
  return 'ip:' || left(coalesce(ip, 'desconhecido'), 64);
end $$;

/* ---------- Contador por janela fixa ---------- */
create unlogged table public.limites (
  chave  text primary key,
  n      int not null default 0,
  expira timestamptz not null
);
alter table public.limites enable row level security;
revoke all on public.limites from anon, authenticated;

create function public._limitar(acao text, maximo int, janela_s int) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k text; atual int; agora timestamptz := now();
begin
  k := acao || '|' || public._quem() || '|' || floor(extract(epoch from agora) / janela_s)::bigint;
  insert into public.limites as l (chave, n, expira) values (k, 1, agora + make_interval(secs => janela_s * 2))
  on conflict (chave) do update set n = l.n + 1
  returning l.n into atual;
  if atual > maximo then
    perform public._falha(429, 'Muitas solicitações em pouco tempo. Aguarde um instante e tente de novo.');
  end if;
  -- limpeza ocasional das janelas vencidas (poucas linhas por vez, para não pesar)
  if random() < 0.01 then
    delete from public.limites where chave in (select chave from public.limites where expira < agora limit 500);
  end if;
end $$;

/* ---------- Pedidos do cliente: só os 100 mais recentes ---------- */
create or replace function public.cliente_pedidos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  return jsonb_build_object('pedidos', coalesce((select jsonb_agg(public._pedido_linha(x) order by x.id desc)
                                                  from (select * from public.pedidos where usuario_id = u.id order by id desc limit 100) x), '[]'::jsonb));
end $$;

/* ---------- Embrulha as funções da API com limite e teto de tamanho ---------- */
-- Cada função vira uma "porta" que confere o limite e o tamanho do pedido e só então chama a original,
-- renomeada para _base_<nome> (sem permissão para ninguém de fora).
do $outer$
declare
  regra record; f record; base text; chamada text; papeis text;
begin
  for regra in select * from (values
    -- vitrine pública: por IP
    ('loja_config', 300, 60), ('loja_catalogo', 300, 60), ('loja_avaliacoes', 300, 60), ('loja_agenda', 300, 60),
    -- conta e leituras do cliente
    ('perfil_atual', 120, 60), ('cliente_enderecos', 120, 60), ('cliente_pedidos', 120, 60), ('cliente_pedido', 120, 60),
    -- ações do cliente
    ('cliente_orcar_pedido', 30, 60), ('cliente_atualizar_perfil', 20, 60), ('cliente_salvar_endereco', 30, 60),
    ('cliente_excluir_endereco', 30, 60), ('cliente_favorito', 60, 60), ('cliente_cancelar_pedido', 20, 60),
    ('cliente_avaliar_pedido', 10, 60), ('cliente_exportar_dados', 5, 3600), ('cliente_excluir_conta', 5, 3600),
    -- equipe: exportações e lançamentos
    ('admin_exportar_pedidos', 10, 60), ('admin_exportar_clientes', 10, 60), ('admin_auditoria', 30, 60),
    ('admin_criar_pedido', 60, 60), ('admin_registrar_pagamento', 120, 60)
  ) as t(nome, maximo, janela) loop
    select p.oid, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident,
           pg_get_function_result(p.oid) as res, p.pronargs,
           has_function_privilege('anon', p.oid, 'execute') as anon
      into f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = regra.nome;
    if f.oid is null then raise exception 'função % não encontrada', regra.nome; end if;
    if f.res <> 'jsonb' or f.pronargs <> 1 then raise exception 'função % fora do padrão (p jsonb -> jsonb)', regra.nome; end if;

    base := '_base_' || regra.nome;
    papeis := case when f.anon then 'anon, authenticated' else 'authenticated' end;
    execute format('alter function public.%I(%s) rename to %I', regra.nome, f.ident, base);
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', base, f.ident);
    execute format($fn$
      create function public.%I(%s) returns jsonb
      language plpgsql volatile security definer set search_path = public, pg_temp as $body$
      begin
        if pg_column_size(p) > 262144 then perform public._falha(413, 'Os dados enviados são grandes demais.'); end if;
        perform public._limitar(%L, %s, %s);
        return public.%I(p);
      end $body$
    $fn$, regra.nome, f.args, regra.nome, regra.maximo, regra.janela, base);
    execute format('grant execute on function public.%I(%s) to %s', regra.nome, f.ident, papeis);
  end loop;
end $outer$;

/* ---------- Criar pedido: limite por minuto e teto de pedidos em aberto ---------- */
alter function public.cliente_criar_pedido(jsonb) rename to _base_cliente_criar_pedido;
revoke execute on function public._base_cliente_criar_pedido(jsonb) from public, anon, authenticated;

create function public.cliente_criar_pedido(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if pg_column_size(p) > 262144 then perform public._falha(413, 'Os dados enviados são grandes demais.'); end if;
  perform public._limitar('cliente_criar_pedido', 12, 60);
  -- um cliente não precisa de dezenas de pedidos abertos ao mesmo tempo (evita encher a agenda de propósito)
  if (select count(*) from public.pedidos where usuario_id = auth.uid() and status not in ('entregue', 'cancelado')) >= 15 then
    perform public._falha(409, 'Você já tem muitos pedidos em andamento. Aguarde a entrega de alguns ou fale com a loja pelo WhatsApp.');
  end if;
  return public._base_cliente_criar_pedido(p);
end $$;
grant execute on function public.cliente_criar_pedido(jsonb) to authenticated;

/* ---------- Desempenho: consultas de agenda, produção e limites por produto ---------- */
create index if not exists pedidos_data_idx on public.pedidos (data_agendada);
create index if not exists pedido_itens_produto_idx on public.pedido_itens (produto_id);
create index if not exists pedidos_usuario_status_idx on public.pedidos (usuario_id, status);

/* ---------- Tempo máximo de uma consulta (visitante e logado) ---------- */
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
