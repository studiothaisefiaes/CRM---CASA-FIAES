import { cnpjDigits, isValidCnpj } from "./cnpj";

/**
 * Nota fiscal da Casa (Fase D, Configurações › Nota fiscal). Módulo puro com padrão e leitura tolerante, no molde de caixa-settings.
 * Segredos (certificado A1, senha, CSC) NUNCA moram aqui nem no banco: só no .env do servidor.
 */
export type FiscalModo = "desligada" | "teste" | "producao";
export const isFiscalModo = (v: unknown): v is FiscalModo => v === "desligada" || v === "teste" || v === "producao";

export type FiscalEmpresa = {
  cnpj: string | null; razaoSocial: string | null; inscricaoMunicipal: string | null; inscricaoEstadual: string | null;
  regime: "simples" | "presumido" | null; aliquotaSimplesBp: number | null;
  /** Alíquota do ISS (pAliq da DPS), em pontos-base de 200 a 500 (2% a 5%). Só entra na nota com `fiscal_regras.informarAliquotaNaDps`. */
  aliquotaIssBp: number | null;
  codigoMunicipio: "2927408";
  endereco: { logradouro: string; numero: string; bairro: string; cep: string } | null;
  /** Código de tributação nacional do serviço (cTribNac). 060101 = barbearia, cabeleireiros, manicure, pedicure e congêneres. */
  cTribNacPadrao: string;
  /** NBS padrão do serviço. Vazio por decisão: o 126021000 é só sugestão na tela. */
  nbsPadrao: string | null;
  serieDps: number; serieNfce: number; emitirAoFechar: boolean;
};
export const DEFAULT_FISCAL_EMPRESA: FiscalEmpresa = {
  cnpj: null, razaoSocial: null, inscricaoMunicipal: null, inscricaoEstadual: null, regime: null, aliquotaSimplesBp: null, aliquotaIssBp: null, codigoMunicipio: "2927408",
  endereco: null, cTribNacPadrao: "060101", nbsPadrao: null, serieDps: 1, serieNfce: 1, emitirAoFechar: false,
};
/** Faixa da alíquota do ISS em pontos-base (2% a 5%, LC 116/2003). */
export const ALIQUOTA_ISS_BP = { min: 200, max: 500 } as const;
export const isAliquotaIssBp = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= ALIQUOTA_ISS_BP.min && v <= ALIQUOTA_ISS_BP.max;
/** Só sugestão na tela (conferência em fonte oficial); o padrão gravado continua vazio. */
export const NBS_SUGERIDO = "126021000";

const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);
const digits = (v: unknown, len: number) => (typeof v === "string" && new RegExp(`^[0-9]{${len}}$`).test(v.replace(/\D/g, "")) ? v.replace(/\D/g, "") : null);
const serie = (v: unknown, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 999 ? v : d);

export function readFiscalEmpresa(v: unknown): FiscalEmpresa {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_FISCAL_EMPRESA;
  const e = (r.endereco && typeof r.endereco === "object" ? r.endereco : null) as Record<string, unknown> | null;
  const endereco = e && str(e.logradouro, 120) && str(e.numero, 20) && str(e.bairro, 80) && digits(e.cep, 8)
    ? { logradouro: str(e.logradouro, 120)!, numero: str(e.numero, 20)!, bairro: str(e.bairro, 80)!, cep: digits(e.cep, 8)! } : null;
  const cnpj = typeof r.cnpj === "string" ? cnpjDigits(r.cnpj) : "";
  return {
    cnpj: isValidCnpj(cnpj) ? cnpj : null,
    razaoSocial: str(r.razaoSocial, 150), inscricaoMunicipal: str(r.inscricaoMunicipal, 20), inscricaoEstadual: str(r.inscricaoEstadual, 20),
    regime: r.regime === "simples" || r.regime === "presumido" ? r.regime : null,
    aliquotaSimplesBp: typeof r.aliquotaSimplesBp === "number" && Number.isInteger(r.aliquotaSimplesBp) && r.aliquotaSimplesBp >= 0 && r.aliquotaSimplesBp <= 10000 ? r.aliquotaSimplesBp : null,
    aliquotaIssBp: isAliquotaIssBp(r.aliquotaIssBp) ? r.aliquotaIssBp : null,
    codigoMunicipio: "2927408",
    endereco,
    cTribNacPadrao: digits(r.cTribNacPadrao, 6) ?? d.cTribNacPadrao,
    nbsPadrao: digits(r.nbsPadrao, 9),
    serieDps: serie(r.serieDps, d.serieDps), serieNfce: serie(r.serieNfce, d.serieNfce),
    emitirAoFechar: typeof r.emitirAoFechar === "boolean" ? r.emitirAoFechar : d.emitirAoFechar,
  };
}

/** Variáveis aceitas em cada texto da discriminação (entre chaves). */
export const FISCAL_TEXT_VARS = {
  servicos: ["servicos"],
  parceria: ["cota_salao", "cotas_parceiras"],
  cotaParceira: ["razao_social", "cnpj", "valor"],
} as const;
export type FiscalTextKey = keyof typeof FISCAL_TEXT_VARS;
export type FiscalTextos = Record<FiscalTextKey, string>;

export type FiscalRegras = {
  /** Mostra "Dados da nota (para o nfse.gov.br)" na comanda fechada com a chave desligada. */ rascunhoNaComanda: boolean;
  /** Envios com falha antes de virar erro_envio (1 a 50). */ tentativasMax: number;
  /** Teto da espera entre tentativas, em minutos (1 a 240). */ esperaMaxMin: number;
  /** "Certificado vence em X dias" aparece na prontidão com menos que isto (1 a 120). */ certAvisoDias: number;
  /** Prazo de cancelamento da NFC-e, em minutos (1 a 10080). RICMS-BA art. 107-H: 30 min. */ nfceCancelarAteMin: number;
  /** NÃO CONFIRMADO: o manual de 2022 diz SHA-1, o guia NFS-e Via 2025 diz SHA-256. */ assinaturaNfse: "sha1" | "sha256";
  /** NÃO CONFIRMADO: ME/EPP sem retenção, o Anexo I proíbe pAliq se o município estiver "Ativo". */ informarAliquotaNaDps: boolean;
  textos: FiscalTextos;
};
export const DEFAULT_FISCAL_TEXTOS: FiscalTextos = {
  servicos: "Serviços de beleza: {servicos}.",
  parceria: " Salão-parceiro (Lei 13.352/2016): cota-parte do salão {cota_salao}; {cotas_parceiras}.",
  cotaParceira: "cota-parte de {razao_social} (CNPJ {cnpj}) {valor}",
};
export const DEFAULT_FISCAL_REGRAS: FiscalRegras = {
  rascunhoNaComanda: true, tentativasMax: 10, esperaMaxMin: 30, certAvisoDias: 30, nfceCancelarAteMin: 30,
  assinaturaNfse: "sha1", informarAliquotaNaDps: false, textos: DEFAULT_FISCAL_TEXTOS,
};
export const FISCAL_REGRAS_LIMITES = {
  tentativasMax: [1, 50], esperaMaxMin: [1, 240], certAvisoDias: [1, 120], nfceCancelarAteMin: [1, 10080],
} as const;
export const NAO_CONFIRMADO = "Valor não confirmado no manual oficial: confira com o contador e no teste da Produção Restrita.";

const inRange = (v: unknown, [min, max]: readonly [number, number], d: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : d);

export function readFiscalRegras(v: unknown): FiscalRegras {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_FISCAL_REGRAS;
  const t = (r.textos && typeof r.textos === "object" ? r.textos : {}) as Record<string, unknown>;
  const text = (k: FiscalTextKey) => (typeof t[k] === "string" && t[k].trim() ? (t[k] as string) : d.textos[k]);
  return {
    rascunhoNaComanda: typeof r.rascunhoNaComanda === "boolean" ? r.rascunhoNaComanda : d.rascunhoNaComanda,
    tentativasMax: inRange(r.tentativasMax, FISCAL_REGRAS_LIMITES.tentativasMax, d.tentativasMax),
    esperaMaxMin: inRange(r.esperaMaxMin, FISCAL_REGRAS_LIMITES.esperaMaxMin, d.esperaMaxMin),
    certAvisoDias: inRange(r.certAvisoDias, FISCAL_REGRAS_LIMITES.certAvisoDias, d.certAvisoDias),
    nfceCancelarAteMin: inRange(r.nfceCancelarAteMin, FISCAL_REGRAS_LIMITES.nfceCancelarAteMin, d.nfceCancelarAteMin),
    assinaturaNfse: r.assinaturaNfse === "sha1" || r.assinaturaNfse === "sha256" ? r.assinaturaNfse : d.assinaturaNfse,
    informarAliquotaNaDps: typeof r.informarAliquotaNaDps === "boolean" ? r.informarAliquotaNaDps : d.informarAliquotaNaDps,
    textos: { servicos: text("servicos"), parceria: text("parceria"), cotaParceira: text("cotaParceira") },
  };
}

/** Variáveis `{x}` que o texto usa e que não existem para aquele texto. */
export function unknownFiscalVars(key: FiscalTextKey, text: string): string[] {
  const ok = FISCAL_TEXT_VARS[key] as readonly string[];
  return [...new Set([...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]))].filter((n) => !ok.includes(n));
}
/** Troca `{variavel}` pelo valor; variável sem valor fica como está (a validação ao salvar impede chegar aqui). */
export const fillFiscalText = (text: string, vars: Record<string, string>) => text.replace(/\{([^{}]*)\}/g, (m, n: string) => (n in vars ? vars[n] : m));

/** "Certificado vence em X dias" quando faltam menos de `avisoDias`; vencido também avisa. Data desconhecida = sem aviso. */
export function certExpiryWarning(venceEm: Date | null, avisoDias: number, now = new Date()): string | null {
  if (!venceEm) return null;
  const dias = Math.ceil((venceEm.getTime() - now.getTime()) / 86_400_000);
  if (dias < 0) return "Certificado vencido";
  return dias < avisoDias ? `Certificado vence em ${dias} ${dias === 1 ? "dia" : "dias"}` : null;
}
