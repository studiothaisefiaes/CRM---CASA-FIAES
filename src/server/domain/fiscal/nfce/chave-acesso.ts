/**
 * Chave de acesso de 44 números da NFC-e (porte de `lib/fiscal/chaveAcesso.ts` do Norte Vendas):
 * cUF(2) + AAMM(4) + CNPJ(14) + modelo(2) + série(3) + nNF(9) + tpEmis(1) + cNF(8) + DV(1).
 * O DV é o módulo 11 com pesos 2 a 9 ciclando da direita para a esquerda (resto < 2 vira 0). Mesma fórmula já validada contra a SEFAZ
 * real em `scripts/nfce-referencia/gerar-nfce-teste.mjs` (chaves autorizadas pela SVRS para a BA em 04/08 e 06/08/2026).
 */
export function dvChave(chave43: string): number {
  if (!/^[0-9]{43}$/.test(chave43)) throw new Error("A chave sem o DV tem 43 números.");
  let soma = 0, peso = 2;
  for (const d of chave43.split("").reverse().map(Number)) {
    soma += d * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const pad = (n: number | string, len: number) => String(n).padStart(len, "0");

export type DadosChave = {
  /** Código IBGE da UF: 29 = Bahia. */ cUF: number;
  /** "AAMM" da emissão. */ anoMes: string;
  cnpj: string;
  serie: number; numero: number;
  /** 1 = emissão normal (contingência offline fica fora desta fase). */ tpEmis?: number;
  /** Código numérico de 8 números (sorteado por `cNFDe`). */ cNF: string;
};

/** Monta a chave do modelo 65 (NFC-e). */
export function montarChaveAcesso(d: DadosChave): string {
  const cnpj = d.cnpj.replace(/\D/g, "");
  if (cnpj.length !== 14) throw new Error("CNPJ da chave precisa de 14 números.");
  if (!/^[0-9]{4}$/.test(d.anoMes)) throw new Error("AAMM da chave inválido.");
  if (!Number.isInteger(d.serie) || d.serie < 0 || d.serie > 999) throw new Error("Série da NFC-e fora da faixa (0 a 999).");
  if (!Number.isInteger(d.numero) || d.numero < 1 || d.numero > 999_999_999) throw new Error("Número da NFC-e fora da faixa (1 a 999999999).");
  if (!/^[0-9]{8}$/.test(d.cNF)) throw new Error("O cNF tem 8 números.");
  const semDV = `${pad(d.cUF, 2)}${d.anoMes}${cnpj}65${pad(d.serie, 3)}${pad(d.numero, 9)}${d.tpEmis ?? 1}${d.cNF}`;
  return semDV + dvChave(semDV);
}

/**
 * cNF sorteado (8 números). A SEFAZ recusa o cNF igual ao número da nota (o código existe para a chave não ser adivinhada pela sequência).
 * `random` só é injetado nos testes.
 */
export function cNFDe(numero: number, random: () => number = Math.random): string {
  let v = Math.floor(random() * 100_000_000) % 100_000_000;
  if (v === numero % 100_000_000) v = (v + 1) % 100_000_000;
  return pad(v, 8);
}
