import { isValidCpf } from "@/lib/cpf";

/**
 * Tira dados pessoais do texto antes de ir para a IA (pedido do dono): CPF, telefone e e-mail viram marcadores.
 * Preço, hora e data ficam (a IA precisa deles para entender o pedido).
 */
const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu;
// CPF (revisão de segurança 17/10, M4): 3-3-3-2 dígitos com qualquer separador entre os grupos (espaço, ponto, hífen, barra ou nenhum).
const SEP = String.raw`[\s./-]?`;
const CPF_DIGITS = String.raw`\d{3}${SEP}\d{3}${SEP}\d{3}${SEP}\d{2}`;
// Depois da palavra "CPF", ou na máscara 000.000.000-00: é CPF mesmo com o dígito verificador errado (a cliente digitou errado).
const CPF_WORD = new RegExp(String.raw`(cpf\W{0,5})${CPF_DIGITS}(?!\d)`, "giu");
const CPF_MASK = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g;
// Solto, sem a palavra: só vira [CPF] se o dígito verificador bate; senão segue para a regra de telefone.
const CPF_LOOSE = new RegExp(String.raw`(?<!\d)${CPF_DIGITS}(?!\d)`, "g");
// +55 (71) 99999-1234, 71 99999-1234, 71999991234, 3333-4444: 8 ou mais dígitos com separadores de telefone.
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}\b/g;

export function redact(text: string): string {
  return text.replace(EMAIL, "[e-mail]")
    .replace(CPF_WORD, "$1[CPF]").replace(CPF_MASK, "[CPF]").replace(CPF_LOOSE, (m) => (isValidCpf(m) ? "[CPF]" : m))
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[telefone]" : m));
}
