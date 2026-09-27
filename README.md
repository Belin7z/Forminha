# Forminha

Loja online e painel de gestão para docerias e confeitarias — cada cliente com a **sua própria loja**,
o **seu próprio banco de dados** e a **sua própria identidade visual**.

| Pasta | O que é | Onde fica no ar |
|---|---|---|
| [`Loja/`](Loja) | O site onde os clientes da doceria escolhem os doces e fazem o pedido (retirada ou entrega, PIX, agenda). | Um site por loja (ex.: `doce-da-ana.vercel.app`) |
| [`Dashboard/`](Dashboard) | O painel da dona da doceria: pedidos, agenda, produção, cardápio, estoque, clientes, cores da loja. Guarda também o banco de dados (`supabase/`), os guias e os testes. | Um painel por loja (ex.: `doce-da-ana-painel.vercel.app`) |
| [`Central/`](Central) | Onde a Forminha cria, acompanha, atualiza e exclui as lojas das clientes. | [forminha.vercel.app](https://forminha.vercel.app) |

## Como uma loja nasce

1. Na **Central**, o administrador informa o nome da loja e o e-mail da dona.
2. A Central cria um banco novo no Supabase (nome `<código> · <nome da loja>`, ex.: `7XT-Tna-dRe · Doce da Ana`),
   prepara as tabelas, publica a loja e o painel na Vercel e gera um **convite**.
3. A dona abre o convite, cria o acesso dela e personaliza tudo: nome, logo, **tema de cores** (8 prontos ou
   as cores da marca dela) e estilo das letras. O cardápio começa vazio.

Todas as lojas usam o mesmo código: uma melhoria publicada aqui chega a todas. As mudanças no banco
são aplicadas loja por loja pela Central (**Atualizar banco**).

## Tecnologia

HTML, CSS e JavaScript puros (sem framework), [Supabase](https://supabase.com) (Postgres, login e fotos)
e [Vercel](https://vercel.com). Toda regra de negócio e de segurança fica no banco (funções `security definer`
e RLS); os sites só usam a chave **pública** de cada loja. As chaves de administração ficam apenas nas
variáveis secretas da Central, na Vercel — nunca no código.

Cada pasta tem o próprio `README.md` com os comandos (`npm run dev`, `npm test`…).
