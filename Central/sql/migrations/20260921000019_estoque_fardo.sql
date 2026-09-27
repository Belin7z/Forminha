-- ==========================================================
-- 19) ESTOQUE: COMPRA EM FARDO (CAIXA/FARDO COM VÁRIAS EMBALAGENS)
--     Além da embalagem (ex.: "pacote de 1 kg"), o ingrediente pode
--     ter um fardo opcional (ex.: "fardo com 10 pacotes"), do jeito
--     que se compra no atacado. Lançamentos podem ser feitos em
--     fardo ou em embalagem; por dentro, tudo vira a mesma unidade
--     de sempre (g/ml/un) — nada muda em receita, custo ou previsão.
--     fardo_qtd = 0 quer dizer "não compra em fardo" (padrão).
-- ==========================================================

alter table public.ingredientes
  add column fardo_nome  text not null default 'fardo',
  add column fardo_qtd   numeric(14, 3) not null default 0 check (fardo_qtd >= 0),
  add column fardo_preco int not null default 0 check (fardo_preco >= 0);

create or replace function public._ingrediente_json(i public.ingredientes) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', i.id, 'nome', i.nome, 'unidade', i.unidade, 'estoque', i.estoque, 'minimo', i.minimo,
    'embalagem_qtd', i.embalagem_qtd, 'embalagem_nome', i.embalagem_nome, 'embalagem_preco', i.embalagem_preco,
    'fornecedor', i.fornecedor, 'ativo', i.ativo, 'medidas', i.medidas, 'local', i.local,
    'fardo_nome', i.fardo_nome, 'fardo_qtd', i.fardo_qtd, 'fardo_preco', i.fardo_preco,
    'custo_unit', round(i.embalagem_preco::numeric / i.embalagem_qtd, 6),
    'valor_estoque', round(greatest(i.estoque, 0) * i.embalagem_preco / i.embalagem_qtd),
    'proxima_validade', (select to_char(min(l.validade), 'YYYY-MM-DD') from public.estoque_lotes l where l.ingrediente_id = i.id),
    'receitas', (select count(distinct x.produto_id) from public._ficha_expandida() x where x.ingrediente_id = i.id),
    'preparos', (select count(*) from public.preparo_itens pi where pi.ingrediente_id = i.id),
    'fardo_custo_unit', case when i.fardo_qtd > 0 then round(i.fardo_preco::numeric / (i.fardo_qtd * i.embalagem_qtd), 6) end,
    'fardo_economia_pct', case when i.fardo_qtd > 0 and i.fardo_preco > 0 and i.embalagem_preco > 0
      then round((1 - (i.fardo_preco::numeric / (i.fardo_qtd * i.embalagem_qtd)) / (i.embalagem_preco::numeric / i.embalagem_qtd)) * 100, 1) end)
$$;

create or replace function public.admin_salvar_ingrediente(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  iid bigint := public._v_int(p, 'id', 1, 9223372036854775807, 'Ingrediente', true);
  v_nome text := public._v_txt(p, 'nome', 1, 80, 'Nome');
  v_un text := public._v_opcao(p, 'unidade', array['g', 'ml', 'un'], 'Unidade');
  v_min numeric := round(coalesce(public._v_num(p, 'minimo', 0, 10000000, 'Estoque mínimo', true), 0)::numeric, 3);
  v_qtd numeric := round(coalesce(public._v_num(p, 'embalagem_qtd', 0.001, 10000000, 'Quantidade da embalagem', true), 1)::numeric, 3);
  v_emb text := coalesce(nullif(public._v_txt(p, 'embalagem_nome', 0, 30, 'Nome da embalagem'), ''), 'embalagem');
  v_preco int := coalesce(public._v_int(p, 'embalagem_preco', 0, 100000000, 'Preço da embalagem', true), 0);
  v_forn text := public._v_txt(p, 'fornecedor', 0, 80, 'Fornecedor');
  v_ativo boolean := case when p ? 'ativo' then public._v_bool(p, 'ativo') else true end;
  v_ini numeric := round(coalesce(public._v_num(p, 'estoque', 0, 10000000, 'Estoque atual', true), 0)::numeric, 3);
  v_val date := public._v_data(p, 'validade', true);
  v_local text := case when p ? 'local' then public._v_txt(p, 'local', 0, 40, 'Local') end;
  v_fardo_nome text := coalesce(nullif(public._v_txt(p, 'fardo_nome', 0, 30, 'Nome do fardo'), ''), 'fardo');
  v_fardo_qtd numeric := round(coalesce(public._v_num(p, 'fardo_qtd', 0, 100000, 'Embalagens por fardo', true), 0)::numeric, 3);
  v_fardo_preco int := coalesce(public._v_int(p, 'fardo_preco', 0, 100000000, 'Preço do fardo', true), 0);
  v_med jsonb;
  atual public.ingredientes; novo public.ingredientes;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if v_fardo_qtd = 0 then v_fardo_preco := 0; end if; -- sem fardo, não faz sentido guardar preço de fardo
  if p ? 'medidas' then
    if jsonb_typeof(p -> 'medidas') <> 'array' or jsonb_array_length(p -> 'medidas') > 8 then
      perform public._falha(422, 'Medidas caseiras: no máximo 8.', 'medidas');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('nome', public._v_txt(m, 'nome', 1, 20, 'Nome da medida'),
                                                 'qtd', round(public._v_num(m, 'qtd', 0.001, 10000000, 'Quantidade da medida')::numeric, 3))), '[]'::jsonb)
      into v_med from jsonb_array_elements(p -> 'medidas') m;
  end if;
  if exists (select 1 from public.ingredientes where lower(nome) = lower(v_nome) and id is distinct from iid) then
    perform public._falha(409, 'Já existe um ingrediente com esse nome.', 'nome');
  end if;
  if iid is null then
    if (select count(*) from public.ingredientes) >= 1000 then perform public._falha(422, 'Limite de 1000 ingredientes atingido.'); end if;
    insert into public.ingredientes (nome, unidade, estoque, minimo, embalagem_qtd, embalagem_nome, embalagem_preco, fornecedor, ativo, medidas, local,
        fardo_nome, fardo_qtd, fardo_preco)
    values (v_nome, v_un, 0, v_min, v_qtd, v_emb, v_preco, v_forn, v_ativo, coalesce(v_med, '[]'::jsonb), coalesce(v_local, ''),
        v_fardo_nome, v_fardo_qtd, v_fardo_preco) returning * into novo;
    if v_ini > 0 then
      novo := public._estoque_lancar(novo.id, 'inicial', v_ini, adm.id, null, 'Estoque inicial', v_val);
    end if;
  else
    select * into atual from public.ingredientes where id = iid for update;
    if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;
    if atual.unidade <> v_un and (exists (select 1 from public.ficha_itens where ingrediente_id = iid)
                                  or exists (select 1 from public.preparo_itens where ingrediente_id = iid)
                                  or exists (select 1 from public.estoque_movimentos where ingrediente_id = iid)) then
      perform public._falha(409, 'Não dá para trocar a unidade de um ingrediente que já tem receita ou histórico. Crie outro ingrediente.', 'unidade');
    end if;
    update public.ingredientes set nome = v_nome, unidade = v_un, minimo = v_min, embalagem_qtd = v_qtd, embalagem_nome = v_emb,
           embalagem_preco = v_preco, fornecedor = v_forn, ativo = v_ativo, medidas = coalesce(v_med, atual.medidas),
           local = coalesce(v_local, atual.local), fardo_nome = v_fardo_nome, fardo_qtd = v_fardo_qtd, fardo_preco = v_fardo_preco,
           atualizado_em = now()
     where id = iid returning * into novo;
  end if;
  return jsonb_build_object('ingrediente', public._ingrediente_json(novo));
end $$;

-- Lançamento avulso: agora pode ser em "embalagem" (padrão) ou em "fardo".
create or replace function public.admin_estoque_movimentar(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin();
  ing public.ingredientes;
  v_tipo text := public._v_opcao(p, 'tipo', array['compra', 'ajuste', 'perda'], 'Tipo de lançamento');
  v_forma text := case when p ? 'forma' then public._v_opcao(p, 'forma', array['embalagem', 'fardo'], 'Forma de compra') else 'embalagem' end;
  v_nota text := public._v_txt(p, 'nota', 0, 200, 'Observação');
  v_val date := public._v_data(p, 'validade', true);
  delta numeric; emb numeric; mult numeric; valor int; alvo numeric; preco_novo int;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  select * into ing from public.ingredientes where id = public._v_int(p, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente') for update;
  if not found then perform public._falha(404, 'Ingrediente não encontrado.'); end if;

  if v_tipo = 'compra' then
    if v_forma = 'fardo' and ing.fardo_qtd = 0 then
      perform public._falha(422, 'Este ingrediente não tem fardo cadastrado. Cadastre-o na edição do ingrediente.', 'forma');
    end if;
    mult := case when v_forma = 'fardo' then ing.fardo_qtd else 1 end;
    emb := round(public._v_num(p, 'embalagens', 0.001, 100000, 'Quantidade comprada')::numeric, 3);
    delta := round(emb * mult * ing.embalagem_qtd, 3);
    valor := public._v_int(p, 'valor', 0, 1000000000, 'Valor pago', true);
    if valor is not null and valor > 0 then preco_novo := greatest(round(valor::numeric / (emb * mult))::int, 0); end if;
  elsif v_tipo = 'perda' then
    delta := -round(public._v_num(p, 'quantidade', 0.001, 10000000, 'Quantidade perdida')::numeric, 3);
  else
    alvo := round(public._v_num(p, 'novo_estoque', 0, 10000000, 'Quantidade contada')::numeric, 3);
    delta := alvo - ing.estoque;
    if delta = 0 then return jsonb_build_object('ingrediente', public._ingrediente_json(ing), 'sem_mudanca', true); end if;
  end if;

  ing := public._estoque_lancar(ing.id, v_tipo, delta, adm.id, case when v_tipo = 'compra' and valor > 0 then valor end, v_nota, v_val, preco_novo);
  return jsonb_build_object('ingrediente', public._ingrediente_json(ing));
end $$;

-- Compra recebida em lote: cada item também pode vir em "fardo".
create or replace function public.admin_estoque_receber_compra(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); itens jsonb := coalesce(p -> 'itens', '[]'::jsonb); it jsonb; v_forma text;
  v_nota text := public._v_txt(p, 'nota', 0, 120, 'Nota ou fornecedor');
  ing public.ingredientes; emb numeric; mult numeric; valor int; preco_novo int; total bigint := 0; n int := 0; vistos bigint[] := '{}'; iid bigint;
begin
  perform public._limitar('estoque_gravar', 60, 60);
  if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then perform public._falha(422, 'Informe pelo menos um item comprado.', 'itens'); end if;
  if jsonb_array_length(itens) > 60 then perform public._falha(422, 'No máximo 60 itens por compra.', 'itens'); end if;
  for it in select value from jsonb_array_elements(itens) loop
    iid := public._v_int(it, 'ingrediente_id', 1, 9223372036854775807, 'Ingrediente');
    if iid = any (vistos) then perform public._falha(422, 'O mesmo ingrediente aparece duas vezes na compra. Junte em uma linha.', 'itens'); end if;
    vistos := vistos || iid;
    select * into ing from public.ingredientes where id = iid for update;
    if not found then perform public._falha(404, 'Um dos ingredientes não existe mais. Atualize a página.', 'itens'); end if;
    v_forma := case when it ? 'forma' then public._v_opcao(it, 'forma', array['embalagem', 'fardo'], 'Forma de compra de ' || ing.nome) else 'embalagem' end;
    if v_forma = 'fardo' and ing.fardo_qtd = 0 then
      perform public._falha(422, ing.nome || ' não tem fardo cadastrado.', 'itens');
    end if;
    mult := case when v_forma = 'fardo' then ing.fardo_qtd else 1 end;
    emb := round(public._v_num(it, 'embalagens', 0.001, 100000, 'Quantidade de ' || ing.nome)::numeric, 3);
    valor := public._v_int(it, 'valor', 0, 1000000000, 'Valor de ' || ing.nome, true);
    preco_novo := case when valor is not null and valor > 0 then greatest(round(valor::numeric / (emb * mult))::int, 0) end;
    perform public._estoque_lancar(ing.id, 'compra', round(emb * mult * ing.embalagem_qtd, 3), adm.id, case when valor > 0 then valor end, v_nota,
                                   public._v_data(it, 'validade', true), preco_novo);
    total := total + coalesce(valor, 0);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'itens', n, 'total', total);
end $$;
