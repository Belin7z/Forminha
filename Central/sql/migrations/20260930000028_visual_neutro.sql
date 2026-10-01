-- ==========================================================
-- 28) VISUAL NEUTRO DA LOJA NOVA — a loja mostra só o que é dela:
--   • sem título, o topo da página inicial usa o nome da loja
--     (o título passa a ser opcional no painel);
--   • os textos prontos que vinham na loja nova ("Doces que
--     transformam momentos em memórias"…) saem das lojas que nunca
--     os trocaram — a loja nova já nasce sem eles (seed.sql);
--   • a letra padrão (loja que ainda não escolheu a aparência)
--     passa a ser a "Moderno", sem serifa.
-- ==========================================================

/* ---------- título da página inicial opcional ---------- */
do $$
declare def text; novo text;
begin
  def := pg_get_functiondef('public.admin_salvar_config(jsonb)'::regprocedure);
  if position('''hero_titulo'', 0, 120' in def) > 0 then return; end if; -- já trocado
  novo := replace(def, '''hero_titulo'', 3, 120', '''hero_titulo'', 0, 120');
  if novo = def then raise exception 'admin_salvar_config: a validação do título não foi encontrada'; end if;
  execute novo;
end $$;

/* ---------- letra padrão: Moderno ---------- */
do $$
declare def text; novo text;
begin
  def := pg_get_functiondef('public._base_loja_config(jsonb)'::regprocedure);
  if position('''{"tema":"neutro","fonte":"moderno"}''' in def) > 0 then return; end if; -- já trocado
  novo := replace(def, '''{"tema":"neutro","fonte":"elegante"}''', '''{"tema":"neutro","fonte":"moderno"}''');
  if novo = def then raise exception '_base_loja_config: a aparência padrão não foi encontrada'; end if;
  execute novo;
end $$;

/* ---------- textos prontos antigos: só onde ninguém mexeu ---------- */
update public.configuracoes set valor = valor || '{"slogan":""}'::jsonb
 where chave = 'loja' and valor ->> 'slogan' = 'Doces feitos com carinho';

update public.configuracoes c
   set valor = c.valor || coalesce((
     select jsonb_object_agg(a.key, ''::text)
       from jsonb_each_text('{
         "hero_titulo": "Doces que transformam momentos em memórias",
         "hero_subtitulo": "Bolos, doces e encomendas para festas — feitos sob encomenda, com ingredientes selecionados e muito carinho.",
         "sobre_titulo": "Feito à mão, do nosso jeito",
         "sobre_texto": "Cada receita é preparada com calma, ingredientes selecionados e atenção aos detalhes — do primeiro brigadeiro ao último confeito.\n\nFaça seu pedido pelo site e combine a entrega ou a retirada no horário que for melhor para você."
       }'::jsonb) a
      where c.valor ->> a.key = a.value), '{}'::jsonb)
 where c.chave = 'textos';
