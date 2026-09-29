-- ==========================================================
-- 25) MULTILOJA NOS SITES — o perfil diz de qual loja é.
-- O painel usa o número da loja como pasta das fotos no Storage
-- ("<loja_id>/foto.png"): num banco com várias lojas, cada dona
-- só envia, troca e apaga imagens na pasta da própria loja.
-- ==========================================================

create or replace function public._perfil_json(u public.perfis) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email, 'telefone', coalesce(u.telefone, ''),
    'papel', u.papel, 'ativo', u.ativo, 'criado_em', public._fmt(u.criado_em), 'avisos_whatsapp', u.avisos_whatsapp,
    'loja_id', u.loja_id)
$$;
