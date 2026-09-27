-- ==========================================================
-- 8) PERMISSÕES — o que o navegador pode executar
-- No Postgres toda função nova nasce executável por TODOS; por isso
-- primeiro revogamos tudo e depois liberamos só a lista abaixo.
-- >>> Ao criar uma função nova da API, inclua-a aqui (ou numa migração
--     posterior) e NÃO esqueça o `revoke ... from public`.
-- ==========================================================

revoke execute on all functions in schema public from public, anon, authenticated;

-- Visitantes e clientes: conteúdo público da loja
grant execute on function
  public.loja_config(jsonb), public.loja_catalogo(jsonb), public.loja_avaliacoes(jsonb)
to anon, authenticated;

-- Usuários logados (cada função confere internamente se é cliente ou administrador)
grant execute on function
  public.e_admin(),                                    -- usada nas políticas do Storage
  public.perfil_atual(jsonb),
  -- cliente
  public.cliente_atualizar_perfil(jsonb), public.cliente_enderecos(jsonb), public.cliente_salvar_endereco(jsonb),
  public.cliente_excluir_endereco(jsonb), public.cliente_favorito(jsonb),
  public.cliente_orcar_pedido(jsonb), public.cliente_criar_pedido(jsonb), public.cliente_pedidos(jsonb),
  public.cliente_pedido(jsonb), public.cliente_cancelar_pedido(jsonb), public.cliente_avaliar_pedido(jsonb),
  -- painel: pedidos e visão geral
  public.admin_pedidos(jsonb), public.admin_pedidos_contagem(jsonb), public.admin_pedidos_novos(jsonb),
  public.admin_pedido(jsonb), public.admin_mudar_status(jsonb), public.admin_resumo(jsonb),
  -- painel: cadastros
  public.admin_categorias(jsonb), public.admin_salvar_categoria(jsonb), public.admin_excluir_categoria(jsonb), public.admin_ordenar_categorias(jsonb),
  public.admin_produtos(jsonb), public.admin_salvar_produto(jsonb), public.admin_alternar_produto(jsonb), public.admin_excluir_produto(jsonb),
  public.admin_clientes(jsonb), public.admin_cliente(jsonb), public.admin_cliente_ativo(jsonb),
  public.admin_cupons(jsonb), public.admin_salvar_cupom(jsonb), public.admin_excluir_cupom(jsonb),
  public.admin_avaliacoes(jsonb), public.admin_moderar_avaliacao(jsonb), public.admin_favoritos(jsonb),
  public.admin_zonas(jsonb), public.admin_salvar_zona(jsonb), public.admin_excluir_zona(jsonb),
  public.admin_config(jsonb), public.admin_salvar_config(jsonb),
  public.admin_equipe(jsonb), public.admin_equipe_papel(jsonb), public.admin_equipe_ativo(jsonb), public.admin_atualizar_perfil(jsonb)
to authenticated;

-- Proteção para o futuro: tabelas, sequências e funções criadas DEPOIS desta migração
-- não nascem acessíveis a visitantes/clientes (o Supabase costuma liberar tudo por padrão).
-- Toda tabela nova deve ainda ligar o RLS: `alter table ... enable row level security;`
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
