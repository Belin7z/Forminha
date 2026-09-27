/* Porta de entrada da API da Central na Vercel: todo /api/* chega aqui (ver vercel.json). */
import { criarCentral } from "../lib/central.js";

const central = criarCentral(process.env);

export default function handler(req, res) {
  return central.tratar(req, res);
}
