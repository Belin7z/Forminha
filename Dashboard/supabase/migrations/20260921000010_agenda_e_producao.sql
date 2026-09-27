-- ==========================================================
-- 10) AGENDA E PRODUÇÃO
--     Datas bloqueadas (feriados, férias), limite de pedidos por
--     dia, calendário no Dashboard e a lista "o que produzir".
-- ==========================================================

/* ---------- Quem pode atender pedidos: administrador ou atendente ---------- */
create function public._staff() returns public.perfis
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis;
begin
  if auth.uid() is null then perform public._falha(401, 'Faça login para continuar.'); end if;
  select * into u from public.perfis where id = auth.uid();
  if not found or not u.ativo then perform public._falha(401, 'Faça login para continuar.'); end if;
  if u.papel not in ('admin', 'atendente') then perform public._falha(403, 'Este acesso é restrito à equipe.'); end if;
  return u;
end $$;

/* ---------- Datas bloqueadas ---------- */
create table public.datas_bloqueadas (
  data      date primary key,
  motivo    text not null default '',
  criado_em timestamptz not null default now()
);
alter table public.datas_bloqueadas enable row level security;
revoke all on public.datas_bloqueadas from anon, authenticated;

/* ---------- Configurações da agenda (uma seção própria: agenda) ---------- */
create function public.admin_salvar_agenda(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); novo jsonb;
begin
  novo := jsonb_build_object('max_pedidos_dia', public._v_int(p, 'max_pedidos_dia', 0, 500, 'Limite de pedidos por dia'));
  insert into public.configuracoes (chave, valor) values ('agenda', novo)
  on conflict (chave) do update set valor = excluded.valor;
  return jsonb_build_object('configuracoes', public._cfg());
end $$;

/* ---------- Loja: quais dias não recebem pedido (bloqueados ou com a agenda cheia) ---------- */
create function public.loja_agenda(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public._cfg(); hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  dias int := coalesce((cfg #>> '{pedidos,dias_maximos}')::int, 45);
  maximo int := coalesce((cfg #>> '{agenda,max_pedidos_dia}')::int, 0);
begin
  return jsonb_build_object('max_pedidos_dia', maximo, 'indisponiveis', coalesce((
    select jsonb_agg(jsonb_build_object('data', to_char(t.dia, 'YYYY-MM-DD'), 'motivo', t.motivo) order by t.dia)
      from (
        select b.data as dia, 'bloqueada' as motivo from public.datas_bloqueadas b where b.data between hoje and hoje + dias
        union all
        select o.data_agendada, 'lotada' from public.pedidos o
         where maximo > 0 and o.status <> 'cancelado' and o.data_agendada between hoje and hoje + dias
         group by o.data_agendada having count(*) >= maximo
      ) t), '[]'::jsonb));
end $$;

/* ---------- Dashboard: calendário do mês ---------- */
create function public.admin_agenda(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  staff public.perfis := public._staff();
  mes text := coalesce(nullif(p ->> 'mes', ''), to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'));
  ini date; fim date;
begin
  if mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then perform public._falha(422, 'Mês inválido.', 'mes'); end if;
  ini := (mes || '-01')::date;
  fim := (ini + interval '1 month - 1 day')::date;
  return jsonb_build_object('mes', mes, 'max_pedidos_dia', coalesce((public._cfg() #>> '{agenda,max_pedidos_dia}')::int, 0),
    'dias', (select jsonb_agg(jsonb_build_object('data', to_char(x.dia, 'YYYY-MM-DD'), 'pedidos', coalesce(o.n, 0),
                    'bloqueada', b.data is not null, 'motivo', coalesce(b.motivo, '')) order by x.dia)
               from generate_series(ini, fim, interval '1 day') as x(dia)
               left join (select data_agendada as dia, count(*) as n from public.pedidos
                           where status <> 'cancelado' and data_agendada between ini and fim group by 1) o on o.dia = x.dia::date
               left join public.datas_bloqueadas b on b.data = x.dia::date));
end $$;

create function public.admin_bloquear_data(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); d date := public._v_data(p, 'data'); motivo text := public._v_txt(p, 'motivo', 0, 80, 'Motivo');
begin
  if public._v_bool(p, 'bloquear') then
    insert into public.datas_bloqueadas (data, motivo) values (d, motivo)
    on conflict (data) do update set motivo = excluded.motivo;
  else
    delete from public.datas_bloqueadas where data = d;
  end if;
  return jsonb_build_object('ok', true, 'data', to_char(d, 'YYYY-MM-DD'), 'bloqueada', public._v_bool(p, 'bloquear'));
end $$;

/* ---------- Dashboard: o que produzir em uma data ---------- */
create function public.admin_producao(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  staff public.perfis := public._staff();
  d date := coalesce(public._v_data(p, 'data', true), (now() at time zone 'America/Sao_Paulo')::date + 1);
  incluir boolean := public._v_bool(p, 'incluir_entregues');
begin
  return jsonb_build_object(
    'data', to_char(d, 'YYYY-MM-DD'),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', t.nome, 'opcoes', t.opcoes, 'qtd', t.qtd, 'pedidos', t.pedidos) order by t.nome, t.opcoes::text)
        from (select i.nome, i.opcoes, sum(i.qtd) as qtd, count(distinct i.pedido_id) as pedidos
                from public.pedido_itens i join public.pedidos o on o.id = i.pedido_id
               where o.data_agendada = d and o.status <> 'cancelado' and (incluir or o.status <> 'entregue')
               group by i.nome, i.opcoes) t), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'codigo', o.codigo, 'hora', o.hora_agendada, 'cliente', o.cliente_nome,
                'telefone', o.cliente_telefone, 'tipo', o.tipo, 'status', o.status, 'status_texto', public._status_texto(o.status, o.tipo),
                'observacoes', o.observacoes,
                'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'opcoes', i.opcoes, 'obs', i.obs) order by i.id)
                            from public.pedido_itens i where i.pedido_id = o.id)) order by o.hora_agendada, o.id)
        from public.pedidos o where o.data_agendada = d and o.status <> 'cancelado' and (incluir or o.status <> 'entregue')), '[]'::jsonb));
end $$;

/* ---------- Regras extras do pedido do cliente (dia bloqueado ou lotado) ---------- */
create function public._calcular_extra(uid uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c jsonb := public._calcular(uid, p); cfg jsonb := public._cfg();
  dia date; maximo int := coalesce((cfg #>> '{agenda,max_pedidos_dia}')::int, 0);
begin
  if (c ->> 'data') ~ '^\d{4}-\d{2}-\d{2}$' then
    dia := (c ->> 'data')::date;
    if exists (select 1 from public.datas_bloqueadas where data = dia) then
      c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data', 'Não estamos agendando para este dia. Escolha outra data.'));
    elsif maximo > 0 and (select count(*) from public.pedidos where data_agendada = dia and status <> 'cancelado') >= maximo then
      c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data', 'A agenda deste dia já está cheia. Escolha outra data.'));
    end if;
  end if;
  return c;
end $$;

create or replace function public.cliente_orcar_pedido(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  return public._calcular_extra(u.id, p) - 'cupom_id';
end $$;

create or replace function public.cliente_criar_pedido(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u public.perfis := public._cliente(); c jsonb; pid bigint; n int; campos jsonb;
begin
  if (select count(*) from public.pedidos where usuario_id = u.id and criado_em > now() - interval '1 hour') >= 20 then
    perform public._falha(429, 'Você fez muitos pedidos em pouco tempo. Fale com a loja pelo WhatsApp.');
  end if;

  -- Um pedido por vez em cada data: dois clientes ao mesmo tempo não estouram o limite do dia.
  perform pg_advisory_xact_lock(hashtext('agenda:' || coalesce(p ->> 'data', '')));

  c := public._calcular_extra(u.id, p);
  if jsonb_array_length(c -> 'problemas') > 0 then
    select jsonb_object_agg(x ->> 'campo', x ->> 'mensagem') into campos from jsonb_array_elements(c -> 'problemas') x;
    perform public._falha(422, c -> 'problemas' -> 0 ->> 'mensagem', null, campos);
  end if;

  if (c ->> 'cupom_id') is not null then
    update public.cupons set usos = usos + 1
     where id = (c ->> 'cupom_id')::bigint and (limite_uso is null or usos < limite_uso);
    get diagnostics n = row_count;
    if n = 0 then perform public._falha(409, 'Este cupom atingiu o limite de usos.'); end if;
  end if;

  insert into public.pedidos (usuario_id, cliente_nome, cliente_telefone, tipo, endereco, lat, lng, distancia_km,
      data_agendada, hora_agendada, pagamento, troco_para, subtotal, taxa_entrega, desconto, total, cupom, observacoes)
  values (u.id, u.nome, u.telefone, c ->> 'tipo', nullif(c -> 'endereco', 'null'::jsonb), (c ->> 'lat')::double precision, (c ->> 'lng')::double precision,
      (c ->> 'distancia_km')::double precision, (c ->> 'data')::date, c ->> 'hora', c ->> 'pagamento', (c ->> 'troco_para')::int,
      (c ->> 'subtotal')::int, (c ->> 'taxa_entrega')::int, (c ->> 'desconto')::int, (c ->> 'total')::int,
      c ->> 'cupom', nullif(c ->> 'observacoes', ''))
  returning id into pid;

  update public.pedidos set codigo = 'LA' || pid where id = pid;
  insert into public.pedido_itens (pedido_id, produto_id, nome, unidade, preco_unit, qtd, opcoes, obs, total)
  select pid, (i ->> 'produto_id')::bigint, i ->> 'nome', i ->> 'unidade', (i ->> 'preco_unit')::int, (i ->> 'qtd')::int,
         i -> 'opcoes', nullif(i ->> 'obs', ''), (i ->> 'total')::int
    from jsonb_array_elements(c -> 'itens') i;
  insert into public.pedido_historico (pedido_id, status, nota, usuario_id) values (pid, 'novo', 'Pedido enviado pelo cliente', u.id);

  return jsonb_build_object('pedido', public._pedido_completo(pid));
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function public.loja_agenda(jsonb) to anon, authenticated;
grant execute on function
  public.admin_agenda(jsonb), public.admin_bloquear_data(jsonb), public.admin_salvar_agenda(jsonb), public.admin_producao(jsonb)
to authenticated;
