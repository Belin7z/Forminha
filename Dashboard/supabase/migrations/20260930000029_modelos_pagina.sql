-- ==========================================================
-- 29) MODELOS DA PÁGINA INICIAL — além das cores e da letra, a
-- dona escolhe a arrumação do início da loja:
--   equilibrado (padrão) · vitrine (foto grande e produtos logo
--   no topo) · minimalista (texto centralizado e direto).
-- A lista também está no site (src/scripts/base/tema.js, MODELOS).
-- ==========================================================

create or replace function public._aparencia_valida(d jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  tema text := coalesce(nullif(btrim(d ->> 'tema'), ''), 'neutro');
  fonte text := coalesce(nullif(btrim(d ->> 'fonte'), ''), 'moderno');
  modelo text := coalesce(nullif(btrim(d ->> 'modelo'), ''), 'equilibrado');
  cores jsonb := '{}'::jsonb; k text; v text;
begin
  if tema not in ('neutro', 'rosa-dourado', 'chocolate', 'pistache', 'lavanda', 'pessego', 'menta', 'cereja', 'personalizado') then
    perform public._falha(422, 'Tema desconhecido.', 'tema');
  end if;
  if fonte not in ('elegante', 'classico', 'moderno', 'delicado') then
    perform public._falha(422, 'Estilo de letra desconhecido.', 'fonte');
  end if;
  if modelo not in ('equilibrado', 'vitrine', 'minimalista') then
    perform public._falha(422, 'Modelo de página desconhecido.', 'modelo');
  end if;
  if tema = 'personalizado' then
    foreach k in array array['marca', 'escura', 'detalhe'] loop
      v := lower(btrim(coalesce(d #>> array['cores', k], '')));
      if v !~ '^#[0-9a-f]{6}$' then perform public._falha(422, 'Escolha as três cores do tema.', k); end if;
      cores := cores || jsonb_build_object(k, v);
    end loop;
    return jsonb_build_object('tema', tema, 'fonte', fonte, 'modelo', modelo, 'cores', cores);
  end if;
  return jsonb_build_object('tema', tema, 'fonte', fonte, 'modelo', modelo);
end $$;
