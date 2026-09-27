-- ==========================================================
-- 12) EXTRAS DOS PRODUTOS
--     Alérgenos, fotos extras, limite de unidades por dia e
--     período de venda (ovos de Páscoa, panetone…).
-- ==========================================================

alter table public.produtos
  add column alergenos       text[] not null default '{}',
  add column galeria         jsonb  not null default '[]'::jsonb,
  add column limite_diario   int check (limite_diario is null or limite_diario >= 1),
  add column disponivel_de   date,
  add column disponivel_ate  date,
  add constraint produtos_periodo_ck check (disponivel_de is null or disponivel_ate is null or disponivel_de <= disponivel_ate);

/* Os novos campos passam a viajar junto com o produto (vitrine e painel). */
create or replace function public._produto_json(pr public.produtos) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', pr.id, 'categoria_id', pr.categoria_id, 'nome', pr.nome, 'descricao', pr.descricao, 'preco', pr.preco,
    'unidade', pr.unidade, 'min_qtd', pr.min_qtd, 'emoji', pr.emoji, 'imagem', pr.imagem, 'tag', pr.tag,
    'opcoes', pr.opcoes, 'antecedencia_horas', pr.antecedencia_horas, 'ativo', pr.ativo,
    'destaque', pr.destaque, 'ordem', pr.ordem,
    'alergenos', to_jsonb(pr.alergenos), 'galeria', pr.galeria, 'limite_diario', pr.limite_diario,
    'disponivel_de', to_char(pr.disponivel_de, 'YYYY-MM-DD'), 'disponivel_ate', to_char(pr.disponivel_ate, 'YYYY-MM-DD'))
$$;

/* ---------- Salvar produto: a função original vira auxiliar interno ---------- */
alter function public.admin_salvar_produto(jsonb) rename to _salvar_produto_base;
revoke execute on function public._salvar_produto_base(jsonb) from public, anon, authenticated;

create function public.admin_salvar_produto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); r jsonb; pid bigint; cur public.produtos;
  al text[]; gal jsonb; g text; lim int; de date; ate date; removidas jsonb := '[]'::jsonb; antigas jsonb;
begin
  -- valida os extras antes de gravar qualquer coisa (o erro desfaz tudo)
  if p ? 'alergenos' then
    if jsonb_typeof(p -> 'alergenos') is distinct from 'array' then perform public._falha(422, 'Alérgenos inválidos.', 'alergenos'); end if;
    al := array(select x from (select distinct jsonb_array_elements_text(p -> 'alergenos') as x) t order by x);
    if exists (select 1 from unnest(al) a where a <> all (array['gluten', 'leite', 'ovos', 'soja', 'amendoim', 'oleaginosas'])) then
      perform public._falha(422, 'Alérgeno inválido.', 'alergenos');
    end if;
  end if;
  if p ? 'galeria' then
    if jsonb_typeof(p -> 'galeria') is distinct from 'array' then perform public._falha(422, 'Fotos extras inválidas.', 'galeria'); end if;
    if jsonb_array_length(p -> 'galeria') > 4 then perform public._falha(422, 'Use até 4 fotos extras por produto.', 'galeria'); end if;
    gal := '[]'::jsonb;
    for g in select jsonb_array_elements_text(p -> 'galeria') loop
      if g !~ '^https?://[^/\s]+/storage/v1/object/public/produtos/[A-Za-z0-9._/-]+$' then
        perform public._falha(422, 'Foto extra inválida. Envie a foto pelo painel.', 'galeria');
      end if;
      if not gal @> to_jsonb(g) then gal := gal || to_jsonb(g); end if;
    end loop;
  end if;
  if p ? 'limite_diario' then lim := public._v_int(p, 'limite_diario', 1, 100000, 'Limite diário', true); end if;
  if p ? 'disponivel_de' then de := public._v_data(p, 'disponivel_de', true); end if;
  if p ? 'disponivel_ate' then ate := public._v_data(p, 'disponivel_ate', true); end if;

  r := public._salvar_produto_base(p);
  pid := (r -> 'produto' ->> 'id')::bigint;
  select * into cur from public.produtos where id = pid;

  de  := case when p ? 'disponivel_de' then de else cur.disponivel_de end;
  ate := case when p ? 'disponivel_ate' then ate else cur.disponivel_ate end;
  if de is not null and ate is not null and de > ate then
    perform public._falha(422, 'O fim do período deve ser depois do início.', 'disponivel_ate');
  end if;
  antigas := cur.galeria;
  update public.produtos set
    alergenos = case when p ? 'alergenos' then al else cur.alergenos end,
    galeria = case when p ? 'galeria' then gal else cur.galeria end,
    limite_diario = case when p ? 'limite_diario' then lim else cur.limite_diario end,
    disponivel_de = de, disponivel_ate = ate
   where id = pid;

  if p ? 'galeria' then
    select coalesce(jsonb_agg(u), '[]'::jsonb) into removidas from jsonb_array_elements(antigas) u where not gal @> u;
  end if;
  return jsonb_build_object('produto', public._produto_admin(pid), 'imagem_removida', r ->> 'imagem_removida', 'galeria_removida', removidas);
end $$;

/* Excluir também devolve as fotos extras, para o painel limpar o Storage. */
create or replace function public.admin_excluir_produto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pid bigint := (p ->> 'id')::bigint; img text; gal jsonb;
begin
  select imagem, galeria into img, gal from public.produtos where id = pid;
  if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  delete from public.produtos where id = pid; -- pedidos antigos mantêm nome e preço gravados
  return jsonb_build_object('ok', true, 'imagem_removida', img, 'galeria_removida', gal);
end $$;

/* ---------- Regras no pedido do cliente: período de venda e limite por dia ---------- */
create or replace function public._calcular_extra(uid uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c jsonb := public._calcular(uid, p); cfg jsonb := public._cfg();
  dia date; maximo int := coalesce((cfg #>> '{agenda,max_pedidos_dia}')::int, 0); cupom_tipo text;
  it record; pr public.produtos; usado bigint;
begin
  if (c ->> 'data') ~ '^\d{4}-\d{2}-\d{2}$' then
    dia := (c ->> 'data')::date;
    if exists (select 1 from public.datas_bloqueadas where data = dia) then
      c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data', 'Não estamos agendando para este dia. Escolha outra data.'));
    elsif maximo > 0 and (select count(*) from public.pedidos where data_agendada = dia and status <> 'cancelado') >= maximo then
      c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data', 'A agenda deste dia já está cheia. Escolha outra data.'));
    end if;

    for it in select x.produto_id, sum(x.qtd) as qtd
                from jsonb_to_recordset(c -> 'itens') as x(produto_id bigint, qtd int) group by x.produto_id loop
      select * into pr from public.produtos where id = it.produto_id;
      if not found then continue; end if;
      if pr.disponivel_de is not null and dia < pr.disponivel_de then
        c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data',
          pr.nome || ' só pode ser encomendado para datas a partir de ' || to_char(pr.disponivel_de, 'DD/MM') || '.'));
      end if;
      if pr.disponivel_ate is not null and dia > pr.disponivel_ate then
        c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'data',
          pr.nome || ' só pode ser encomendado para datas até ' || to_char(pr.disponivel_ate, 'DD/MM') || '.'));
      end if;
      if pr.limite_diario is not null then
        select coalesce(sum(i.qtd), 0) into usado from public.pedido_itens i join public.pedidos o on o.id = i.pedido_id
         where i.produto_id = pr.id and o.data_agendada = dia and o.status <> 'cancelado';
        if usado + it.qtd > pr.limite_diario then
          c := jsonb_set(c, '{problemas}', public._prob(c -> 'problemas', 'itens',
            case when usado >= pr.limite_diario then pr.nome || ' está esgotado para este dia.'
                 else pr.nome || ': restam apenas ' || (pr.limite_diario - usado) || ' unidade(s) para este dia.' end));
        end if;
      end if;
    end loop;
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

/* ---------- Permissões ---------- */
grant execute on function public.admin_salvar_produto(jsonb) to authenticated;
