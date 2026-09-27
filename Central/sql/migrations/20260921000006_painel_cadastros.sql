-- ==========================================================
-- 6) PAINEL — cardápio, clientes, cupons, avaliações,
--    configurações, entrega e equipe
-- ==========================================================

-- ---------------- Opções do produto (tamanho, recheio…) ----------------
create function public._normalizar_opcoes(p jsonb) returns jsonb
language plpgsql immutable as $$
declare g jsonb; it jsonb; gi int := 0; ii int; itens jsonb; res jsonb := '[]'::jsonb; nome_g text; tp text; mx int; preco bigint;
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
    tp := case when g ->> 'tipo' = 'multipla' then 'multipla' else 'unica' end;
    itens := '[]'::jsonb; ii := 0;
    for it in select value from jsonb_array_elements(g -> 'itens') loop
      ii := ii + 1;
      preco := coalesce(public._v_int(it, 'preco', 0, 1000000, 'Preço da opção', true), 0);
      itens := itens || jsonb_build_array(jsonb_build_object(
        'id', format('g%si%s', gi, ii), 'nome', public._v_txt(it, 'nome', 1, 60, 'Nome da opção'), 'preco', preco));
    end loop;
    mx := case when tp = 'multipla' and (g ->> 'max') ~ '^\d+$' and (g ->> 'max')::int > 0
                then least((g ->> 'max')::int, jsonb_array_length(itens)) end;
    res := res || jsonb_build_array(jsonb_build_object(
      'id', 'g' || gi, 'nome', nome_g, 'tipo', tp, 'obrigatorio', public._v_bool(g, 'obrigatorio'), 'max', mx, 'itens', itens));
  end loop;
  return res;
end $$;

-- ---------------- Categorias ----------------
create function public._categorias_admin() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('categorias', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'emoji', c.emoji, 'ordem', c.ordem, 'ativa', c.ativa,
      'produtos', (select count(*) from public.produtos pr where pr.categoria_id = c.id)) order by c.ordem, c.id), '[]'::jsonb))
    from public.categorias c
$$;

create function public.admin_categorias(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin return public._categorias_admin(); end $$;

create function public.admin_salvar_categoria(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cid bigint := nullif(p ->> 'id', '')::bigint;
  v_nome text; v_emoji text; v_ativa boolean;
begin
  v_nome := public._v_txt(p, 'nome', 2, 50, 'Nome');
  v_emoji := coalesce(nullif(public._v_txt(p, 'emoji', 0, 8, 'Emoji'), ''), '🍰');
  v_ativa := public._v_bool(p, 'ativa');
  if cid is null then
    insert into public.categorias (nome, emoji, ordem, ativa)
    values (v_nome, v_emoji, coalesce((select max(ordem) + 1 from public.categorias), 0), v_ativa);
  else
    if not exists (select 1 from public.categorias where id = cid) then perform public._falha(404, 'Categoria não encontrada.'); end if;
    update public.categorias set nome = v_nome, emoji = v_emoji, ativa = v_ativa where id = cid;
  end if;
  return public._categorias_admin();
end $$;

create function public.admin_excluir_categoria(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); cid bigint := (p ->> 'id')::bigint;
begin
  if exists (select 1 from public.produtos where categoria_id = cid) then
    perform public._falha(409, 'Esta categoria tem produtos. Mova ou exclua os produtos antes, ou apenas desative a categoria.');
  end if;
  delete from public.categorias where id = cid;
  return public._categorias_admin();
end $$;

create function public.admin_ordenar_categorias(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  if jsonb_typeof(p -> 'ids') is distinct from 'array' or jsonb_array_length(p -> 'ids') = 0 then
    perform public._falha(422, 'Lista de categorias inválida.');
  end if;
  update public.categorias c set ordem = o.pos - 1
    from (select value::bigint as id, ordinality as pos from jsonb_array_elements_text(p -> 'ids') with ordinality) o
   where c.id = o.id;
  return public._categorias_admin();
end $$;

-- ---------------- Produtos ----------------
create function public._produto_admin(pid bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public._produto_json(pr) || jsonb_build_object(
    'favoritos', (select count(*) from public.favoritos f where f.produto_id = pr.id),
    'vendidos', coalesce((select sum(i.qtd) from public.pedido_itens i join public.pedidos o on o.id = i.pedido_id
                           where i.produto_id = pr.id and o.status <> 'cancelado'), 0))
    from public.produtos pr where pr.id = pid
$$;

create function public.admin_produtos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return jsonb_build_object('produtos', coalesce((select jsonb_agg(public._produto_admin(pr.id) order by pr.categoria_id, pr.ordem, pr.id)
                                                    from public.produtos pr), '[]'::jsonb));
end $$;

/** Cria (sem `id`) ou edita (com `id`). `imagem`: ausente = mantém; null = remove; texto = URL do Storage. */
create function public.admin_salvar_produto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); pid bigint := nullif(p ->> 'id', '')::bigint; atual public.produtos;
  v_cat bigint; v_nome text; v_desc text; v_preco int; v_un text; v_min int; v_emoji text; v_tag text; v_ant int;
  v_ativo boolean; v_dest boolean; v_op jsonb; v_img text; removida text;
begin
  if pid is not null then
    select * into atual from public.produtos where id = pid;
    if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  end if;
  v_cat  := public._v_int(p, 'categoria_id', 1, 9000000000000000000, 'Categoria');
  if not exists (select 1 from public.categorias where id = v_cat) then perform public._falha(422, 'Escolha uma categoria válida.', 'categoria_id'); end if;
  v_nome := public._v_txt(p, 'nome', 2, 80, 'Nome');
  v_desc := public._v_txt(p, 'descricao', 0, 400, 'Descrição');
  v_preco := public._v_int(p, 'preco', 0, 10000000, 'Preço');
  v_un   := public._v_txt(p, 'unidade', 1, 30, 'Unidade');
  v_min  := public._v_int(p, 'min_qtd', 1, 999, 'Pedido mínimo');
  v_emoji := coalesce(nullif(public._v_txt(p, 'emoji', 0, 8, 'Emoji'), ''), '🍰');
  v_tag  := nullif(public._v_txt(p, 'tag', 0, 20, 'Selo'), '');
  v_ant  := public._v_int(p, 'antecedencia_horas', 0, 720, 'Antecedência', true);
  v_ativo := public._v_bool(p, 'ativo'); v_dest := public._v_bool(p, 'destaque');
  v_op   := public._normalizar_opcoes(p -> 'opcoes');

  v_img := atual.imagem;
  if p ? 'imagem' then
    if jsonb_typeof(p -> 'imagem') = 'null' or coalesce(p ->> 'imagem', '') = '' then v_img := null;
    else
      v_img := p ->> 'imagem';
      -- só aceita imagens que estão no bucket "produtos" do nosso Storage
      if v_img !~ '^https?://[^/\s]+/storage/v1/object/public/produtos/[A-Za-z0-9._/-]+$' then
        perform public._falha(422, 'Imagem inválida. Envie a foto pelo painel.', 'imagem');
      end if;
    end if;
  end if;
  if atual.imagem is not null and atual.imagem is distinct from v_img then removida := atual.imagem; end if;

  if pid is null then
    insert into public.produtos (categoria_id, nome, descricao, preco, unidade, min_qtd, emoji, imagem, tag, opcoes, antecedencia_horas, ativo, destaque, ordem)
    values (v_cat, v_nome, v_desc, v_preco, v_un, v_min, v_emoji, v_img, v_tag, v_op, v_ant, v_ativo, v_dest,
            coalesce((select max(ordem) + 1 from public.produtos where categoria_id = v_cat), 0))
    returning id into pid;
  else
    update public.produtos set categoria_id = v_cat, nome = v_nome, descricao = v_desc, preco = v_preco, unidade = v_un, min_qtd = v_min,
           emoji = v_emoji, imagem = v_img, tag = v_tag, opcoes = v_op, antecedencia_horas = v_ant, ativo = v_ativo, destaque = v_dest,
           atualizado_em = now()
     where id = pid;
  end if;
  return jsonb_build_object('produto', public._produto_admin(pid), 'imagem_removida', removida);
end $$;

create function public.admin_alternar_produto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pid bigint := (p ->> 'id')::bigint; campo text; v boolean := public._v_bool(p, 'valor');
begin
  campo := public._v_opcao(p, 'campo', array['ativo', 'destaque'], 'Campo');
  if not exists (select 1 from public.produtos where id = pid) then perform public._falha(404, 'Produto não encontrado.'); end if;
  if campo = 'ativo' then update public.produtos set ativo = v, atualizado_em = now() where id = pid;
  else update public.produtos set destaque = v, atualizado_em = now() where id = pid; end if;
  return jsonb_build_object('produto', public._produto_admin(pid));
end $$;

create function public.admin_excluir_produto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); pid bigint := (p ->> 'id')::bigint; img text;
begin
  select imagem into img from public.produtos where id = pid;
  if not found then perform public._falha(404, 'Produto não encontrado.'); end if;
  delete from public.produtos where id = pid; -- pedidos antigos mantêm nome e preço gravados
  return jsonb_build_object('ok', true, 'imagem_removida', img);
end $$;

-- ---------------- Clientes ----------------
create function public._cliente_admin(u public.perfis) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email, 'telefone', coalesce(u.telefone, ''), 'ativo', u.ativo,
    'criado_em', public._fmt(u.criado_em), 'ultimo_acesso', public._fmt(u.ultimo_acesso),
    'pedidos', (select count(*) from public.pedidos o where o.usuario_id = u.id and o.status <> 'cancelado'),
    'gasto', coalesce((select sum(o.total) from public.pedidos o where o.usuario_id = u.id and o.status <> 'cancelado'), 0),
    'ultimo_pedido', public._fmt((select max(o.criado_em) from public.pedidos o where o.usuario_id = u.id)))
$$;

create function public.admin_clientes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); busca text := btrim(coalesce(p ->> 'busca', ''));
begin
  return jsonb_build_object('clientes', coalesce((
    select jsonb_agg(public._cliente_admin(x) order by x.criado_em desc)
      from (select * from public.perfis u where u.papel = 'cliente'
               and (busca = '' or u.nome ilike '%' || busca || '%' or u.email ilike '%' || busca || '%' or coalesce(u.telefone, '') ilike '%' || busca || '%')
             order by u.criado_em desc limit 200) x), '[]'::jsonb));
end $$;

create function public.admin_cliente(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); u public.perfis;
begin
  select * into u from public.perfis where id = (p ->> 'id')::uuid and papel = 'cliente';
  if not found then perform public._falha(404, 'Cliente não encontrado.'); end if;
  return jsonb_build_object(
    'cliente', public._cliente_admin(u),
    'enderecos', public._enderecos_do(u.id),
    'pedidos', coalesce((select jsonb_agg(public._pedido_linha(o) order by o.id desc) from public.pedidos o where o.usuario_id = u.id), '[]'::jsonb),
    'favoritos', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'nome', pr.nome, 'emoji', pr.emoji))
                             from public.favoritos f join public.produtos pr on pr.id = f.produto_id where f.usuario_id = u.id), '[]'::jsonb));
end $$;

/** Bloquear derruba o acesso na hora: as funções da loja recusam contas desativadas. */
create function public.admin_cliente_ativo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); u public.perfis;
begin
  update public.perfis set ativo = public._v_bool(p, 'ativo') where id = (p ->> 'id')::uuid and papel = 'cliente' returning * into u;
  if not found then perform public._falha(404, 'Cliente não encontrado.'); end if;
  return jsonb_build_object('cliente', public._cliente_admin(u));
end $$;

-- ---------------- Cupons ----------------
create function public._cupons_admin() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('cupons', coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'descricao', c.descricao, 'tipo', c.tipo, 'valor', c.valor, 'minimo', c.minimo,
    'validade', to_char(c.validade, 'YYYY-MM-DD'), 'limite_uso', c.limite_uso, 'usos', c.usos,
    'primeira_compra', c.primeira_compra, 'ativo', c.ativo) order by c.id desc), '[]'::jsonb)) from public.cupons c
$$;

create function public.admin_cupons(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin return public._cupons_admin(); end $$;

create function public.admin_salvar_cupom(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); cid bigint := nullif(p ->> 'id', '')::bigint;
  v_cod text := upper(btrim(coalesce(p ->> 'codigo', ''))); v_desc text; v_tipo text; v_valor int; v_min int;
  v_val date; v_lim int; v_pc boolean; v_at boolean;
begin
  if v_cod !~ '^[A-Z0-9_-]{3,20}$' then perform public._falha(422, 'Código: 3 a 20 letras, números, - ou _.', 'codigo'); end if;
  v_desc  := public._v_txt(p, 'descricao', 0, 100, 'Descrição');
  v_tipo  := public._v_opcao(p, 'tipo', array['percentual', 'valor'], 'Tipo');
  v_valor := public._v_int(p, 'valor', 1, 10000000, 'Valor');
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

create function public.admin_excluir_cupom(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  delete from public.cupons where id = (p ->> 'id')::bigint;
  return public._cupons_admin();
end $$;

-- ---------------- Avaliações e favoritos ----------------
create function public._avaliacao_admin(a public.avaliacoes) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', a.id, 'nota', a.nota, 'comentario', a.comentario, 'aprovada', a.aprovada, 'resposta', a.resposta,
    'criado_em', public._fmt(a.criado_em), 'pedido', (select codigo from public.pedidos where id = a.pedido_id),
    'cliente', (select nome from public.perfis where id = a.usuario_id))
$$;

create function public.admin_avaliacoes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return jsonb_build_object(
    'avaliacoes', coalesce((select jsonb_agg(public._avaliacao_admin(x) order by x.aprovada, x.id desc)
                              from (select * from public.avaliacoes order by aprovada, id desc limit 200) x), '[]'::jsonb),
    'media', (select round(avg(nota)::numeric, 1) from public.avaliacoes), 'total', (select count(*) from public.avaliacoes));
end $$;

create function public.admin_moderar_avaliacao(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); aid bigint := (p ->> 'id')::bigint; a public.avaliacoes;
begin
  if not exists (select 1 from public.avaliacoes where id = aid) then perform public._falha(404, 'Avaliação não encontrada.'); end if;
  if p ? 'aprovada' then update public.avaliacoes set aprovada = public._v_bool(p, 'aprovada') where id = aid; end if;
  if p ? 'resposta' then update public.avaliacoes set resposta = nullif(public._v_txt(p, 'resposta', 0, 300, 'Resposta'), '') where id = aid; end if;
  select * into a from public.avaliacoes where id = aid;
  return jsonb_build_object('avaliacao', public._avaliacao_admin(a));
end $$;

create function public.admin_favoritos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return jsonb_build_object(
    'ranking', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'emoji', t.emoji, 'imagem', t.imagem, 'ativo', t.ativo,
                                                               'categoria', t.categoria, 'favoritos', t.n) order by t.n desc, t.nome)
                          from (select pr.id, pr.nome, pr.emoji, pr.imagem, pr.ativo, c.nome as categoria,
                                       (select count(*) from public.favoritos f where f.produto_id = pr.id) as n
                                  from public.produtos pr join public.categorias c on c.id = pr.categoria_id) t), '[]'::jsonb),
    'total_favoritos', (select count(*) from public.favoritos),
    'clientes_com_favoritos', (select count(distinct usuario_id) from public.favoritos));
end $$;

-- ---------------- Faixas de entrega ----------------
create function public._zonas_admin() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('zonas', coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'nome', z.nome, 'ate_km', z.ate_km,
    'taxa', z.taxa, 'prazo_min', z.prazo_min, 'ativa', z.ativa) order by z.ate_km), '[]'::jsonb)) from public.zonas_entrega z
$$;

create function public.admin_zonas(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin return public._zonas_admin(); end $$;

create function public.admin_salvar_zona(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); zid bigint := nullif(p ->> 'id', '')::bigint; v_nome text; v_km double precision; v_taxa int; v_prazo int; v_ativa boolean;
begin
  v_nome := public._v_txt(p, 'nome', 2, 40, 'Nome');
  v_km := public._v_num(p, 'ate_km', 0.1, 500, 'Distância (km)');
  v_taxa := public._v_int(p, 'taxa', 0, 1000000, 'Taxa');
  v_prazo := public._v_int(p, 'prazo_min', 5, 1440, 'Prazo');
  v_ativa := public._v_bool(p, 'ativa');
  if zid is null then
    insert into public.zonas_entrega (nome, ate_km, taxa, prazo_min, ativa) values (v_nome, v_km, v_taxa, v_prazo, v_ativa);
  else
    if not exists (select 1 from public.zonas_entrega where id = zid) then perform public._falha(404, 'Faixa não encontrada.'); end if;
    update public.zonas_entrega set nome = v_nome, ate_km = v_km, taxa = v_taxa, prazo_min = v_prazo, ativa = v_ativa where id = zid;
  end if;
  return public._zonas_admin();
end $$;

create function public.admin_excluir_zona(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  delete from public.zonas_entrega where id = (p ->> 'id')::bigint;
  return public._zonas_admin();
end $$;

-- ---------------- Configurações (por seção) ----------------
create function public.admin_config(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin return jsonb_build_object('configuracoes', public._cfg()); end $$;

create function public._v_hhmm(p jsonb, campo text) returns text
language plpgsql immutable as $$
begin
  if coalesce(p ->> campo, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then perform public._falha(422, 'Horário inválido.', campo); end if;
  return p ->> campo;
end $$;

create function public.admin_salvar_config(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  adm public.perfis := public._admin(); secao text := p ->> 'secao'; d jsonb := coalesce(p -> 'dados', '{}'::jsonb); novo jsonb; h jsonb; i int; email text;
begin
  if secao = 'loja' then
    email := btrim(coalesce(d ->> 'email', ''));
    novo := jsonb_build_object(
      'nome', public._v_txt(d, 'nome', 2, 80, 'Nome da loja'), 'slogan', public._v_txt(d, 'slogan', 0, 120, 'Slogan'),
      'whatsapp', public._v_tel(d, 'whatsapp', false),
      'instagram', public._v_txt(jsonb_build_object('instagram', regexp_replace(coalesce(d ->> 'instagram', ''), '^@', '')), 'instagram', 0, 60, 'Instagram'),
      'email', case when email = '' then '' else public._v_email(d, 'email') end,
      'endereco', public._v_txt(d, 'endereco', 0, 150, 'Endereço'), 'cidade', public._v_txt(d, 'cidade', 0, 80, 'Cidade'),
      'uf', upper(public._v_txt(d, 'uf', 0, 2, 'UF')),
      'lat', public._v_num(d, 'lat', -90, 90, 'Latitude', true), 'lng', public._v_num(d, 'lng', -180, 180, 'Longitude', true));
  elsif secao = 'textos' then
    novo := jsonb_build_object('hero_titulo', public._v_txt(d, 'hero_titulo', 3, 120, 'Título'),
      'hero_subtitulo', public._v_txt(d, 'hero_subtitulo', 0, 300, 'Subtítulo'),
      'sobre_titulo', public._v_txt(d, 'sobre_titulo', 0, 100, 'Título do sobre'), 'sobre_texto', public._v_par(d, 'sobre_texto', 1500, 'Texto do sobre'));
  elsif secao = 'pedidos' then
    novo := jsonb_build_object('pausados', public._v_bool(d, 'pausados'), 'mensagem_pausa', public._v_txt(d, 'mensagem_pausa', 0, 200, 'Mensagem'),
      'antecedencia_horas', public._v_int(d, 'antecedencia_horas', 0, 720, 'Antecedência'),
      'pedido_minimo', public._v_int(d, 'pedido_minimo', 0, 10000000, 'Pedido mínimo'),
      'intervalo_min', public._v_int(d, 'intervalo_min', 10, 240, 'Intervalo'), 'dias_maximos', public._v_int(d, 'dias_maximos', 1, 365, 'Dias máximos'));
  elsif secao = 'entrega' then
    novo := jsonb_build_object('entrega_ativa', public._v_bool(d, 'entrega_ativa'), 'retirada_ativa', public._v_bool(d, 'retirada_ativa'),
      'gratis_acima', public._v_int(d, 'gratis_acima', 0, 10000000, 'Frete grátis acima de'),
      'taxa_padrao', public._v_int(d, 'taxa_padrao', 0, 1000000, 'Taxa padrão'));
    if not (novo ->> 'entrega_ativa')::boolean and not (novo ->> 'retirada_ativa')::boolean then
      perform public._falha(422, 'Deixe ao menos uma forma de recebimento ativa.');
    end if;
  elsif secao = 'pagamento' then
    novo := jsonb_build_object('pix_ativo', public._v_bool(d, 'pix_ativo'), 'pix_chave', public._v_txt(d, 'pix_chave', 0, 80, 'Chave PIX'),
      'pix_nome', public._v_txt(d, 'pix_nome', 0, 25, 'Nome do recebedor'), 'pix_cidade', public._v_txt(d, 'pix_cidade', 0, 15, 'Cidade do recebedor'),
      'dinheiro_ativo', public._v_bool(d, 'dinheiro_ativo'), 'cartao_ativo', public._v_bool(d, 'cartao_ativo'));
    if (novo ->> 'pix_ativo')::boolean and (novo ->> 'pix_chave') = '' then
      perform public._falha(422, 'Informe a chave PIX ou desative o PIX.', 'pix_chave');
    end if;
  elsif secao = 'horarios' then
    novo := '{}'::jsonb;
    for i in 0..6 loop
      h := d -> i::text;
      h := jsonb_build_object('aberto', public._v_bool(coalesce(h, '{}'::jsonb), 'aberto'),
                              'abre', public._v_hhmm(coalesce(h, '{}'::jsonb), 'abre'), 'fecha', public._v_hhmm(coalesce(h, '{}'::jsonb), 'fecha'));
      if (h ->> 'aberto')::boolean and (h ->> 'abre') >= (h ->> 'fecha') then
        perform public._falha(422, 'O horário de fechamento deve ser depois do de abertura.');
      end if;
      novo := novo || jsonb_build_object(i::text, h);
    end loop;
  else
    perform public._falha(422, 'Seção de configuração desconhecida.');
  end if;

  insert into public.configuracoes (chave, valor) values (secao, novo)
  on conflict (chave) do update set valor = excluded.valor;
  return jsonb_build_object('configuracoes', public._cfg());
end $$;

-- ---------------- Equipe (administradores) ----------------
create function public.admin_equipe(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin();
begin
  return jsonb_build_object('equipe', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email, 'ativo', u.ativo,
      'criado_em', public._fmt(u.criado_em), 'ultimo_acesso', public._fmt(u.ultimo_acesso)) order by u.criado_em)
      from public.perfis u where u.papel = 'admin'), '[]'::jsonb));
end $$;

/** Dá (ou tira) acesso de administrador a quem já tem conta. Para o 1º admin, use o SQL Editor (veja docs/). */
create function public.admin_equipe_papel(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); v_email text; v_papel text; alvo public.perfis;
begin
  v_email := public._v_email(p, 'email');
  v_papel := public._v_opcao(p, 'papel', array['admin', 'cliente'], 'Papel');
  select * into alvo from public.perfis where lower(email) = v_email;
  if not found then
    perform public._falha(404, 'Não achamos uma conta com este e-mail. Peça para a pessoa criar uma conta na loja primeiro.', 'email');
  end if;
  if v_papel = 'cliente' and alvo.id = adm.id then perform public._falha(409, 'Você não pode remover o seu próprio acesso.'); end if;
  update public.perfis set papel = v_papel where id = alvo.id;
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_equipe_ativo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); alvo uuid := (p ->> 'id')::uuid; v boolean := public._v_bool(p, 'ativo');
begin
  if alvo = adm.id then perform public._falha(409, 'Você não pode desativar a própria conta.'); end if;
  if not exists (select 1 from public.perfis where id = alvo and papel = 'admin') then perform public._falha(404, 'Usuário não encontrado.'); end if;
  if not v and (select count(*) from public.perfis where papel = 'admin' and ativo) <= 1 then
    perform public._falha(422, 'É preciso manter ao menos um administrador ativo.');
  end if;
  update public.perfis set ativo = v where id = alvo;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------- Perfil do administrador (nome) ----------------
create function public.admin_atualizar_perfil(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); v_nome text; u public.perfis;
begin
  v_nome := public._v_txt(p, 'nome', 2, 80, 'Nome');
  update public.perfis set nome = v_nome where id = adm.id returning * into u;
  return jsonb_build_object('usuario', public._perfil_json(u));
end $$;
