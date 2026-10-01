-- ==========================================================
-- 30) ETIQUETAS — o produto ganha o que vai na etiqueta impressa
-- (e que o cliente também vê na loja):
--   ingredientes · validade em dias · como conservar.
-- Os alérgenos já existem (0012). A etiqueta é montada e impressa
-- no painel (src/scripts/base/etiquetas.js).
-- ==========================================================

alter table public.produtos
  add column ingredientes  text not null default '' check (char_length(ingredientes) <= 1000),
  add column conservacao   text not null default '' check (char_length(conservacao) <= 160),
  add column validade_dias int check (validade_dias is null or validade_dias between 1 and 730);

/* Os campos novos viajam junto com o produto (vitrine e painel). Igual à 0012 + os 3 campos. */
create or replace function public._produto_json(pr public.produtos) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', pr.id, 'categoria_id', pr.categoria_id, 'nome', pr.nome, 'descricao', pr.descricao, 'preco', pr.preco,
    'unidade', pr.unidade, 'min_qtd', pr.min_qtd, 'emoji', pr.emoji, 'imagem', pr.imagem, 'tag', pr.tag,
    'opcoes', pr.opcoes, 'antecedencia_horas', pr.antecedencia_horas, 'ativo', pr.ativo,
    'destaque', pr.destaque, 'ordem', pr.ordem,
    'alergenos', to_jsonb(pr.alergenos), 'galeria', pr.galeria, 'limite_diario', pr.limite_diario,
    'disponivel_de', to_char(pr.disponivel_de, 'YYYY-MM-DD'), 'disponivel_ate', to_char(pr.disponivel_ate, 'YYYY-MM-DD'),
    'ingredientes', pr.ingredientes, 'conservacao', pr.conservacao, 'validade_dias', pr.validade_dias)
$$;

/* ---------- Salvar produto: a versão anterior vira auxiliar interno ---------- */
alter function public.admin_salvar_produto(jsonb) rename to _salvar_produto_extras;
revoke execute on function public._salvar_produto_extras(jsonb) from public, anon, authenticated;

create function public.admin_salvar_produto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare adm public.perfis := public._admin(); r jsonb; pid bigint; ing text; con text; val int;
begin
  -- confere os campos da etiqueta antes de gravar qualquer coisa (o erro desfaz tudo)
  if p ? 'ingredientes' then ing := public._v_txt(p, 'ingredientes', 0, 1000, 'Ingredientes'); end if;
  if p ? 'conservacao' then con := public._v_txt(p, 'conservacao', 0, 160, 'Como conservar'); end if;
  if p ? 'validade_dias' then val := public._v_int(p, 'validade_dias', 1, 730, 'Validade (dias)', true); end if;

  r := public._salvar_produto_extras(p);
  pid := (r -> 'produto' ->> 'id')::bigint;
  if p ? 'ingredientes' or p ? 'conservacao' or p ? 'validade_dias' then
    update public.produtos set
      ingredientes = case when p ? 'ingredientes' then ing else ingredientes end,
      conservacao = case when p ? 'conservacao' then con else conservacao end,
      validade_dias = case when p ? 'validade_dias' then val else validade_dias end
     where id = pid;
  end if;
  return r || jsonb_build_object('produto', public._produto_admin(pid));
end $$;
grant execute on function public.admin_salvar_produto(jsonb) to authenticated;

-- como toda função com "security definer" desde a 0024: pertence ao papel que só vê a loja da vez
grant create on schema public to forminha_app;
alter function public.admin_salvar_produto(jsonb) owner to forminha_app;
revoke create on schema public from forminha_app;
