/** Pedido de mudança recusado; a mensagem já está em PT-BR para a tela. O servidor a converte em UserFacingError. */
export class FuncaoInvalidaError extends Error {}

/**
 * Registro das funções novas da Fase B (regra do dono): cada uma tem liga/desliga, números e textos editáveis em
 * Configurações › Recursos. Quem manda mensagem para a cliente nasce DESLIGADA. Cada task acrescenta a sua entrada em FUNCOES.
 */
export type FuncaoParam = { key: string; label: string; unit?: string; min: number; max: number; default: number };
/** `vars` sem chaves: ["nome", "setor"] vira {nome}, {setor} no texto. */
export type FuncaoTexto = { key: string; label: string; help?: string; vars: string[]; default: string };
export type FuncaoDef = {
  key: string; label: string; description: string;
  /** true => padraoLigada TEM de ser false (um teste garante para o registro inteiro). */
  enviaParaCliente: boolean;
  padraoLigada: boolean;
  /** Tela própria que liga/desliga (menu, lembrete…): aqui só aparece o link, sem interruptor. */
  ligaEm?: string;
  params?: FuncaoParam[]; textos?: FuncaoTexto[];
};
export const FUNCOES: FuncaoDef[] = [
  { key: "setores", label: "Setores", description: "Passar a conversa para um setor (Recepção, Método Fiaes®, Serviços gerais): vai para quem do setor está Disponível. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true,
    textos: [{ key: "sem_ninguem", label: "Aviso: ninguém livre no setor", help: "Aparece no sino da gestão quando a conversa foi para um setor e ninguém dele estava Disponível.",
      vars: ["nome", "setor"], default: "Ninguém livre no setor {setor} para atender {nome}." }] },
  { key: "consentimento", label: "O que a cliente aceita", description: "Na ficha: se ela recebe campanhas por WhatsApp, se pode ser atendida com ajuda da IA e se quer CPF na nota. Quem disse Não fica de fora da mensagem em massa e da IA. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "pausa_automaticas", label: "Automáticas pausadas", description: "Interruptor na conversa para pausar tudo o que é automático para uma cliente (menu, regras, lembrete, Depois do atendimento, massa), até amanhã ou até religar. A mensagem programada à mão continua saindo. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "dias_especiais", label: "Dias especiais", description: "Feriado e horário reduzido em dias avulsos (Configurações › Horário de funcionamento). Valem para as mensagens, os prazos e a Agenda: dia fechado cria o bloqueio Feriado da Casa inteira. Desligada, os dias especiais deixam de valer (os bloqueios já criados na Agenda ficam). Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true,
    params: [{ key: "dias_a_frente", label: "Até quantos dias à frente", unit: "dias", min: 7, max: 366, default: 60 }] },
  { key: "biblioteca", label: "Biblioteca", description: "Os arquivos da Casa (tabela de preços, resultados, cuidados, como chegar) num lugar só, para mandar em um toque pelo clipe da conversa. Desligada, o clipe esconde “Da biblioteca” e subir ou enviar é recusado. Só sai quando a atendente toca em Enviar.",
    enviaParaCliente: false, padraoLigada: true,
    params: [{ key: "tamanho_max_mb", label: "Tamanho máximo do arquivo", unit: "MB", min: 1, max: 16, default: 16 }] },
  { key: "regras_acontecimento", label: "Regras por acontecimento", description: "Regras de Configurações › Automações que agem na hora em que algo acontece: a cliente escreve uma palavra, chega um contato novo, ligação perdida, foto, áudio, vídeo ou documento recebido, etiqueta colocada. Cada regra nasce desligada, e ligar uma que manda mensagem pede a confirmação de envio real. Vale só para o que acontecer depois de ligar. Desligada, nenhuma regra por acontecimento age.",
    enviaParaCliente: false, padraoLigada: true,
    params: [{ key: "horas_max_mensagem", label: "Ignorar mensagem com mais de", unit: "horas", min: 1, max: 48, default: 6 },
      /* Vale para toda regra (de tempo e de acontecimento): "Enviar mensagem" e "Enviar um arquivo" depois de X min. Conferido ao salvar a regra. */
      { key: "atraso_max_min", label: "Atraso máximo de uma ação", unit: "min", min: 0, max: 1440, default: 240 }] },
  { key: "virada", label: "Troca do ChatGuru para o CRM", description: "O lembrete da véspera e o Depois do atendimento só ligam depois do checklist (o do ChatGuru e o do Avec desligados, o texto conferido e um teste de verdade recebido no seu WhatsApp). Liga em Configurações › Troca do ChatGuru para o CRM. Não manda nada para a cliente: o teste vai para o número que você digitar.",
    enviaParaCliente: false, padraoLigada: true, ligaEm: "/config/virada",
    params: [{ key: "horas_validade_teste", label: "O teste vale por", unit: "horas", min: 1, max: 72, default: 24 }] },
  { key: "reagir", label: "Reagir a mensagens", description: "Segurando uma mensagem na conversa, a atendente reage com 👍 ❤️ 🙏 ou 😂 e a cliente vê a reação no WhatsApp. Só sai quando a atendente toca. Desligada, o item some da conversa.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "editar_mensagem", label: "Editar mensagem enviada", description: "Segurando uma mensagem que a própria atendente enviou pelo CRM, ela edita o texto dentro do prazo e a cliente vê “Editada”. O texto antigo fica registrado. Só edita quando a atendente toca. Desligada, o item some.",
    enviaParaCliente: false, padraoLigada: true,
    params: [{ key: "janela_min", label: "Dá para editar até", unit: "min", min: 1, max: 15, default: 15 }] },
  { key: "como_chegar", label: "Como chegar", description: "No “+” do campo de mensagem, manda o pino da Casa no mapa (cadastrado em Página da cliente) para a cliente. Só sai quando a atendente toca. Desligada, o item some.",
    enviaParaCliente: false, padraoLigada: true,
    textos: [{ key: "nome_pino", label: "Nome do pino no mapa", help: "O nome que a cliente vê no pino que a Casa manda (o endereço vem de Página da cliente).", vars: [], default: "Casa Fiaes" }] },
  { key: "mandar_contato", label: "Mandar contato", description: "No “+” do campo de mensagem, manda um cartão de contato (nome e telefone) para a cliente. Só sai quando a atendente toca. Desligada, o item some.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "encaminhar", label: "Encaminhar mensagem", description: "Segurando uma mensagem (texto, foto, vídeo, áudio ou documento), a atendente a encaminha para outras conversas; em Selecionar, marca várias e encaminha todas de uma vez, na ordem da conversa. Para uma conversa de Equipe vai com o cabeçalho de origem; para uma cliente vai só o conteúdo, sem o nome nem o telefone de quem estava na conversa. Só sai quando a atendente toca em Enviar; dali os envios seguem sozinhos (ela não fica esperando) e o que não sair vira aviso no sino de quem encaminhou. Desligada, o item some.",
    enviaParaCliente: false, padraoLigada: true,
    params: [{ key: "max_destinos", label: "Encaminhar para até", unit: "conversas", min: 1, max: 20, default: 10 },
      { key: "max_mensagens", label: "Encaminhar várias: selecionar até", unit: "mensagens", min: 1, max: 50, default: 30 }],
    textos: [{ key: "cabecalho_equipe", label: "Cabeçalho para conversa de Equipe", help: "Só vai quando o destino é uma conversa de Equipe. Para cliente, nada disso é enviado.", vars: ["nome", "data"], default: "Encaminhada da conversa com {nome}, {data}:" },
      { key: "cabecalho_equipe_varias", label: "Cabeçalho para Equipe (várias mensagens)", help: "Encaminhando várias de uma vez para uma conversa de Equipe, vai uma vez só, antes delas. Para cliente, nada disso é enviado.", vars: ["nome"], default: "Encaminhadas da conversa com {nome}:" }] },
  { key: "marcar_nao_lida", label: "Marcar como não lida", description: "No menu ⋯ da conversa, a atendente marca a conversa como não lida para voltar a ela depois. Aparece em Não lidas na Fila; abrir a conversa limpa a marca. Não toca som, não cria aviso e não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "acompanhar", label: "Acompanhar", description: "A atendente acompanha conversas (estrela no menu ⋯ da conversa) e elas ficam numa lista só dela no Hoje, chamada Acompanhando, mesmo depois de resolvidas, até ela deixar de acompanhar. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  // Fase C (liga/desliga simples, sem números nem textos):
  { key: "marcadores", label: "Marcador do horário", description: "Desligada, o marcador (VER OBS, Não Cobrar…) some do horário e da Agenda; os que já foram postos ficam guardados. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "tipo_horario", label: "Tipo do horário", description: "Desligada, o tipo do horário (Pediu ela, Indicação, Noiva…) some da Agenda; os que já foram postos ficam guardados. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "aviso_salta", label: "Aviso que salta", description: "Desligada, o Aviso da cliente deixa de saltar na tela ao abrir o horário; ele continua na ficha. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "uso_imagem", label: "Uso de imagem", description: "Desligada, some da ficha a marcação de uso de imagem da cliente; o que já foi marcado fica guardado. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "fichas", label: "Fichas da cliente", description: "Desligada, somem a anamnese, a consultoria de imagem e os campos da ficha; as respostas já dadas ficam guardadas. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "fotos", label: "Fotos de antes e depois", description: "Desligada, não dá para adicionar nem ver fotos de antes e depois; as fotos já guardadas ficam como estão. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "fidelidade", label: "Fidelidade", description: "Desligada, a cliente não acumula pontos e o prêmio não aparece na comanda; o que já foi somado fica guardado. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "preco_por_profissional", label: "Preço e tempo por profissional", description: "Desligada, todo serviço volta a ter um preço e um tempo só, iguais para todas as profissionais. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "junto_com_outro", label: "Serviço junto com outro", description: "Desligada, some da ficha do serviço o “Pode ser feito junto com outro” e a Agenda volta ao de antes: horário da cliente com outra profissional ao mesmo tempo vira encaixe. Os horários já marcados não mudam. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "repetir", label: "Repetir horário", description: "Desligada, some a opção de marcar o mesmo horário a cada X semanas; os horários já repetidos ficam na Agenda. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "passar_dia", label: "Passar o dia", description: "Desligada, some a opção de passar o dia de uma profissional para outra; nada que já foi passado muda. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "unir", label: "Unir cadastros", description: "Desligada, some a opção de unir cadastros duplicados em Clientes. Não manda nada para a cliente.",
    enviaParaCliente: false, padraoLigada: true },
  { key: "retomada_ia", label: "Retomada pela IA", description: "Retomar sem mensagem escrita (inclusive a retomada que a sugestão da IA propôs) deixa de ser só lembrete: no dia e na hora marcados, a IA lê a conversa, escreve a mensagem a partir do que a atendente disse (ou do motivo) e ENVIA SOZINHA, assinada por quem marcou. Não sai se a cliente escreveu depois, se a conversa foi marcada “Não é cliente” ou se passou do limite do dia: aí fica o lembrete para a equipe. Desligada, Retomar sem texto volta a ser só lembrete.",
    enviaParaCliente: true, padraoLigada: false,
    params: [{ key: "max_dia", label: "No máximo por dia", unit: "mensagens", min: 1, max: 200, default: 40 }] },
];

export type FuncoesState = Record<string, { on?: boolean; params?: Record<string, number>; textos?: Record<string, string> }>;
export type FuncaoPatch = { on?: boolean; params?: Record<string, number>; textos?: Record<string, string | null> };

export function resolveFuncao(def: FuncaoDef, state: FuncoesState): { on: boolean; params: Record<string, number>; textos: Record<string, string> } {
  const raw = state[def.key] as unknown;
  const s = typeof raw === "boolean" ? { on: raw } : (raw as FuncoesState[string] | undefined) ?? {};
  const params: Record<string, number> = {};
  for (const p of def.params ?? []) { const v = s.params?.[p.key]; params[p.key] = typeof v === "number" && Number.isFinite(v) ? v : p.default; }
  const textos: Record<string, string> = {};
  for (const t of def.textos ?? []) { const v = s.textos?.[t.key]; textos[t.key] = typeof v === "string" && v.trim() ? v : t.default; }
  return { on: typeof s.on === "boolean" ? s.on : def.padraoLigada, params, textos };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Confere o pedido de mudança. Lança UserFacingError com a mensagem em PT-BR. */
export function validateFuncaoPatch(def: FuncaoDef, patch: unknown): FuncaoPatch {
  if (!isObj(patch)) throw new FuncaoInvalidaError("Pedido inválido.");
  for (const k of Object.keys(patch)) if (!["on", "params", "textos"].includes(k)) throw new FuncaoInvalidaError(`Campo desconhecido: ${k}.`);
  const out: FuncaoPatch = {};
  if (patch.on !== undefined) {
    if (typeof patch.on !== "boolean") throw new FuncaoInvalidaError("Pedido inválido.");
    out.on = patch.on;
  }
  if (patch.params !== undefined) {
    if (!isObj(patch.params)) throw new FuncaoInvalidaError("Pedido inválido.");
    out.params = {};
    for (const [k, v] of Object.entries(patch.params)) {
      const p = def.params?.find((x) => x.key === k);
      if (!p) throw new FuncaoInvalidaError(`Número desconhecido: ${k}.`);
      if (typeof v !== "number" || !Number.isFinite(v) || v < p.min || v > p.max) throw new FuncaoInvalidaError(`${p.label}: use um número de ${p.min} a ${p.max}.`);
      out.params[k] = v;
    }
  }
  if (patch.textos !== undefined) {
    if (!isObj(patch.textos)) throw new FuncaoInvalidaError("Pedido inválido.");
    out.textos = {};
    for (const [k, v] of Object.entries(patch.textos)) {
      const t = def.textos?.find((x) => x.key === k);
      if (!t) throw new FuncaoInvalidaError(`Texto desconhecido: ${k}.`);
      if (v === null) { out.textos[k] = null; continue; }
      if (typeof v !== "string" || !v.trim()) throw new FuncaoInvalidaError(`${t.label}: escreva o texto ou use o sugerido.`);
      const bad = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).find((x) => !t.vars.includes(x));
      if (bad) throw new FuncaoInvalidaError(`${t.label}: a variável {${bad}} não existe aqui. Use: ${t.vars.map((x) => `{${x}}`).join(", ")}.`);
      out.textos[k] = v.trim();
    }
  }
  return out;
}

/** {nome} -> valor; variável desconhecida fica como está. */
export function fillTexto(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? vars[k] : m));
}

/** As funções da Fase C (liga/desliga simples): o nome é a chave de FUNCOES. */
export const FUNCOES_FASE_C = ["marcadores", "tipo_horario", "aviso_salta", "uso_imagem", "fichas", "fotos", "fidelidade", "preco_por_profissional", "junto_com_outro", "repetir", "passar_dia", "unir"] as const;
export type Funcao = (typeof FUNCOES_FASE_C)[number];
export type Funcoes = Record<Funcao, boolean>;
export const FUNCAO_LABEL = labelsOf(FUNCOES_FASE_C, "label");
export const FUNCAO_HELP = labelsOf(FUNCOES_FASE_C, "description");
function labelsOf(keys: readonly Funcao[], f: "label" | "description"): Record<Funcao, string> {
  return Object.fromEntries(keys.map((k) => [k, FUNCOES.find((d) => d.key === k)![f]])) as Record<Funcao, string>;
}
export const isFuncao = (x: string): x is Funcao => (FUNCOES_FASE_C as readonly string[]).includes(x);
/** Quantas funções do registro inteiro estão ligadas (a conta do cartão Funções em Configurações). */
export const funcoesLigadas = (state: FuncoesState): number => FUNCOES.filter((d) => resolveFuncao(d, state).on).length;
