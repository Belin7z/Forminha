-- ==========================================================
-- 27) MUDANÇA PARA O BANCO ÚNICO — a Central traz uma loja que tinha
-- banco próprio. Enquanto ela copia os dados (com forminha.migrando = 1,
-- só dentro da cópia), os gatilhos que criam coisas sozinhos ficam
-- quietos, para os dados chegarem EXATAMENTE como estavam:
--   • o perfil que nasce ao criar a conta (a conta vem copiada, e o
--     perfil também, na loja certa);
--   • o histórico de preço do ingrediente (o histórico vem copiado);
--   • o sinal calculado do pedido (o valor combinado vem copiado).
-- Fora da cópia, nada muda.
-- ==========================================================

create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare l uuid;
begin
  if current_setting('forminha.migrando', true) = '1' then return new; end if;
  l := public._loja_de(new.raw_user_meta_data ->> 'loja');
  if l is null then return new; end if; -- sem loja: o perfil nasce no primeiro acesso a uma loja
  insert into public.perfis (loja_id, id, nome, email, telefone, aceite_termos_em)
  values (
    l, new.id,
    left(coalesce(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nome', '')), ''), split_part(coalesce(new.email, ''), '@', 1)), 80),
    coalesce(new.email, ''),
    nullif(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefone', ''), '\D', '', 'g'), 11), ''),
    case when new.raw_user_meta_data ->> 'aceite' = 'true' then now() end
  )
  on conflict do nothing;
  return new;
end $$;

create or replace function public._registrar_preco() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('forminha.migrando', true) = '1' then return new; end if;
  if new.embalagem_preco > 0 and (tg_op = 'INSERT' or new.embalagem_preco is distinct from old.embalagem_preco or new.embalagem_qtd is distinct from old.embalagem_qtd) then
    insert into public.ingrediente_precos (ingrediente_id, embalagem_preco, embalagem_qtd, custo_unit)
    values (new.id, new.embalagem_preco, new.embalagem_qtd, new.embalagem_preco::numeric / new.embalagem_qtd);
  end if;
  return new;
end $$;

create or replace function public._sinal_automatico() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('forminha.migrando', true) = '1' then return new; end if;
  if new.origem = 'loja' then new.sinal := public._sinal_para(new.total); end if;
  return new;
end $$;
