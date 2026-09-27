-- ==========================================================
-- 11) PEDIDOS AVANÇADOS
--     Pedido lançado pela equipe (WhatsApp/telefone), sinal para
--     garantir a data, registro de pagamentos, cupom de frete
--     grátis e exportações para planilha.
-- ==========================================================

/* ---------- Esquema ---------- */
-- Um pedido feito por telefone pode ser de alguém sem conta na loja.
alter table public.pedidos alter column usuario_id drop not null;
alter table public.pedidos
  add column origem text not null default 'loja' check (origem in ('loja', 'manual')),
  add column sinal  int  not null default 0 check (sinal >= 0),
  add column pago   int  not null default 0 check (pago >= 0);

create table public.pagamentos_pedido (
  id         bigint generated always as identity primary key,
  pedido_id  bigint not null references public.pedidos (id) on delete cascade,
  valor      int  not null check (valor > 0),
  forma      text not null check (forma in ('pix', 'dinheiro', 'cartao', 'transferencia')),
  usuario_id uuid references public.perfis (id) on delete set null,
  criado_em  timestamptz not null default now()
);
create index pagamentos_pedido_idx on public.pagamentos_pedido (pedido_id);
alter table public.pagamentos_pedido enable row level security;
revoke all on public.pagamentos_pedido from anon, authenticated;

-- Cupom que zera só a taxa de entrega.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.cupons'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%percentual%' loop
    execute format('alter table public.cupons drop constraint %I', c);
  end loop;
end $$;
alter table public.cupons add constraint cupons_tipo_check check (tipo in ('percentual', 'valor', 'frete'));

/* ---------- Sinal ---------- */
-- O sinal só existe quando o PIX está ativo (é por ele que o cliente paga).
create function public._sinal_para(total bigint) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public._cfg();
  pct int := coalesce((cfg #>> '{sinal,percentual}')::int, 0);
  acima bigint := coalesce((cfg #>> '{sinal,acima_de}')::bigint, 0);
begin
  if pct <= 0 or total <= 0 or total < acima then return 0; end if;
  if not (coalesce((cfg #>> '{pagamento,pix_ativo}')::boolean, false) and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> '') then return 0; end if;
  return least(total, round(total * pct / 100.0))::int;
end $$;

create function public._sinal_automatico() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origem = 'loja' then new.sinal := public._sinal_para(new.total); end if;
  return new;
end $$;
create trigger pedidos_sinal before insert on public.pedidos for each row execute function public._sinal_automatico();

create function public.admin_salvar_sinal(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); novo jsonb;
begin
  novo := jsonb_build_object('percentual', public._v_int(p, 'percentual', 0, 100, 'Percentual do sinal'),
                             'acima_de', public._v_int(p, 'acima_de', 0, 10000000, 'Valor mínimo do pedido'));
  insert into public.configuracoes (chave, valor) values ('sinal', novo)
  on conflict (chave) do update set valor = excluded.valor;
  return jsonb_build_object('configuracoes', public._cfg());
end $$;

/* A vitrine passa a conhecer a regra do sinal. */
create or replace function public.loja_config(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public._cfg(); agora timestamp := now() at time zone 'America/Sao_Paulo';
  janela jsonb; aberta boolean; pag jsonb;
begin
  janela := cfg -> 'horarios' -> (extract(dow from agora)::int)::text;
  aberta := coalesce((janela ->> 'aberto')::boolean, false)
        and to_char(agora, 'HH24:MI') >= coalesce(janela ->> 'abre', '00:00')
        and to_char(agora, 'HH24:MI') <= coalesce(janela ->> 'fecha', '00:00');
  pag := coalesce(cfg -> 'pagamento', '{}'::jsonb) - 'pix_chave' - 'pix_nome' - 'pix_cidade';
  pag := jsonb_set(pag, '{pix_ativo}', to_jsonb(coalesce((cfg #>> '{pagamento,pix_ativo}')::boolean, false)
                                                and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> ''));
  return jsonb_build_object(
    'loja', coalesce(cfg -> 'loja', '{}'::jsonb), 'textos', coalesce(cfg -> 'textos', '{}'::jsonb),
    'horarios', coalesce(cfg -> 'horarios', '{}'::jsonb), 'pedidos', coalesce(cfg -> 'pedidos', '{}'::jsonb),
    'entrega', coalesce(cfg -> 'entrega', '{}'::jsonb), 'pagamento', pag,
    'sinal', coalesce(cfg -> 'sinal', '{"percentual":0,"acima_de":0}'::jsonb),
    'galeria', coalesce(cfg #> '{galeria,itens}', '[]'::jsonb),
    'faq', coalesce(cfg #> '{faq,itens}', '[]'::jsonb),
    'legal', coalesce(cfg -> 'legal', '{}'::jsonb),
    'zonas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ate_km', ate_km, 'taxa', taxa, 'prazo_min', prazo_min) order by ate_km)
                         from public.zonas_entrega where ativa), '[]'::jsonb),
    'aberta_agora', aberta);
end $$;

/* ---------- Como o pedido é mostrado (lista, detalhe, cliente) ---------- */
create function public._forma_recebida_texto(forma text) returns text language sql immutable as $$
  select case forma when 'pix' then 'PIX' when 'dinheiro' then 'Dinheiro' when 'cartao' then 'Cartão' when 'transferencia' then 'Transferência' else forma end
$$;

create function public._pagamento_situacao(ped public.pedidos) returns text language sql immutable as $$
  select case
    when ped.total > 0 and ped.pago >= ped.total then 'pago'
    when ped.sinal > 0 and ped.pago >= ped.sinal then 'sinal_pago'
    when ped.pago > 0 then 'parcial'
    when ped.sinal > 0 then 'aguardando_sinal'
    else 'pendente' end
$$;

create or replace function public._pedido_resumo(ped public.pedidos) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', ped.id, 'codigo', ped.codigo, 'status', ped.status, 'status_texto', public._status_texto(ped.status, ped.tipo), 'tipo', ped.tipo,
    'origem', ped.origem,
    'cliente', jsonb_build_object('id', ped.usuario_id, 'nome', ped.cliente_nome, 'telefone', ped.cliente_telefone),
    'endereco', ped.endereco, 'lat', ped.lat, 'lng', ped.lng, 'distancia_km', ped.distancia_km,
    'data', to_char(ped.data_agendada, 'YYYY-MM-DD'), 'hora', ped.hora_agendada,
    'pagamento', ped.pagamento, 'pagamento_texto', public._pagamento_texto(ped.pagamento), 'troco_para', ped.troco_para,
    'subtotal', ped.subtotal, 'taxa_entrega', ped.taxa_entrega, 'desconto', ped.desconto, 'total', ped.total,
    'sinal', ped.sinal, 'pago', ped.pago, 'saldo', greatest(ped.total - ped.pago, 0), 'pagamento_situacao', public._pagamento_situacao(ped),
    'cupom', ped.cupom, 'observacoes', ped.observacoes, 'motivo_cancelamento', ped.motivo_cancelamento,
    'criado_em', public._fmt(ped.criado_em), 'atualizado_em', public._fmt(ped.atualizado_em))
$$;

create or replace function public._pedido_completo(pid bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ped public.pedidos; cfg jsonb := public._cfg(); r jsonb; av public.avaliacoes; a_pagar int;
begin
  select * into ped from public.pedidos where id = pid;
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  r := public._pedido_resumo(ped);
  r := r || jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'produto_id', i.produto_id, 'nome', i.nome, 'unidade', i.unidade,
                 'preco_unit', i.preco_unit, 'qtd', i.qtd, 'opcoes', i.opcoes, 'obs', i.obs, 'total', i.total) order by i.id)
               from public.pedido_itens i where i.pedido_id = pid), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('status', h.status, 'status_texto', public._status_texto(h.status, ped.tipo),
                 'nota', h.nota, 'criado_em', public._fmt(h.criado_em)) order by h.id)
               from public.pedido_historico h where h.pedido_id = pid), '[]'::jsonb),
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'valor', g.valor, 'forma', g.forma,
                 'forma_texto', public._forma_recebida_texto(g.forma), 'criado_em', public._fmt(g.criado_em)) order by g.id)
               from public.pagamentos_pedido g where g.pedido_id = pid), '[]'::jsonb),
    'proximos', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'texto', public._status_texto(s, ped.tipo)))
               from unnest(public._proximos(ped.status, ped.tipo)) as s), '[]'::jsonb));
  select * into av from public.avaliacoes where pedido_id = pid;
  r := r || jsonb_build_object('avaliacao', case when av.id is null then null else jsonb_build_object(
      'nota', av.nota, 'comentario', av.comentario, 'resposta', av.resposta, 'aprovada', av.aprovada, 'criado_em', public._fmt(av.criado_em)) end);
  -- PIX: primeiro o sinal (se houver), depois o que falta. A chave é pública para quem vai pagar.
  a_pagar := case when ped.sinal > ped.pago then ped.sinal - ped.pago else greatest(ped.total - ped.pago, 0) end;
  if (ped.pagamento = 'pix' or ped.sinal > ped.pago) and a_pagar > 0
     and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> '' and ped.status not in ('cancelado', 'entregue') then
    r := r || jsonb_build_object('pix', jsonb_build_object(
      'chave', cfg #>> '{pagamento,pix_chave}',
      'nome', coalesce(nullif(cfg #>> '{pagamento,pix_nome}', ''), cfg #>> '{loja,nome}'),
      'cidade', coalesce(nullif(cfg #>> '{pagamento,pix_cidade}', ''), cfg #>> '{loja,cidade}'),
      'valor', a_pagar, 'identificador', ped.codigo, 'motivo', case when ped.sinal > ped.pago then 'sinal' else 'total' end));
  end if;
  return r;
end $$;

/* ---------- Pagamentos recebidos ---------- */
create function public.admin_registrar_pagamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  staff public.perfis := public._staff(); pid bigint := public._v_int(p, 'id', 1, 999999999999, 'Pedido');
  ped public.pedidos; v int; forma text;
begin
  select * into ped from public.pedidos where id = pid for update;
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  if ped.status = 'cancelado' then perform public._falha(409, 'Pedido cancelado não recebe pagamento.'); end if;
  v := public._v_int(p, 'valor', 1, 10000000, 'Valor');
  forma := public._v_opcao(p, 'forma', array['pix', 'dinheiro', 'cartao', 'transferencia'], 'Forma de pagamento');
  if ped.pago + v > ped.total then
    perform public._falha(422, 'O valor passa do total do pedido. Falta receber ' || public._brl(ped.total - ped.pago) || '.', 'valor');
  end if;
  insert into public.pagamentos_pedido (pedido_id, valor, forma, usuario_id) values (pid, v, forma, staff.id);
  update public.pedidos set pago = pago + v, atualizado_em = now() where id = pid;
  return jsonb_build_object('pedido', public._pedido_completo(pid));
end $$;

create function public.admin_excluir_pagamento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare staff public.perfis := public._staff(); g public.pagamentos_pedido;
begin
  select * into g from public.pagamentos_pedido where id = public._v_int(p, 'id', 1, 999999999999, 'Pagamento');
  if not found then perform public._falha(404, 'Pagamento não encontrado.'); end if;
  delete from public.pagamentos_pedido where id = g.id;
  update public.pedidos set pago = greatest(pago - g.valor, 0), atualizado_em = now() where id = g.pedido_id;
  return jsonb_build_object('pedido', public._pedido_completo(g.pedido_id));
end $$;

/* ---------- Pedido lançado pela equipe ---------- */
create function public.admin_criar_pedido(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  staff public.perfis := public._staff(); u public.perfis; cid uuid; cnome text; ctel text;
  tipo text := case when p ->> 'tipo' = 'entrega' then 'entrega' else 'retirada' end;
  v_data date := public._v_data(p, 'data'); v_hora text := coalesce(p ->> 'hora', '');
  forma text := public._v_opcao(p, 'pagamento', array['pix', 'dinheiro', 'cartao_entrega'], 'Forma de pagamento');
  v_status text := public._v_opcao(jsonb_build_object('s', coalesce(nullif(p ->> 'status', ''), 'confirmado')), 's', array['novo', 'confirmado'], 'Situação');
  bruto jsonb; pr public.produtos; qtd int; r jsonb; unit bigint; nome text; itens jsonb := '[]'::jsonb; subtotal bigint := 0;
  taxa int := 0; desc_ int := 0; total bigint; v_sinal int; endereco jsonb; pid bigint;
begin
  /* cliente: alguém com conta ou só nome e telefone */
  if nullif(p ->> 'cliente_id', '') is not null then
    select * into u from public.perfis where id::text = p ->> 'cliente_id' and papel = 'cliente';
    if not found then perform public._falha(404, 'Cliente não encontrado.', 'cliente'); end if;
    cid := u.id; cnome := u.nome; ctel := u.telefone;
  else
    cnome := public._v_txt(p, 'nome', 2, 80, 'Nome do cliente');
    ctel := public._v_tel(p, 'telefone', false);
  end if;

  if v_hora !~ '^([01]\d|2[0-3]):[0-5]\d$' then perform public._falha(422, 'Informe o horário.', 'hora'); end if;

  /* itens: do cardápio (com opções) ou avulsos (nome e preço combinados) */
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then
    perform public._falha(422, 'Adicione pelo menos um item.', 'itens');
  end if;
  if jsonb_array_length(p -> 'itens') > 60 then perform public._falha(422, 'Use no máximo 60 itens por pedido.', 'itens'); end if;
  for bruto in select value from jsonb_array_elements(p -> 'itens') loop
    if (bruto ->> 'qtd') !~ '^\d{1,3}$' or (bruto ->> 'qtd')::int < 1 then perform public._falha(422, 'Quantidade inválida.', 'itens'); end if;
    qtd := (bruto ->> 'qtd')::int;
    if nullif(bruto ->> 'produto_id', '') is not null then
      select * into pr from public.produtos where id::text = bruto ->> 'produto_id';
      if not found then perform public._falha(422, 'Um dos produtos não existe mais.', 'itens'); end if;
      r := public._resolver_opcoes(pr.nome, pr.opcoes, bruto -> 'opcoes');
      unit := pr.preco + (r ->> 'extras')::bigint;
      itens := itens || jsonb_build_array(jsonb_build_object('produto_id', pr.id, 'nome', pr.nome, 'unidade', pr.unidade, 'preco_unit', unit, 'qtd', qtd,
        'opcoes', r -> 'descricao', 'obs', left(btrim(coalesce(bruto ->> 'obs', '')), 200), 'total', unit * qtd));
    else
      nome := btrim(coalesce(bruto ->> 'nome', ''));
      if length(nome) < 2 or length(nome) > 80 then perform public._falha(422, 'Dê um nome ao item avulso (2 a 80 letras).', 'itens'); end if;
      unit := public._v_int(bruto, 'preco', 0, 10000000, 'Preço do item');
      itens := itens || jsonb_build_array(jsonb_build_object('produto_id', null, 'nome', nome, 'unidade', 'un', 'preco_unit', unit, 'qtd', qtd,
        'opcoes', '[]'::jsonb, 'obs', left(btrim(coalesce(bruto ->> 'obs', '')), 200), 'total', unit * qtd));
    end if;
    subtotal := subtotal + unit * qtd;
  end loop;

  if tipo = 'entrega' then
    endereco := jsonb_build_object('apelido', 'Informado pela loja', 'cep', '', 'rua', public._v_txt(p, 'endereco', 5, 200, 'Endereço de entrega'),
      'numero', '', 'complemento', '', 'bairro', '', 'cidade', '', 'uf', '', 'referencia', '');
    taxa := coalesce(public._v_int(p, 'taxa_entrega', 0, 1000000, 'Taxa de entrega', true), 0);
  end if;
  desc_ := coalesce(public._v_int(p, 'desconto', 0, 100000000, 'Desconto', true), 0);
  if desc_ > subtotal + taxa then perform public._falha(422, 'O desconto não pode passar do valor do pedido.', 'desconto'); end if;
  total := subtotal + taxa - desc_;
  v_sinal := coalesce(public._v_int(p, 'sinal', 0, total, 'Sinal', true), 0);

  insert into public.pedidos (usuario_id, cliente_nome, cliente_telefone, status, tipo, endereco, data_agendada, hora_agendada, pagamento,
      subtotal, taxa_entrega, desconto, total, observacoes, origem, sinal)
  values (cid, cnome, nullif(ctel, ''), v_status, tipo, endereco, v_data, v_hora, forma, subtotal, taxa, desc_, total,
      nullif(public._v_par(p, 'observacoes', 500, 'Observações'), ''), 'manual', v_sinal)
  returning id into pid;

  update public.pedidos set codigo = 'LA' || pid where id = pid;
  insert into public.pedido_itens (pedido_id, produto_id, nome, unidade, preco_unit, qtd, opcoes, obs, total)
  select pid, nullif(i ->> 'produto_id', '')::bigint, i ->> 'nome', i ->> 'unidade', (i ->> 'preco_unit')::int, (i ->> 'qtd')::int,
         i -> 'opcoes', nullif(i ->> 'obs', ''), (i ->> 'total')::int
    from jsonb_array_elements(itens) i;
  insert into public.pedido_historico (pedido_id, status, nota, usuario_id) values (pid, v_status, 'Pedido registrado pela loja', staff.id);

  return jsonb_build_object('pedido', public._pedido_completo(pid));
end $$;

/* ---------- Cupom de frete grátis ---------- */
create or replace function public._avaliar_cupom(p_codigo text, p_subtotal bigint, uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.cupons; bruto bigint;
begin
  select * into c from public.cupons where upper(codigo) = upper(btrim(p_codigo));
  if not found or not c.ativo then perform public._falha(422, 'Cupom inválido.'); end if;
  if c.validade is not null and c.validade < (now() at time zone 'America/Sao_Paulo')::date then
    perform public._falha(422, 'Este cupom expirou.');
  end if;
  if c.limite_uso is not null and c.usos >= c.limite_uso then
    perform public._falha(422, 'Este cupom atingiu o limite de usos.');
  end if;
  if p_subtotal < c.minimo then
    perform public._falha(422, 'Este cupom exige pedido mínimo de ' || public._brl(c.minimo) || '.');
  end if;
  if c.primeira_compra and exists (select 1 from public.pedidos where usuario_id = uid and status <> 'cancelado') then
    perform public._falha(422, 'Este cupom vale apenas para a primeira compra.');
  end if;
  -- o de frete grátis não desconta do subtotal: a taxa é abatida em _calcular_extra
  bruto := case c.tipo when 'percentual' then round(p_subtotal * c.valor / 100.0) when 'frete' then 0 else c.valor end;
  return jsonb_build_object('id', c.id, 'codigo', c.codigo, 'desconto', least(bruto, p_subtotal));
end $$;

create or replace function public.admin_salvar_cupom(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cid bigint := nullif(p ->> 'id', '')::bigint;
  v_cod text := upper(btrim(coalesce(p ->> 'codigo', ''))); v_desc text; v_tipo text; v_valor int; v_min int;
  v_val date; v_lim int; v_pc boolean; v_at boolean;
begin
  if v_cod !~ '^[A-Z0-9_-]{3,20}$' then perform public._falha(422, 'Código: 3 a 20 letras, números, - ou _.', 'codigo'); end if;
  v_desc  := public._v_txt(p, 'descricao', 0, 100, 'Descrição');
  v_tipo  := public._v_opcao(p, 'tipo', array['percentual', 'valor', 'frete'], 'Tipo');
  v_valor := case when v_tipo = 'frete' then 1 else public._v_int(p, 'valor', 1, 10000000, 'Valor') end;
  v_min   := public._v_int(p, 'minimo', 0, 10000000, 'Pedido mínimo');
  v_val   := public._v_data(p, 'validade', true);
  v_lim   := public._v_int(p, 'limite_uso', 1, 1000000, 'Limite de usos', true);
  v_pc    := public._v_bool(p, 'primeira_compra'); v_at := public._v_bool(p, 'ativo');
  if v_tipo = 'percentual' and v_valor > 100 then perform public._falha(422, 'Desconto percentual: no máximo 100%.', 'valor'); end if;
  if exists (select 1 from public.cupons where upper(codigo) = v_cod and id is distinct from cid) then
    perform public._falha(409, 'Já existe um cupom com este código.', 'codigo');
  end if;
  if cid is null then
    insert into public.cupons (codigo, descricao, tipo, valor, minimo, validade, limite_uso, primeira_compra, ativo)
    values (v_cod, v_desc, v_tipo, v_valor, v_min, v_val, v_lim, v_pc, v_at);
  else
    if not exists (select 1 from public.cupons where id = cid) then perform public._falha(404, 'Cupom não encontrado.'); end if;
    update public.cupons set codigo = v_cod, descricao = v_desc, tipo = v_tipo, valor = v_valor, minimo = v_min, validade = v_val,
           limite_uso = v_lim, primeira_compra = v_pc, ativo = v_at where id = cid;
  end if;
  return public._cupons_admin();
end $$;

/* Regras extras do pedido do cliente: agenda (dia bloqueado ou lotado), frete grátis e sinal. */
create or replace function public._calcular_extra(uid uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c jsonb := public._calcular(uid, p); cfg jsonb := public._cfg();
  dia date; maximo int := coalesce((cfg #>> '{agenda,max_pedidos_dia}')::int, 0); cupom_tipo text;
begin
  if (c ->> 'data') ~ '^\d{4}-\d{2}-\d{2}$' then
    dia := (c ->> 'data')::date;
    if exists (select 1 from public.datas_bloqueadas where data = dia) then
      c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data', 'Não estamos agendando para este dia. Escolha outra data.'));
    elsif maximo > 0 and (select count(*) from public.pedidos where data_agendada = dia and status <> 'cancelado') >= maximo then
      c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data', 'A agenda deste dia já está cheia. Escolha outra data.'));
    end if;
  end if;

  if (c ->> 'cupom') is not null then
    select tipo into cupom_tipo from public.cupons where upper(codigo) = upper(c ->> 'cupom');
    if cupom_tipo = 'frete' then
      if c ->> 'tipo' <> 'entrega' then
        c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'cupom', 'Este cupom vale só para entrega.'));
      else
        c := c || jsonb_build_object('desconto', (c ->> 'taxa_entrega')::bigint, 'total', (c ->> 'subtotal')::bigint);
      end if;
    end if;
  end if;

  return c || jsonb_build_object('sinal', public._sinal_para((c ->> 'total')::bigint));
end $$;

/* ---------- Exportações (a planilha é montada na tela) ---------- */
create function public.admin_exportar_pedidos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  de date := coalesce(public._v_data(p, 'de', true), hoje - 90); ate date := coalesce(public._v_data(p, 'ate', true), hoje + 365);
begin
  return jsonb_build_object('de', to_char(de, 'YYYY-MM-DD'), 'ate', to_char(ate, 'YYYY-MM-DD'), 'linhas', coalesce((
    select jsonb_agg(jsonb_build_object(
        'codigo', o.codigo, 'data', to_char(o.data_agendada, 'YYYY-MM-DD'), 'hora', o.hora_agendada, 'cliente', o.cliente_nome,
        'telefone', o.cliente_telefone, 'tipo', o.tipo, 'status', public._status_texto(o.status, o.tipo), 'origem', o.origem,
        'itens', (select string_agg(i.qtd || 'x ' || i.nome, '; ' order by i.id) from public.pedido_itens i where i.pedido_id = o.id),
        'subtotal', o.subtotal, 'taxa_entrega', o.taxa_entrega, 'desconto', o.desconto, 'total', o.total, 'pago', o.pago, 'sinal', o.sinal,
        'pagamento', public._pagamento_texto(o.pagamento), 'cupom', o.cupom, 'criado_em', public._fmt(o.criado_em)) order by o.data_agendada, o.hora_agendada, o.id)
      from (select * from public.pedidos where data_agendada between de and ate order by data_agendada, hora_agendada, id limit 5000) o), '[]'::jsonb));
end $$;

create function public.admin_exportar_clientes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return jsonb_build_object('linhas', coalesce((
    select jsonb_agg(jsonb_build_object('nome', u.nome, 'email', u.email, 'telefone', u.telefone, 'ativo', u.ativo,
        'cadastro', public._fmt(u.criado_em),
        'pedidos', (select count(*) from public.pedidos o where o.usuario_id = u.id and o.status <> 'cancelado'),
        'gasto', coalesce((select sum(o.total) from public.pedidos o where o.usuario_id = u.id and o.status <> 'cancelado'), 0)) order by u.criado_em)
      from (select * from public.perfis where papel = 'cliente' order by criado_em limit 10000) u), '[]'::jsonb));
end $$;

/* ---------- Permissões (as funções novas nascem trancadas) ---------- */
grant execute on function
  public.admin_salvar_sinal(jsonb), public.admin_registrar_pagamento(jsonb), public.admin_excluir_pagamento(jsonb),
  public.admin_criar_pedido(jsonb), public.admin_exportar_pedidos(jsonb), public.admin_exportar_clientes(jsonb)
to authenticated;
