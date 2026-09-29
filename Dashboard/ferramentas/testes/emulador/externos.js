/* ==========================================================
   SIMULADOR dos serviços externos (Mercado Pago e Meta/WhatsApp).
   Serve aos testes e ao `npm run dev`: nada sai da sua máquina.
   ========================================================== */
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function criarExternos() {
  const estado = {
    mpPagamentos: new Map(), mpPreferencias: new Map(), mpChamadas: [], metaEnvios: [], proximoId: 5000,
    falhas: { mpCriar: false, mpConsultar: false, semQr: false, meta: null }, // meta: objeto de erro da Meta, ex.: { code: 132001 }
  };
  const resp = (status, json) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });

  async function fetchFn(url, opcoes = {}) {
    const u = new URL(url);
    const metodo = opcoes.method ?? "GET";
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;

    if (u.host === "api.mercadopago.com") {
      estado.mpChamadas.push({ metodo, caminho: u.pathname, cabecalhos: opcoes.headers ?? {}, corpo });
      if (u.pathname === "/v1/payments" && metodo === "POST") {
        if (estado.falhas.mpCriar) return resp(500, { message: "erro interno" });
        const chave = opcoes.headers?.["X-Idempotency-Key"];
        const existente = [...estado.mpPagamentos.values()].find((p) => p._idem === chave);
        if (existente) return resp(200, existente); // mesma chave = mesmo pagamento
        const id = estado.proximoId++;
        const pag = {
          id, status: "pending", payment_method_id: "pix", transaction_amount: corpo.transaction_amount,
          external_reference: corpo.external_reference, date_of_expiration: corpo.date_of_expiration, _idem: chave,
          point_of_interaction: { transaction_data: estado.falhas.semQr ? {} : { qr_code: `00020126360014BR.GOV.BCB.PIX-MP${id}`, qr_code_base64: PNG_1X1, ticket_url: `https://mp.exemplo/ticket/${id}` } },
        };
        estado.mpPagamentos.set(String(id), pag);
        return resp(201, pag);
      }
      // checkout de cartão: devolve o endereço onde o cliente paga
      if (u.pathname === "/checkout/preferences" && metodo === "POST") {
        if (estado.falhas.mpCriar) return resp(500, { message: "erro interno" });
        const id = `pref-${estado.proximoId++}`;
        const pref = { id, init_point: `https://mp.exemplo/checkout/${id}`, ...corpo };
        estado.mpPreferencias.set(id, pref);
        return resp(201, pref);
      }
      if (u.pathname === "/users/me" && metodo === "GET") {
        const token = String(opcoes.headers?.Authorization ?? "").replace(/^Bearer\s+/, "");
        return /^(APP_USR|TEST)-/.test(token) ? resp(200, { id: 123456, nickname: "DOCERIA_TESTE", email: "doceria@exemplo.com", site_id: "MLB" }) : resp(401, { message: "invalid access token" });
      }
      const m = /^\/v1\/payments\/(.+)$/.exec(u.pathname);
      if (m && metodo === "GET") {
        if (estado.falhas.mpConsultar) return resp(503, { message: "indisponível" });
        const p = estado.mpPagamentos.get(decodeURIComponent(m[1]));
        return p ? resp(200, p) : resp(404, { message: "Payment not found" });
      }
    }

    if (u.host === "graph.facebook.com") {
      estado.metaEnvios.push({ caminho: u.pathname, cabecalhos: opcoes.headers ?? {}, corpo });
      if (estado.falhas.meta) return resp(400, { error: estado.falhas.meta });
      return resp(200, { messaging_product: "whatsapp", contacts: [{ wa_id: corpo.to }], messages: [{ id: `wamid.TESTE${estado.metaEnvios.length}` }] });
    }
    return resp(404, { message: "serviço externo não simulado" });
  }

  return {
    estado, fetchFn,
    /** Marca um pagamento como aprovado (como se o cliente tivesse pago no app do banco). */
    aprovar(id) { const p = estado.mpPagamentos.get(String(id)); if (!p) throw new Error("pagamento inexistente"); p.status = "approved"; return p; },
    /** O cliente pagou no checkout (cartão, boleto…): cria o pagamento aprovado que o aviso vai consultar. */
    pagarNoCheckout(codigo, reais, { tipo = "credit_card", metodo = "visa" } = {}) {
      const id = estado.proximoId++;
      const pag = { id, status: "approved", payment_method_id: metodo, payment_type_id: tipo, transaction_amount: reais, external_reference: codigo };
      estado.mpPagamentos.set(String(id), pag);
      return pag;
    },
    /** Acha o pagamento pendente de um pedido. */
    pagamentoDoPedido(codigo) { return [...estado.mpPagamentos.values()].reverse().find((p) => p.external_reference === codigo); },
  };
}
