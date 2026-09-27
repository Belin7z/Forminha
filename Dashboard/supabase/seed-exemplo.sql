-- ==========================================================
-- CARDÁPIO DE EXEMPLO — só para testar (npm run dev e npm test).
-- NÃO faz parte da instalação: o banco de verdade começa sem cardápio.
-- Se rodar num banco que já tem categorias, não faz nada.
-- ==========================================================

-- A loja de exemplo fica em São Paulo: os testes de entrega calculam as distâncias a partir daqui.
-- (A instalação de verdade nasce sem endereço: a dona marca a loja no mapa pelo Dashboard.)
update public.configuracoes
   set valor = valor || '{"nome":"Doceria Exemplo","endereco":"Rua das Flores, 123 — Centro","cidade":"São Paulo","uf":"SP","lat":-23.5505,"lng":-46.6333}'::jsonb
 where chave = 'loja' and (valor ->> 'lat') is null;

do $seed$
declare
  tamanho jsonb := '{"id":"g1","nome":"Tamanho","tipo":"unica","obrigatorio":true,"max":null,"itens":[{"id":"g1i1","nome":"1 kg (10 fatias)","preco":0},{"id":"g1i2","nome":"1,5 kg (15 fatias)","preco":4500},{"id":"g1i3","nome":"2 kg (20 fatias)","preco":9000}]}';
  adicionais jsonb := '{"id":"g2","nome":"Adicionais","tipo":"multipla","obrigatorio":false,"max":3,"itens":[{"id":"g2i1","nome":"Topo de bolo personalizado","preco":2500},{"id":"g2i2","nome":"Velas e vela mágica","preco":800},{"id":"g2i3","nome":"Cartão com dedicatória","preco":500}]}';
  cat_bolos bigint; cat_brig bigint; cat_cup bigint; cat_tortas bigint; cat_festa bigint; cat_pres bigint;
begin
  if exists (select 1 from public.categorias) then return; end if;

  insert into public.categorias (nome, emoji, icone, ordem) values ('Bolos', '🎂', 'bolo', 0) returning id into cat_bolos;
  insert into public.categorias (nome, emoji, icone, ordem) values ('Brigadeiros', '🍫', 'brigadeiro', 1) returning id into cat_brig;
  insert into public.categorias (nome, emoji, icone, ordem) values ('Cupcakes', '🧁', 'cupcake', 2) returning id into cat_cup;
  insert into public.categorias (nome, emoji, icone, ordem) values ('Tortas e Fatias', '🥧', 'torta', 3) returning id into cat_tortas;
  insert into public.categorias (nome, emoji, icone, ordem) values ('Docinhos de Festa', '🎀', 'caixa', 4) returning id into cat_festa;
  insert into public.categorias (nome, emoji, icone, ordem) values ('Kits Presente', '🎁', 'presente', 5) returning id into cat_pres;

  insert into public.produtos (categoria_id, emoji, nome, descricao, preco, unidade, min_qtd, tag, opcoes, antecedencia_horas, destaque, ordem) values
  (cat_bolos, '🍓', 'Bolo Ninho com Morango', 'Massa branca fofinha, recheio cremoso de leite Ninho e morangos frescos.', 8990, 'bolo 1 kg', 1, 'Mais pedido', jsonb_build_array(tamanho, adicionais), null, true, 0),
  (cat_bolos, '🎂', 'Bolo Red Velvet', 'Massa aveludada vermelha com cream cheese frosting.', 9500, 'bolo 1 kg', 1, null, jsonb_build_array(tamanho, adicionais), null, true, 1),
  (cat_bolos, '🍫', 'Bolo de Chocolate Belga', 'Massa úmida de chocolate com ganache de chocolate meio amargo.', 9200, 'bolo 1 kg', 1, null, jsonb_build_array(tamanho, adicionais), null, false, 2),
  (cat_bolos, '🥕', 'Bolo de Cenoura com Brigadeiro', 'O clássico de casa: cenoura fofinha e cobertura de brigadeiro cremoso.', 5800, 'bolo 1 kg', 1, null, jsonb_build_array(tamanho), null, false, 3),
  (cat_bolos, '🍋', 'Bolo de Limão Siciliano', 'Massa cítrica com recheio de mousse de limão e raspas frescas.', 8400, 'bolo 1 kg', 1, null, jsonb_build_array(tamanho, adicionais), null, false, 4),
  (cat_bolos, '👑', 'Bolo Personalizado (sob medida)', 'Tema, cores e recheio à sua escolha. Descreva a ideia nas observações do item.', 15000, 'a partir de 1,5 kg', 1, 'Sob encomenda',
     '[{"id":"g1","nome":"Recheio","tipo":"unica","obrigatorio":true,"max":null,"itens":[{"id":"g1i1","nome":"Ninho com morango","preco":0},{"id":"g1i2","nome":"Brigadeiro gourmet","preco":0},{"id":"g1i3","nome":"Doce de leite com nozes","preco":1500}]}]'::jsonb, 72, true, 5),

  (cat_brig, '🍫', 'Brigadeiro Tradicional', 'Feito com chocolate de verdade e granulado belga.', 350, 'unidade', 10, null, '[]', null, false, 0),
  (cat_brig, '🥛', 'Brigadeiro de Ninho', 'Cremoso, com leite Ninho e cobertura de leite em pó.', 380, 'unidade', 10, null, '[]', null, true, 1),
  (cat_brig, '🌰', 'Brigadeiro de Pistache', 'Gourmet, com pasta de pistache e pedacinhos da fruta.', 550, 'unidade', 10, 'Gourmet', '[]', null, false, 2),
  (cat_brig, '🍓', 'Brigadeiro de Morango', 'Chocolate branco com morango, cor rosinha e sabor delicado.', 420, 'unidade', 10, null, '[]', null, false, 3),

  (cat_cup, '🧁', 'Cupcake de Baunilha', 'Massa de baunilha com buttercream rosa e confeitos.', 900, 'unidade', 4, null,
     '[{"id":"g1","nome":"Cobertura","tipo":"unica","obrigatorio":true,"max":null,"itens":[{"id":"g1i1","nome":"Buttercream rosa","preco":0},{"id":"g1i2","nome":"Chantininho","preco":0},{"id":"g1i3","nome":"Ganache de chocolate","preco":100}]}]'::jsonb, null, true, 0),
  (cat_cup, '🧁', 'Cupcake de Chocolate', 'Massa de chocolate com recheio de brigadeiro.', 950, 'unidade', 4, null, '[]', null, false, 1),
  (cat_cup, '❤️', 'Cupcake Red Velvet', 'Massa vermelha com cobertura de cream cheese.', 1100, 'unidade', 4, null, '[]', null, false, 2),

  (cat_tortas, '🥧', 'Torta de Limão', 'Base crocante, recheio de limão e merengue maçaricado.', 1400, 'fatia', 1, null, '[]', null, false, 0),
  (cat_tortas, '🍰', 'Torta de Morango', 'Creme de baunilha, morangos frescos e geleia brilhante.', 1600, 'fatia', 1, null, '[]', null, false, 1),
  (cat_tortas, '🍰', 'Cheesecake de Frutas Vermelhas', 'Cremoso, com calda artesanal de frutas vermelhas.', 1800, 'fatia', 1, 'Novidade', '[]', null, true, 2),

  (cat_festa, '🎀', 'Cento de Docinhos Sortidos', 'Brigadeiro, beijinho, cajuzinho e olho-de-sogra — 100 unidades.', 26000, 'cento', 1, null, '[]', 72, true, 0),
  (cat_festa, '🍬', 'Cento de Brigadeiros Gourmet', 'Seleção de sabores gourmet, embalados individualmente.', 39000, 'cento', 1, null, '[]', 72, false, 1),
  (cat_festa, '🎉', 'Mini Bolos no Pote (10 un.)', 'Camadas de bolo, recheio e cobertura em potinho de 180 ml.', 8500, 'kit 10 un.', 1, null,
     '[{"id":"g1","nome":"Sabor","tipo":"unica","obrigatorio":true,"max":null,"itens":[{"id":"g1i1","nome":"Ninho com morango","preco":0},{"id":"g1i2","nome":"Chocolate","preco":0},{"id":"g1i3","nome":"Red Velvet","preco":500}]}]'::jsonb, 48, false, 2),

  (cat_pres, '🎁', 'Kit Café da Manhã Rosa', 'Bolo pequeno, 4 brigadeiros, 2 cupcakes e cartão personalizado.', 12000, 'kit', 1, 'Presente', '[]', 48, true, 0),
  (cat_pres, '💝', 'Caixa Amor (12 doces)', 'Caixa presente com 12 docinhos finos e laço de cetim.', 6800, 'caixa', 1, null, '[]', 48, false, 1),
  (cat_pres, '🌷', 'Kit Especial Dia das Mães', 'Bolo no pote, cookies, trufas e flores comestíveis.', 9800, 'kit', 1, null, '[]', 48, false, 2);

  insert into public.cupons (codigo, descricao, tipo, valor, minimo, primeira_compra) values ('BEMVINDO10', '10% na primeira compra', 'percentual', 10, 3000, true);
  insert into public.zonas_entrega (nome, ate_km, taxa, prazo_min) values ('Até 3 km', 3, 600, 45), ('Até 6 km', 6, 1000, 60), ('Até 10 km', 10, 1500, 90);
end
$seed$;
