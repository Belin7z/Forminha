/* ==========================================================
   BASE — chave PIX: reconhece o tipo e deixa no formato que o
   banco espera ("(11) 98765-4321" vira "+5511987654321").
   Chave escrita de outro jeito gera um PIX que o banco recusa,
   por isso ela é conferida antes de salvar.
   ========================================================== */
export const TIPOS_CHAVE = [["documento", "CPF ou CNPJ"], ["celular", "Celular"], ["email", "E-mail"], ["aleatoria", "Aleatória"]];

const soDigitos = (t) => String(t ?? "").replace(/\D/g, "");
const ALEATORIA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function digitoVerificador(numeros, pesos) {
  const soma = pesos.reduce((s, p, i) => s + Number(numeros[i]) * p, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  return digitoVerificador(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[9])
    && digitoVerificador(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[10]);
}

export function cnpjValido(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  return digitoVerificador(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12])
    && digitoVerificador(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13]);
}

/** Tenta descobrir o tipo pelo jeito que a chave foi escrita. */
export function tipoDaChave(texto) {
  const t = String(texto ?? "").trim();
  if (t.includes("@")) return "email";
  if (ALEATORIA.test(t.toLowerCase())) return "aleatoria";
  if (t.startsWith("+")) return "celular";
  const d = soDigitos(t);
  if (d.length === 14) return "documento";
  if (d.length === 11) {
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(t)) return "documento";
    return /[()]/.test(t) || !cpfValido(d) ? "celular" : "documento";
  }
  if (d.length === 13 && d.startsWith("55")) return "celular";
  return null;
}

/** Devolve a chave no formato do PIX, ou lança um erro que explica o que corrigir. */
export function normalizarChavePix(texto, tipo = tipoDaChave(texto)) {
  const t = String(texto ?? "").trim();
  if (!t) throw new Error("Informe a chave PIX.");
  const d = soDigitos(t);
  switch (tipo) {
    case "documento":
      if (d.length === 11) { if (cpfValido(d)) return d; throw new Error("Esse CPF não confere. Veja se algum número ficou trocado."); }
      if (d.length === 14) { if (cnpjValido(d)) return d; throw new Error("Esse CNPJ não confere. Veja se algum número ficou trocado."); }
      throw new Error("O CPF tem 11 números e o CNPJ tem 14.");
    case "celular": {
      const numero = d.length === 13 && d.startsWith("55") ? d.slice(2) : d;
      if (!/^[1-9][1-9]9\d{8}$/.test(numero)) throw new Error("Use o celular com DDD, por exemplo (11) 98765-4321.");
      return `+55${numero}`;
    }
    case "email": {
      const email = t.toLowerCase();
      if (!EMAIL.test(email) || email.length > 77) throw new Error("Esse e-mail não parece certo.");
      return email;
    }
    case "aleatoria": {
      const chave = t.toLowerCase();
      if (!ALEATORIA.test(chave)) throw new Error("A chave aleatória tem 32 letras e números separados por traços. Copie e cole do app do banco.");
      return chave;
    }
    default:
      throw new Error("Não reconheci essa chave. Use CPF, CNPJ, celular com DDD, e-mail ou a chave aleatória.");
  }
}
