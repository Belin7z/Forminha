-- ==========================================================
-- 4) PEDIDOS — cálculo, criação e acompanhamento
-- Preço, opções, frete, cupom, agendamento e pagamento são SEMPRE
-- calculados aqui. O navegador só manda a intenção (produtos,
-- quantidades, endereço, data…); qualquer preço enviado é ignorado.
-- ==========================================================

/** Confere as opções escolhidas ({grupoId: [itemId…]}) contra as do produto. */
create function public._resolver_opcoes(nome_produto text, opcoes jsonb, selecao jsonb) returns jsonb
language plpgsql stable as $$
declare
  g jsonb; it jsonb; escolhidos text[]; extras bigint := 0; descricao jsonb := '[]'::jsonb; itens_sel jsonb; n_ok int; qtd_esc int;
begin
  selecao := case when jsonb_typeof(selecao) = 'object' then selecao else '{}'::jsonb end;
  for g in select value from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) loop
    escolhidos := array(select distinct jsonb_array_elements_text(
      case when jsonb_typeof(selecao -> (g ->> 'id')) = 'array' then selecao -> (g ->> 'id') else '[]'::jsonb end));
    qtd_esc := coalesce(array_length(escolhidos, 1), 0);

    if coalesce((g ->> 'obrigatorio')::boolean, false) and qtd_esc = 0 then
      perform public._falha(422, nome_produto || ': escolha "' || (g ->> 'nome') || '".');
    end if;
    if g ->> 'tipo' = 'unica' and qtd_esc > 1 then
      perform public._falha(422, nome_produto || ': escolha só uma opção em "' || (g ->> 'nome') || '".');
    end if;
    if (g ->> 'max') is not null and qtd_esc > (g ->> 'max')::int then
      perform public._falha(422, nome_produto || ': escolha até ' || (g ->> 'max') || ' em "' || (g ->> 'nome') || '".');
    end if;

    itens_sel := '[]'::jsonb; n_ok := 0;
    for it in select value from jsonb_array_elements(g -> 'itens') loop
      if (it ->> 'id') = any (escolhidos) then
        extras := extras + (it ->> 'preco')::bigint;
        n_ok := n_ok + 1;
        itens_sel := itens_sel || jsonb_build_array(jsonb_build_object('nome', it ->> 'nome', 'preco', (it ->> 'preco')::int));
      end if;
    end loop;
    if n_ok <> qtd_esc then
      perform public._falha(422, nome_produto || ': opção inválida em "' || (g ->> 'nome') || '". Atualize a página.');
    end if;
    if n_ok > 0 then
      descricao := descricao || jsonb_build_array(jsonb_build_object('grupo', g ->> 'nome', 'itens', itens_sel));
    end if;
  end loop;
  return jsonb_build_object('extras', extras, 'descricao', descricao);
end $$;

/** Valida o cupom para este cliente e subtotal. Devolve {id, codigo, desconto}. */
create function public._avaliar_cupom(p_codigo text, p_subtotal bigint, uid uuid) returns jsonb
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
  bruto := case c.tipo when 'percentual' then round(p_subtotal * c.valor / 100.0) else c.valor end;
  return jsonb_build_object('id', c.id, 'codigo', c.codigo, 'desconto', least(bruto, p_subtotal));
end $$;

/** Devolve null se a data/hora servem; senão, a mensagem para o cliente. */
create function public._validar_agenda(cfg jsonb, p_data text, p_hora text, minimo timestamptz, antecedencia int) returns text
language plpgsql stable as $$
declare
  d date; janela jsonb; h time; abre time; fecha time; intervalo int; dias int;
  tz text := 'America/Sao_Paulo'; ok boolean;
begin
  if p_data !~ '^\d{4}-\d{2}-\d{2}$' or p_hora !~ '^([01]\d|2[0-3]):[0-5]\d$' then return 'Escolha a data e o horário.'; end if;
  begin d := p_data::date; exception when others then return 'Escolha a data e o horário.'; end;

  dias := coalesce((cfg #>> '{pedidos,dias_maximos}')::int, 45);
  if d > (now() at time zone tz)::date + dias then return 'Agendamos com até ' || dias || ' dias de antecedência.'; end if;

  intervalo := greatest(10, coalesce((cfg #>> '{pedidos,intervalo_min}')::int, 30));
  janela := cfg -> 'horarios' -> (extract(dow from d)::int)::text;
  h := p_hora::time;
  ok := coalesce((janela ->> 'aberto')::boolean, false);
  if ok then
    abre := (janela ->> 'abre')::time; fecha := (janela ->> 'fecha')::time;
    ok := h >= abre and h <= fecha
      and mod((extract(epoch from (h - abre)) / 60)::int, intervalo) = 0
      and ((p_data || ' ' || p_hora)::timestamp at time zone tz) >= minimo;
  end if;
  if not ok then
    return 'Horário indisponível. Seu pedido precisa de '
      || case when antecedencia >= 24 and antecedencia % 24 = 0 then (antecedencia / 24) || ' dia(s)' else antecedencia || 'h' end
      || ' de antecedência e cair no horário de funcionamento.';
  end if;
  return null;
end $$;

-- ==========================================================
-- CÁLCULO (usado pelo orçamento e pela criação)
-- ==========================================================
create function public._calcular(uid uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := public._cfg();
  problemas jsonb := '[]'::jsonb;
  itens jsonb := '[]'::jsonb;
  antecedencia int := coalesce((cfg #>> '{pedidos,antecedencia_horas}')::int, 24);
  bruto jsonb; pr public.produtos; pid bigint; qtd int; r jsonb; unit bigint; subtotal bigint := 0;
  tipo text; minimo timestamptz; v_data text := coalesce(p ->> 'data', ''); v_hora text := coalesce(p ->> 'hora', ''); msg text;
  taxa bigint := 0; distancia double precision; zona jsonb; prazo int; endereco jsonb; lat double precision; lng double precision;
  f jsonb; e public.enderecos; eid bigint;
  desconto bigint := 0; cupom text; cupom_id bigint; c jsonb; codigo_cupom text := btrim(coalesce(p ->> 'cupom', ''));
  forma text := p ->> 'pagamento'; troco bigint; total bigint; pagamento_ok boolean;
begin
  if coalesce((cfg #>> '{pedidos,pausados}')::boolean, false) then
    problemas := public._prob(problemas, 'geral',
      coalesce(nullif(cfg #>> '{pedidos,mensagem_pausa}', ''), 'Estamos sem receber pedidos no momento.'));
  end if;

  /* ----- Itens ----- */
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then
    problemas := public._prob(problemas, 'itens', 'Seu carrinho está vazio.');
  end if;

  for bruto in select value from jsonb_array_elements(case when jsonb_typeof(p -> 'itens') = 'array' then p -> 'itens' else '[]'::jsonb end) limit 60 loop
    pid := case when (bruto ->> 'produto_id') ~ '^\d{1,15}$' then (bruto ->> 'produto_id')::bigint end;
    select pr2.* into pr from public.produtos pr2 join public.categorias c2 on c2.id = pr2.categoria_id
     where pr2.id = pid and pr2.ativo and c2.ativa;
    if not found then
      problemas := public._prob(problemas, 'itens', 'Um item do carrinho não está mais disponível.');
      continue;
    end if;
    if (bruto ->> 'qtd') !~ '^\d{1,3}$' or (bruto ->> 'qtd')::int < 1 then
      problemas := public._prob(problemas, 'itens', pr.nome || ': quantidade inválida.');
      continue;
    end if;
    qtd := (bruto ->> 'qtd')::int;
    if qtd < pr.min_qtd then
      problemas := public._prob(problemas, 'itens', pr.nome || ': pedido mínimo de ' || pr.min_qtd || ' un.');
    end if;
    begin
      r := public._resolver_opcoes(pr.nome, pr.opcoes, bruto -> 'opcoes');
    exception when sqlstate 'PT422' then
      problemas := public._prob(problemas, 'itens', sqlerrm);
      continue;
    end;
    unit := pr.preco + (r ->> 'extras')::bigint;
    itens := itens || jsonb_build_array(jsonb_build_object(
      'produto_id', pr.id, 'nome', pr.nome, 'unidade', pr.unidade, 'preco_unit', unit, 'qtd', qtd,
      'opcoes', r -> 'descricao', 'obs', left(btrim(coalesce(bruto ->> 'obs', '')), 200), 'total', unit * qtd));
    subtotal := subtotal + unit * qtd;
    if pr.antecedencia_horas is not null then antecedencia := greatest(antecedencia, pr.antecedencia_horas); end if;
  end loop;

  if jsonb_array_length(itens) > 0 and subtotal < coalesce((cfg #>> '{pedidos,pedido_minimo}')::bigint, 0) then
    problemas := public._prob(problemas, 'itens', 'O pedido mínimo é de ' || public._brl((cfg #>> '{pedidos,pedido_minimo}')::bigint) || '.');
  end if;

  /* ----- Tipo de recebimento ----- */
  tipo := case when p ->> 'tipo' = 'retirada' then 'retirada' else 'entrega' end;
  if tipo = 'entrega' and not coalesce((cfg #>> '{entrega,entrega_ativa}')::boolean, true) then
    problemas := public._prob(problemas, 'tipo', 'No momento só trabalhamos com retirada.');
  end if;
  if tipo = 'retirada' and not coalesce((cfg #>> '{entrega,retirada_ativa}')::boolean, true) then
    problemas := public._prob(problemas, 'tipo', 'No momento só fazemos entregas.');
  end if;

  /* ----- Agendamento ----- */
  minimo := now() + make_interval(hours => antecedencia);
  msg := public._validar_agenda(cfg, v_data, v_hora, minimo, antecedencia);
  if msg is not null then
    problemas := public._prob(problemas, case when v_data ~ '^\d{4}-\d{2}-\d{2}$' and v_hora ~ '^\d{2}:\d{2}$' and msg like 'Horário%' then 'hora' else 'data' end, msg);
  end if;

  /* ----- Endereço e taxa de entrega ----- */
  if tipo = 'entrega' then
    eid := case when (p ->> 'endereco_id') ~ '^\d{1,15}$' then (p ->> 'endereco_id')::bigint end;
    select * into e from public.enderecos where id = eid and usuario_id = uid;
    if not found then
      problemas := public._prob(problemas, 'endereco', 'Escolha o endereço de entrega.');
    else
      endereco := jsonb_build_object('apelido', e.apelido, 'cep', e.cep, 'rua', e.rua, 'numero', e.numero, 'complemento', e.complemento,
                                     'bairro', e.bairro, 'cidade', e.cidade, 'uf', e.uf, 'referencia', e.referencia);
      lat := e.lat; lng := e.lng;
      f := public._faixa_entrega(cfg, e.lat, e.lng);
      if f ->> 'status' = 'fora' then
        problemas := public._prob(problemas, 'endereco',
          'Este endereço fica a ' || replace((f ->> 'distancia_km'), '.', ',') || ' km, fora da nossa área de entrega.');
      elsif f ->> 'status' = 'sem_local' then
        problemas := public._prob(problemas, 'endereco', 'Marque a localização deste endereço no mapa para calcularmos a entrega.');
      else
        taxa := (f ->> 'taxa')::bigint; distancia := (f ->> 'distancia_km')::double precision;
        zona := f -> 'zona'; prazo := (f ->> 'prazo_min')::int;
      end if;
    end if;
    if coalesce((cfg #>> '{entrega,gratis_acima}')::bigint, 0) > 0 and subtotal >= (cfg #>> '{entrega,gratis_acima}')::bigint then taxa := 0; end if;
  end if;

  /* ----- Cupom ----- */
  if codigo_cupom <> '' and jsonb_array_length(itens) > 0 then
    begin
      c := public._avaliar_cupom(codigo_cupom, subtotal, uid);
      desconto := (c ->> 'desconto')::bigint; cupom := c ->> 'codigo'; cupom_id := (c ->> 'id')::bigint;
    exception when sqlstate 'PT422' then
      problemas := public._prob(problemas, 'cupom', sqlerrm);
    end;
  end if;

  total := greatest(0, subtotal + taxa - desconto);

  /* ----- Pagamento ----- */
  pagamento_ok := case forma
    when 'pix' then coalesce((cfg #>> '{pagamento,pix_ativo}')::boolean, false) and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> ''
    when 'dinheiro' then coalesce((cfg #>> '{pagamento,dinheiro_ativo}')::boolean, false)
    when 'cartao_entrega' then coalesce((cfg #>> '{pagamento,cartao_ativo}')::boolean, false)
    else false end;
  if not pagamento_ok then
    problemas := public._prob(problemas, 'pagamento', 'Escolha uma forma de pagamento.');
  elsif forma = 'dinheiro' and coalesce(p ->> 'troco_para', '') ~ '^\d+(\.\d+)?$' and (p ->> 'troco_para')::numeric > 0 then
    troco := trunc((p ->> 'troco_para')::numeric);
    if not (troco > total) then
      problemas := public._prob(problemas, 'pagamento', 'O valor para troco deve ser maior que o total do pedido.');
    end if;
  end if;

  return jsonb_build_object(
    'itens', itens, 'subtotal', subtotal, 'taxa_entrega', taxa, 'desconto', desconto, 'total', total,
    'cupom', cupom, 'cupom_id', cupom_id, 'tipo', tipo, 'endereco', endereco, 'lat', lat, 'lng', lng,
    'distancia_km', distancia, 'zona', zona, 'prazo_min', prazo, 'data', v_data, 'hora', v_hora,
    'pagamento', forma, 'troco_para', troco, 'observacoes', left(btrim(coalesce(p ->> 'observacoes', '')), 500),
    'antecedencia_horas', antecedencia, 'problemas', problemas);
end $$;

-- ==========================================================
-- SERIALIZAÇÃO
-- ==========================================================
create function public._pagamento_texto(forma text) returns text language sql immutable as $$
  select case forma when 'pix' then 'PIX' when 'dinheiro' then 'Dinheiro' when 'cartao_entrega' then 'Cartão (na entrega ou retirada)' else forma end
$$;

create function public._pedido_resumo(ped public.pedidos) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', ped.id, 'codigo', ped.codigo, 'status', ped.status, 'status_texto', public._status_texto(ped.status, ped.tipo), 'tipo', ped.tipo,
    'cliente', jsonb_build_object('id', ped.usuario_id, 'nome', ped.cliente_nome, 'telefone', ped.cliente_telefone),
    'endereco', ped.endereco, 'lat', ped.lat, 'lng', ped.lng, 'distancia_km', ped.distancia_km,
    'data', to_char(ped.data_agendada, 'YYYY-MM-DD'), 'hora', ped.hora_agendada,
    'pagamento', ped.pagamento, 'pagamento_texto', public._pagamento_texto(ped.pagamento), 'troco_para', ped.troco_para,
    'subtotal', ped.subtotal, 'taxa_entrega', ped.taxa_entrega, 'desconto', ped.desconto, 'total', ped.total,
    'cupom', ped.cupom, 'observacoes', ped.observacoes, 'motivo_cancelamento', ped.motivo_cancelamento,
    'criado_em', public._fmt(ped.criado_em), 'atualizado_em', public._fmt(ped.atualizado_em))
$$;

/** Resumo para listas: acrescenta quantidade de itens e se já foi avaliado. */
create function public._pedido_linha(ped public.pedidos) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public._pedido_resumo(ped) || jsonb_build_object(
    'qtd_itens', coalesce((select sum(qtd) from public.pedido_itens where pedido_id = ped.id), 0),
    'avaliado', exists (select 1 from public.avaliacoes where pedido_id = ped.id))
$$;

create function public._pedido_completo(pid bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ped public.pedidos; cfg jsonb := public._cfg(); r jsonb; av public.avaliacoes;
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
    'proximos', coalesce((select jsonb_agg(jsonb_build_object('status', s, 'texto', public._status_texto(s, ped.tipo)))
               from unnest(public._proximos(ped.status, ped.tipo)) as s), '[]'::jsonb));
  select * into av from public.avaliacoes where pedido_id = pid;
  r := r || jsonb_build_object('avaliacao', case when av.id is null then null else jsonb_build_object(
      'nota', av.nota, 'comentario', av.comentario, 'resposta', av.resposta, 'aprovada', av.aprovada, 'criado_em', public._fmt(av.criado_em)) end);
  -- dados para a tela montar o "PIX copia e cola" (a chave PIX é pública para quem vai pagar)
  if ped.pagamento = 'pix' and coalesce(cfg #>> '{pagamento,pix_chave}', '') <> '' and ped.status not in ('cancelado', 'entregue') then
    r := r || jsonb_build_object('pix', jsonb_build_object(
      'chave', cfg #>> '{pagamento,pix_chave}',
      'nome', coalesce(nullif(cfg #>> '{pagamento,pix_nome}', ''), cfg #>> '{loja,nome}'),
      'cidade', coalesce(nullif(cfg #>> '{pagamento,pix_cidade}', ''), cfg #>> '{loja,cidade}'),
      'valor', ped.total, 'identificador', ped.codigo));
  end if;
  return r;
end $$;

-- ==========================================================
-- MUDANÇA DE STATUS (usada pelo cliente e pelo painel)
-- ==========================================================
create function public._mudar_status(pid bigint, novo text, nota text, uid uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare ped public.pedidos; obs text := left(btrim(coalesce(nota, '')), 300);
begin
  select * into ped from public.pedidos where id = pid for update;
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  if not (novo = any (public._proximos(ped.status, ped.tipo))) then
    perform public._falha(409, 'Não é possível mudar de "' || public._status_texto(ped.status, ped.tipo)
      || '" para "' || public._status_texto(novo, ped.tipo) || '".');
  end if;
  if novo = 'cancelado' and obs = '' then
    perform public._falha(422, 'Informe o motivo do cancelamento.', 'nota');
  end if;
  update public.pedidos set status = novo, atualizado_em = now(),
         motivo_cancelamento = case when novo = 'cancelado' then obs else motivo_cancelamento end
   where id = pid;
  insert into public.pedido_historico (pedido_id, status, nota, usuario_id) values (pid, novo, nullif(obs, ''), uid);
  -- pedido cancelado devolve o uso do cupom
  if novo = 'cancelado' and ped.cupom is not null then
    update public.cupons set usos = greatest(usos - 1, 0) where upper(codigo) = upper(ped.cupom);
  end if;
end $$;

-- ==========================================================
-- API DO CLIENTE
-- ==========================================================
create function public.cliente_orcar_pedido(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  return public._calcular(u.id, p) - 'cupom_id';
end $$;

create function public.cliente_criar_pedido(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  u public.perfis := public._cliente(); c jsonb; pid bigint; n int; campos jsonb;
begin
  if (select count(*) from public.pedidos where usuario_id = u.id and criado_em > now() - interval '1 hour') >= 20 then
    perform public._falha(429, 'Você fez muitos pedidos em pouco tempo. Fale com a loja pelo WhatsApp.');
  end if;

  c := public._calcular(u.id, p);
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

create function public.cliente_pedidos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente();
begin
  return jsonb_build_object('pedidos', coalesce((select jsonb_agg(public._pedido_linha(x) order by x.id desc)
                                                  from public.pedidos x where x.usuario_id = u.id), '[]'::jsonb));
end $$;

create function public.cliente_pedido(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente(); pid bigint;
begin
  select id into pid from public.pedidos where codigo = p ->> 'codigo' and usuario_id = u.id;
  if pid is null then perform public._falha(404, 'Pedido não encontrado.'); end if;
  return jsonb_build_object('pedido', public._pedido_completo(pid));
end $$;

create function public.cliente_cancelar_pedido(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente(); ped public.pedidos;
begin
  select * into ped from public.pedidos where codigo = p ->> 'codigo' and usuario_id = u.id;
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  if ped.status <> 'novo' then
    perform public._falha(409, 'Este pedido já foi confirmado e não pode mais ser cancelado por aqui. Fale com a loja pelo WhatsApp.');
  end if;
  perform public._mudar_status(ped.id, 'cancelado', coalesce(nullif(btrim(p ->> 'motivo'), ''), 'Cancelado pelo cliente'), u.id);
  return jsonb_build_object('pedido', public._pedido_completo(ped.id));
end $$;

create function public.cliente_avaliar_pedido(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare u public.perfis := public._cliente(); ped public.pedidos; v_nota int; v_com text;
begin
  v_nota := public._v_int(p, 'nota', 1, 5, 'Nota');
  v_com  := public._v_txt(p, 'comentario', 0, 500, 'Comentário');
  select * into ped from public.pedidos where codigo = p ->> 'codigo' and usuario_id = u.id;
  if not found then perform public._falha(404, 'Pedido não encontrado.'); end if;
  if ped.status <> 'entregue' then perform public._falha(409, 'Você só pode avaliar pedidos já entregues.'); end if;
  if exists (select 1 from public.avaliacoes where pedido_id = ped.id) then perform public._falha(409, 'Você já avaliou este pedido.'); end if;
  insert into public.avaliacoes (pedido_id, usuario_id, nota, comentario) values (ped.id, u.id, v_nota, nullif(v_com, ''));
  return jsonb_build_object('pedido', public._pedido_completo(ped.id));
end $$;

