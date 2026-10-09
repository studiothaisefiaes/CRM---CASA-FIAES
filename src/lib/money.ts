// Um único jeito de ler dinheiro digitado (pt-BR primeiro, "1158.50" aceito).
export type ParsedBRL = { ok: true; cents: number } | { ok: false; error: string };

export function parseBRL(input: string): ParsedBRL {
  const s = input.replace(/R\$|\s/g, "");
  if (!s || !/^\d[\d.,]*$/.test(s)) return { ok: false, error: "Digite um valor, ex.: 1.158,50" };
  let intPart: string;
  let dec = "";
  if (s.includes(",")) {
    const [a, b, ...rest] = s.split(",");
    if (rest.length || !/^\d{1,2}$/.test(b) || !/^\d{1,3}(\.\d{3})*$|^\d+$/.test(a)) return { ok: false, error: "Valor inválido" };
    intPart = a.replace(/\./g, "");
    dec = b;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, dec] = s.split("."); // 1158.50
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    intPart = s.replace(/\./g, ""); // 1.158 = milhar
  } else {
    return { ok: false, error: "Valor inválido" };
  }
  const cents = Number(intPart) * 100 + Number(dec.padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(cents)) return { ok: false, error: "Valor grande demais" };
  return { ok: true, cents };
}

/** "R$ 1.158,50" com espaço normal (o Intl usa U+00A0). */
export const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
