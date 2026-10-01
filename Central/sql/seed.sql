-- ==========================================================
-- DADOS INICIAIS de uma loja nova — tudo neutro e genérico.
-- O cardápio NASCE VAZIO: categorias, produtos, cupons e faixas de entrega
-- são cadastrados no Dashboard. Nome, textos, cores e contatos também são
-- trocados por lá (o convite de primeiro acesso já leva a dona até eles).
-- Não sobrescreve nada que já exista.
-- ==========================================================

-- Configurações padrão (uma linha por seção)
insert into public.configuracoes (chave, valor) values
('loja', '{"nome":"Minha Doceria","slogan":"","whatsapp":"","instagram":"","email":"","endereco":"","cidade":"","uf":"SP","lat":null,"lng":null}'),
('textos', '{"hero_titulo":"","hero_subtitulo":"","sobre_titulo":"","sobre_texto":""}'),
('horarios', '{"0":{"aberto":false,"abre":"09:00","fecha":"15:00"},"1":{"aberto":true,"abre":"09:00","fecha":"18:00"},"2":{"aberto":true,"abre":"09:00","fecha":"18:00"},"3":{"aberto":true,"abre":"09:00","fecha":"18:00"},"4":{"aberto":true,"abre":"09:00","fecha":"18:00"},"5":{"aberto":true,"abre":"09:00","fecha":"18:00"},"6":{"aberto":true,"abre":"09:00","fecha":"15:00"}}'),
('pedidos', '{"pausados":false,"mensagem_pausa":"Estamos sem receber novos pedidos no momento. Volte em breve!","antecedencia_horas":24,"pedido_minimo":0,"intervalo_min":30,"dias_maximos":45}'),
('entrega', '{"entrega_ativa":true,"retirada_ativa":true,"gratis_acima":0,"taxa_padrao":0}'),
('pagamento', '{"pix_ativo":true,"pix_chave":"","pix_nome":"","pix_cidade":"","dinheiro_ativo":true,"cartao_ativo":true}')
on conflict do nothing;

-- Estoque: as preferências padrão (uma linha por loja)
insert into public.estoque_config default values on conflict do nothing;
