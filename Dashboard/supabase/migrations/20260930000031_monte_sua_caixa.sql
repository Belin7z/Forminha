-- ==========================================================
-- 31) MONTE SUA CAIXA — um grupo de opções do tipo "quantidade":
-- a caixa tem um total certo (ex.: 25 docinhos) e o cliente diz
-- quantos de cada sabor quer. O banco confere a soma (tem que dar
-- o total), cobra o adicional de cada sabor por unidade e guarda
-- no pedido "10× Ninho, 15× Beijinho".
--   • no produto: { tipo: "quantidade", total: 25, itens: [...] }
--   • na escolha: { "g1": { "g1i1": 10, "g1i2": 15 } }
--   • no pedido:  { grupo, itens: [{ nome, preco, qtd }] }
-- O estoque passa a descontar a receita de cada sabor pelo número
-- de unidades dele na caixa.
-- ==========================================================

/* ---------- Opções do produto (painel): aceita o tipo "quantidade" ---------- */
-- Igual à 0006 + o tipo novo (sempre obrigatório, com o total da caixa).
create or replace function public._normalizar_opcoes(p jsonb) returns jsonb
language plpgsql immutable as $$
declare g jsonb; it jsonb; gi int := 0; ii int; itens jsonb; res jsonb := '[]'::jsonb; nome_g text; tp text; mx int; preco bigint; tot int;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) = 0 then return '[]'::jsonb; end if;
  if jsonb_array_length(p) > 8 then perform public._falha(422, 'Use no máximo 8 grupos de opções.'); end if;
  for g in select value from jsonb_array_elements(p) loop
    gi := gi + 1;
    nome_g := public._v_txt(g, 'nome', 1, 60, 'Nome do grupo de opções');
    if jsonb_typeof(g -> 'itens') is distinct from 'array' or jsonb_array_length(g -> 'itens') = 0 then
      perform public._falha(422, 'O grupo "' || nome_g || '" precisa de pelo menos uma opção.');
    end if;
    if jsonb_array_length(g -> 'itens') > 30 then
      perform public._falha(422, 'O grupo "' || nome_g || '" tem opções demais (máximo 30).');
    end if;
    tp := case when g ->> 'tipo' in ('multipla', 'quantidade') then g ->> 'tipo' else 'unica' end;
    itens := '[]'::jsonb; ii := 0;
    for it in select value from jsonb_array_elements(g -> 'itens') loop
      ii := ii + 1;
      preco := coalesce(public._v_int(it, 'preco', 0, 1000000, 'Preço da opção', true), 0);
      itens := itens || jsonb_build_array(jsonb_build_object(
        'id', format('g%si%s', gi, ii), 'nome', public._v_txt(it, 'nome', 1, 60, 'Nome da opção'), 'preco', preco));
    end loop;
    if tp = 'quantidade' then
      if coalesce(g ->> 'total', '') !~ '^\d{1,4}$' or (g ->> 'total')::int not between 2 and 500 then
        perform public._falha(422, 'O grupo "' || nome_g || '": informe quantas unidades vão na caixa (de 2 a 500).', 'total');
      end if;
      tot := (g ->> 'total')::int;
      res := res || jsonb_build_array(jsonb_build_object(
        'id', 'g' || gi, 'nome', nome_g, 'tipo', tp, 'obrigatorio', true, 'max', null, 'total', tot, 'itens', itens));
      continue;
    end if;
    mx := case when tp = 'multipla' and (g ->> 'max') ~ '^\d+$' and (g ->> 'max')::int > 0
                then least((g ->> 'max')::int, jsonb_array_length(itens)) end;
    res := res || jsonb_build_array(jsonb_build_object(
      'id', 'g' || gi, 'nome', nome_g, 'tipo', tp, 'obrigatorio', public._v_bool(g, 'obrigatorio'), 'max', mx, 'itens', itens));
  end loop;
  return res;
end $$;

/* ---------- Opções escolhidas (pedido): confere a caixa ---------- */
-- Igual à 0004 + o tipo "quantidade".
create or replace function public._resolver_opcoes(nome_produto text, opcoes jsonb, selecao jsonb) returns jsonb
language plpgsql stable as $$
declare
  g jsonb; it jsonb; escolhidos text[]; extras bigint := 0; descricao jsonb := '[]'::jsonb; itens_sel jsonb; n_ok int; qtd_esc int;
  sel jsonb; par record; n int; soma int; total int; achado jsonb;
begin
  selecao := case when jsonb_typeof(selecao) = 'object' then selecao else '{}'::jsonb end;
  for g in select value from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) loop

    if g ->> 'tipo' = 'quantidade' then
      total := (g ->> 'total')::int;
      sel := case when jsonb_typeof(selecao -> (g ->> 'id')) = 'object' then selecao -> (g ->> 'id') else '{}'::jsonb end;
      soma := 0; itens_sel := '[]'::jsonb;
      for par in select key, value from jsonb_each(sel) loop
        if jsonb_typeof(par.value) <> 'number' or (par.value #>> '{}') !~ '^\d{1,4}$' then
          perform public._falha(422, nome_produto || ': quantidade inválida em "' || (g ->> 'nome') || '".');
        end if;
        n := (par.value #>> '{}')::int;
        if n = 0 then continue; end if;
        select value into achado from jsonb_array_elements(g -> 'itens') where value ->> 'id' = par.key;
        if achado is null then
          perform public._falha(422, nome_produto || ': opção inválida em "' || (g ->> 'nome') || '". Atualize a página.');
        end if;
        extras := extras + (achado ->> 'preco')::bigint * n;
        soma := soma + n;
        itens_sel := itens_sel || jsonb_build_array(jsonb_build_object('nome', achado ->> 'nome', 'preco', (achado ->> 'preco')::int, 'qtd', n));
        achado := null;
      end loop;
      if soma <> total then
        perform public._falha(422, nome_produto || ': escolha ' || total || ' unidades em "' || (g ->> 'nome') || '" (você escolheu ' || soma || ').');
      end if;
      descricao := descricao || jsonb_build_array(jsonb_build_object('grupo', g ->> 'nome', 'itens', itens_sel));
      continue;
    end if;

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

/* ---------- Estoque: a receita de cada sabor conta pelo número de unidades na caixa ---------- */
-- Igual à 0017; a linha de opção vale 1 vez por unidade do produto (opção comum) ou "qtd" vezes (sabor da caixa).
create or replace function public._consumo_item(prod bigint, qtd numeric, opcoes jsonb) returns table (ingrediente_id bigint, quantidade numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.ingrediente_id,
         sum(qtd * x.quantidade * case when x.opcao_grupo is null then 1.0 / r.rendimento else m.vezes end * (1 + r.perda_pct / 100))
    from public.receitas r
    join public._ficha_expandida() x on x.produto_id = r.produto_id
    left join lateral (
      select sum(case when (it ->> 'qtd') ~ '^\d+$' then (it ->> 'qtd')::numeric else 1 end) as vezes
        from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) g, jsonb_array_elements(coalesce(g -> 'itens', '[]'::jsonb)) it
       where g ->> 'grupo' = x.opcao_grupo and it ->> 'nome' = x.opcao_item) m on true
   where r.produto_id = prod
     and (x.opcao_grupo is null or coalesce(m.vezes, 0) > 0)
   group by x.ingrediente_id
$$;
