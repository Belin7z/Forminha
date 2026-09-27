-- ==========================================================
-- 5) PAINEL — pedidos e visão geral
-- Todas as funções começam com public._admin(): só administrador ativo passa.
-- ==========================================================

create function public.admin_pedidos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  st text := coalesce(p ->> 'status', 'ativos');
  busca text := btrim(coalesce(p ->> 'busca', ''));
  dt date := case when (p ->> 'data') ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'data')::date end;
  lim int := 30; pag int := greatest(1, coalesce(nullif(p ->> 'pagina', '')::int, 1));
  ativos text[] := array['novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega'];
  total int; itens jsonb;
begin
  if st not in ('ativos', 'todos', 'novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega', 'entregue', 'cancelado') then st := 'ativos'; end if;

  select count(*) into total from public.pedidos x
   where (st = 'todos' or (st = 'ativos' and x.status = any (ativos)) or x.status = st)
     and (busca = '' or x.codigo ilike '%' || busca || '%' or x.cliente_nome ilike '%' || busca || '%' or x.cliente_telefone ilike '%' || busca || '%')
     and (dt is null or x.data_agendada = dt);

  select coalesce(jsonb_agg(public._pedido_linha(y) order by y.data_agendada, y.hora_agendada, y.id desc), '[]'::jsonb) into itens
    from (select x.* from public.pedidos x
           where (st = 'todos' or (st = 'ativos' and x.status = any (ativos)) or x.status = st)
             and (busca = '' or x.codigo ilike '%' || busca || '%' or x.cliente_nome ilike '%' || busca || '%' or x.cliente_telefone ilike '%' || busca || '%')
             and (dt is null or x.data_agendada = dt)
           order by x.data_agendada, x.hora_agendada, x.id desc
           limit lim offset (pag - 1) * lim) y;

  return jsonb_build_object('itens', itens, 'total', total, 'pagina', pag, 'paginas', greatest(1, ceil(total / lim::numeric)::int));
end $$;

create function public.admin_pedidos_contagem(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); r jsonb;
begin
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into r from (select status, count(*) as n from public.pedidos group by status) t;
  return r || jsonb_build_object('ativos', (select count(*) from public.pedidos where status in ('novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega')));
end $$;

/** Pedidos criados depois de `desde` — o painel consulta isso a cada poucos segundos. */
create function public.admin_pedidos_novos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); desde bigint := coalesce(nullif(p ->> 'desde', '')::bigint, 0);
begin
  return jsonb_build_object(
    'ultimo_id', coalesce((select max(id) from public.pedidos), 0),
    'novos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'codigo', x.codigo, 'cliente', x.cliente_nome, 'total', x.total, 'tipo', x.tipo) order by x.id)
                         from (select * from public.pedidos where id > desde order by id limit 20) x), '[]'::jsonb));
end $$;

create function public.admin_pedido(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return jsonb_build_object('pedido', public._pedido_completo((p ->> 'id')::bigint));
end $$;

create function public.admin_mudar_status(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pid bigint := (p ->> 'id')::bigint; novo text;
begin
  novo := public._v_opcao(p, 'status', array['novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega', 'entregue', 'cancelado'], 'Status');
  perform public._mudar_status(pid, novo, p ->> 'nota', adm.id);
  return jsonb_build_object('pedido', public._pedido_completo(pid));
end $$;

-- ==========================================================
-- VISÃO GERAL
-- ==========================================================
create function public.admin_resumo(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  tz text := 'America/Sao_Paulo';
  dias int := least(greatest(coalesce(nullif(p ->> 'dias', '')::int, 14), 7), 90);
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini date; k jsonb; ativos text[] := array['novo', 'confirmado', 'em_preparo', 'pronto', 'saiu_entrega'];
  h_n bigint; h_t bigint; m_n bigint; m_t bigint;
begin
  ini := hoje - (dias - 1);
  select count(*), coalesce(sum(total), 0) into h_n, h_t from public.pedidos
   where status <> 'cancelado' and (criado_em at time zone tz)::date = hoje;
  select count(*), coalesce(sum(total), 0) into m_n, m_t from public.pedidos
   where status <> 'cancelado' and date_trunc('month', criado_em at time zone tz) = date_trunc('month', hoje::timestamp);

  k := jsonb_build_object(
    'pedidos_hoje', h_n, 'faturamento_hoje', h_t, 'pedidos_mes', m_n, 'faturamento_mes', m_t,
    'ticket_medio_mes', case when m_n > 0 then round(m_t::numeric / m_n) else 0 end,
    'novos_pedidos', (select count(*) from public.pedidos where status = 'novo'),
    'em_andamento', (select count(*) from public.pedidos where status = any (ativos)),
    'entregas_hoje', (select count(*) from public.pedidos where data_agendada = hoje and status = any (ativos)),
    'clientes', (select count(*) from public.perfis where papel = 'cliente'),
    'clientes_novos_mes', (select count(*) from public.perfis where papel = 'cliente'
                            and date_trunc('month', criado_em at time zone tz) = date_trunc('month', hoje::timestamp)),
    'avaliacoes_pendentes', (select count(*) from public.avaliacoes where not aprovada));

  return jsonb_build_object(
    'kpis', k,
    'serie', (select jsonb_agg(jsonb_build_object('dia', to_char(d, 'YYYY-MM-DD'), 'pedidos', coalesce(v.n, 0), 'total', coalesce(v.t, 0)) order by d)
                from generate_series(ini, hoje, interval '1 day') g(d)
                left join (select (criado_em at time zone tz)::date as dia, count(*) as n, sum(total) as t from public.pedidos
                            where status <> 'cancelado' and (criado_em at time zone tz)::date >= ini group by 1) v on v.dia = g.d::date),
    'status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'n', n)) from
                (select status, count(*) as n from public.pedidos where (criado_em at time zone tz)::date >= ini group by status) t), '[]'::jsonb),
    'top_produtos', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd, 'receita', receita) order by qtd desc) from
                (select i.nome, sum(i.qtd) as qtd, sum(i.total) as receita from public.pedido_itens i join public.pedidos o on o.id = i.pedido_id
                  where o.status <> 'cancelado' and (o.criado_em at time zone tz)::date >= ini group by i.nome order by 2 desc limit 6) t), '[]'::jsonb),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('pagamento', pagamento, 'n', n, 'total', total) order by n desc) from
                (select pagamento, count(*) as n, sum(total) as total from public.pedidos
                  where status <> 'cancelado' and (criado_em at time zone tz)::date >= ini group by pagamento) t), '[]'::jsonb),
    'favoritos_top', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'emoji', emoji, 'n', n) order by n desc) from
                (select pr.id, pr.nome, pr.emoji, count(*) as n from public.favoritos f join public.produtos pr on pr.id = f.produto_id
                  group by pr.id order by 4 desc limit 5) t), '[]'::jsonb),
    'ultimos', coalesce((select jsonb_agg(public._pedido_linha(x) order by x.id desc) from
                (select * from public.pedidos order by id desc limit 8) x), '[]'::jsonb),
    'dias', dias);
end $$;

