import { createHash } from "node:crypto";
import { normHeader } from "./normalize";

/**
 * Formatos dos relatórios do Avec. O formato é reconhecido pelo CONJUNTO de cabeçalhos (não pela assinatura exata), para que uma
 * coluna a mais ou em outra ordem não quebre a importação. A assinatura (md5 dos cabeçalhos unidos por "|", 8 primeiros dígitos,
 * a mesma de docs/avec-formatos.json) serve só para agrupar os relatórios guardados e dar o título.
 */

/** Para onde as linhas de um formato vão. */
export type AvecRole =
  | "profissionais" | "servicos" | "contatos" | "agendamentos" | "cancelamentos" | "sem_baixa"
  | "bloqueios" | "pacotes" | "usos_pacote" | "itens" | "pagamentos" | "fichas" | "fidelidade" | "produtos";

export type AvecFormat = { signature: string; title: string; roles: AvecRole[] };

export const signatureOf = (header: string[]) => createHash("md5").update(header.join("|")).digest("hex").slice(0, 8);

/** Índice da primeira coluna (por nome normalizado) que existir, na ordem pedida; -1 se nenhuma. */
export function colOf(header: string[], ...names: string[]): number {
  const h = header.map(normHeader);
  for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
  return -1;
}

/** Nomes de coluna por assunto (normalizados). */
export const COLS = {
  client: ["cliente", "nome do cliente", "nome cliente", "nome", "clientes"],
  phone: ["celular", "telefone", "whatsapp"],
  email: ["e-mail", "email"],
  birthday: ["aniversario", "data de nascimento", "data nascimento"],
  lastVisit: ["ultima visita"],
  clientSinceAny: ["data cadastro cliente"],
  clientSinceList: ["cadastrado", "data de cadastro", "data cadastro", "cliente desde"],
  comanda: ["comanda", "numero comanda", "nº comanda", "n° comanda", "comanda n°", "comanda nº", "n° da comanda", "nº da comanda"],
  item: ["item", "servico", "servico ou produto"],
  itemDate: ["data", "data comanda", "data da comanda"],
  value: ["valor", "valor cobrado", "valor r$", "total cobrado", "total"],
  professional: ["profissional", "nome do profissional"],
} as const;

/** Coluna do saldo no 0149 (normalizada). */
export const STOCK_COLS = ["qtd. estoque", "qtd estoque", "estoque"] as const;

const PAYMENT_HINTS = ["forma de pagamento", "forma pagamento", "forma pag.", "split", "data pagamento", "recibo id"];

/** Papéis (destinos) de um cabeçalho. */
export function rolesOf(header: string[]): AvecRole[] {
  const h = new Set(header.map(normHeader));
  const has = (...n: string[]) => n.every((x) => h.has(x));
  const any = (names: readonly string[]) => names.some((x) => h.has(x));
  const dated = [...h].some((c) => c.startsWith("data") || c === "compra" || c === "competencia");
  const roles: AvecRole[] = [];

  const isProfessionals = has("apelido", "cargo") && any(["nome", "profissional"]);
  if (isProfessionals) roles.push("profissionais");
  // Catálogo = serviço com preço ("Valor"). Comissão/tempo por profissional (413 mil linhas), faturamento e valor médio não são catálogo.
  if (has("servico", "valor") && !any(COLS.client) && !h.has("profissional") && !h.has("comissao") && !dated && !h.has("comanda")) roles.push("servicos");
  // Lista de clientes EXCLUÍDAS no Avec (Data Exclusão, Responsável Exclusão): não recria ninguém como contato.
  const deleted = [...h].some((c) => c.includes("exclusao") || c.startsWith("deletad"));
  // 0113 (pontos de fidelidade): tem Cliente e Celular, mas é saldo, não cadastro: não cria cliente.
  const isLoyalty = has("pontos gerados", "saldo atual") && any(COLS.client);
  if (!isProfessionals && !deleted && !isLoyalty && any(COLS.client) && any(COLS.phone)) roles.push("contatos");
  if (has("data reserva", "hora", "cliente")) roles.push("agendamentos");
  if (has("cancelamento", "cliente", "servico")) roles.push("cancelamentos");
  // 0248 "Agendamentos por status" com o filtro "Agendado" (gap Avec, A1): reservas que ficaram Agendado no Avec, sem baixa. Não é lista de
  // espera (o Avec não tem). Não cria horário: só marca a reserva que bate (`importUnclosed`).
  if (has("data", "cliente", "servico", "obs") && any(["ultima atualizacao", "responsavel ultima atualizacao"]) && !h.has("hora") && !h.has("status")) roles.push("sem_baixa");
  if (has("data inicial", "data final", "hora inicial", "hora final")) roles.push("bloqueios");
  if (has("cliente", "pacote", "total", "utilizados")) roles.push("pacotes");
  if (has("do pacote", "cliente", "item", "data")) roles.push("usos_pacote");
  // Vendas só do relatório completo de itens de comanda (com Tipo e Categoria): o Avec repete as mesmas vendas em outros relatórios, cada um
  // escrevendo o item de um jeito ("X", "X - 3474…", "X - null") e com ou sem profissional, o que duplicava (54 mil itens para 26 mil reais).
  // O "sem contato" (mesmas colunas, sem telefone) às vezes traz outro valor para o mesmo item (R$ 0 x R$ 80): fica só guardado.
  if (has("tipo", "categoria") && any(COLS.phone) && any(COLS.itemDate) && any(COLS.comanda) && any(COLS.item) && any(COLS.client) && any(COLS.value) && !PAYMENT_HINTS.some((x) => h.has(x)) && !roles.includes("usos_pacote")) roles.push("itens");
  if (any(["forma de pagamento"]) && any(COLS.comanda) && has("valor", "data pagamento") && any(COLS.client) && !any(COLS.item)) roles.push("pagamentos");
  // 0115/2115 (anamnese) e 0116 (prontuário, com Comanda): uma linha por resposta, "Campo" + "Slug" + "Valor" de uma cliente.
  if (has("campo", "slug", "valor") && any(COLS.client)) roles.push("fichas");
  // 0113: um saldo por cliente, achada pelo telefone.
  if (isLoyalty && any(COLS.phone)) roles.push("fidelidade");
  // 0149 "Posição de Estoque": Produto + NCM + coluna de estoque. O 0043 (sem NCM) e os outros relatórios de estoque ficam só guardados.
  if (has("produto", "ncm") && colOf(header, ...STOCK_COLS) >= 0) roles.push("produtos");
  return roles;
}

/** Títulos dos formatos principais (assinatura → título). Os demais saem da heurística por colunas. */
const TITLES: Record<string, string> = {
  dc841e71: "Cadastro de clientes", "7737c39e": "Clientes (contatos)", "4cad067e": "Clientes e última visita", fb0490d0: "Clientes e última visita (com sexo)",
  "4c9ce320": "Clientes cadastradas", "0d541ef1": "Clientes por data mais recente", fb8e34ba: "Clientes por dia da semana", "9bec623d": "Aniversariantes",
  "5d0fefc2": "Clientes que mais consomem", ae14ff16: "Clientes por faturamento", cc013749: "Clientes por cidade", "862b213d": "Clientes cadastradas (detalhado)",
  "9897d129": "Clientes com visita", "0c96c703": "Itens vendidos por cliente", "9e34ba62": "Clientes (e-mail e telefone)", "1f54ffc6": "Clientes por como conheceu",
  b3e10fc4: "Clientes novas (primeira visita)", "56e6c35f": "Retorno sugerido", "67ab6863": "Retorno sugerido por categoria", "4cf4643c": "Clientes sumidas",
  c7c3ccd2: "Visitas por cliente", a42a323d: "Visitas por cliente (por data)", ce4f09b9: "Clientes: consumo e visitas", "4cc2d3b0": "Clientes excluídas",
  "25fe8670": "Clientes com endereço", cc2801c9: "Ficha de clientes", "29a5bda8": "Clientes (celular)", "61fa10d5": "Clientes (e-mail)", e5d22277: "Clientes (documento)",
  f18900ac: "Reservas", "1903eedc": "Reservas (quem cadastrou)", e51ff131: "Reservas com valor", e7da5691: "Reservas por origem", e8aa4978: "Cancelamentos",
  fbd442b2: "Agendados sem desfecho no Avec", "61a7a9b6": "Bloqueios de agenda", "568fb508": "Agenda por dia da semana", "971994cb": "Agenda com valor", "7afa0ac7": "Reserva x comanda (profissional)",
  "9c5dad0e": "Reservas por dia", f68efd92: "Reservas por profissional", "54b78936": "Tipos de agendamento", "074bb68c": "Tipos de agendamento (quantidade)",
  "831f0aa5": "Ocupação das profissionais", e53bed6f: "Reservado x vendido",
  e7894755: "Pacotes das clientes", e9f10c6e: "Pacotes das clientes (saldo)", "40ca3312": "Uso de pacotes", "10599ac5": "Uso de pacotes (resumo)",
  e98b5a6c: "Pacotes cadastrados", "6ae59aff": "Faturamento por pacote", "5a9cbde8": "Pacotes vendidos",
  "63d414a7": "Itens de comanda", e5b22c06: "Itens de comanda (sem contato)", f06dac67: "Itens por profissional", "8ffa26d4": "Itens de comanda (resumo)",
  "6f695f67": "Serviços por profissional", "56cf76ed": "Itens de comanda (cobrado x cadastrado)", "85fbddc5": "Serviços por cliente", f136bdb3: "Itens de comanda por cliente",
  b7376899: "Comissão por item", d1e9f12d: "Pagamentos de comanda", "55b9d10c": "Faturamento por forma de pagamento", eea8b3fc: "Taxas de cartão",
  cdc646d8: "Profissionais", "1b77f624": "Profissionais (contato)", "89318958": "Comissão total por profissional",
  "5d3b6c5d": "Faturamento por serviço", e637232f: "Serviços: quantidade e valor médio", f7b4435f: "Serviços cadastrados", b507142e: "Custo dos serviços", fbf8d8d4: "Serviços: comissão e tempo",
  "36ba276e": "Pagamento das profissionais", "9aafd898": "Repasse por cartão", "502cca9a": "Repasse por forma de pagamento", "47d57e7d": "Fechamento das profissionais",
  "0649aabe": "Pagamentos a profissionais", "0e30824e": "Faturamento por dia", dd6ad838: "Faturamento por dia (com dia da semana)", "4d0dadf5": "Faturamento por dia da semana",
  "83e1b1e5": "Valor líquido por dia", f2f49151: "Lançamentos financeiros", ca5e2f62: "Despesas", ac142f7c: "Contas a pagar", ac9b889a: "Lançamentos por competência",
  b631f29f: "Recebimentos", d339dbba: "Recebimentos por forma de pagamento", c8f00d91: "Créditos e dívidas", ff149101: "Comandas com crédito ou dívida",
  f566f4bf: "Avaliações das clientes", eda93287: "Avaliações por profissional", "33967693": "Avaliações por nota", "6c0ab0d1": "Fidelidade: clientes", "4e1de251": "Fidelidade: pontos",
  "8478cd7a": "Notas fiscais (NFC-e)", eeeeed1d: "Notas fiscais", "86029fa1": "Notas de serviço (NFS-e)", "30e656b2": "Etiquetas", "9c940dbc": "Como nos conheceu",
  "88bc57e7": "Faturamento por como conheceu", "478189cc": "Clientes por gênero", "48e7c27c": "Clientes por bairro",
  "9256ab78": "Clientes por tipo de consumo", "386e3bab": "Faturamento por cliente", "34146929": "Vales e créditos", "83666552": "Comandas: itens x pagamentos",
  "84726108": "Produtos vencidos ou descartados", "376d2bf7": "Totais por tipo", ac23e6c3: "Lançamentos por cliente", c0dea54f: "Valores por categoria",
  e838a894: "Vendas por categoria", "80a4c150": "Itens: venda x uso", b79cef09: "Situação das comandas", "5669d79a": "Tipos de venda", ef9246e2: "Movimentações de caixa",
  "0827fc05": "Faturamento por empresa", "4b6cbc4f": "Totais por status", "0b4f0953": "Campos extras das clientes", "522e78d2": "Campos extras das comandas",
  a18379d0: "Observações de comandas", "1d3cb979": "Serviços por data", "5647abd8": "Lançamentos das profissionais", "2b708240": "Pagamentos a profissionais (período)",
  "3c9055ab": "Formas de pagamento cadastradas", "5575de10": "Caixas (abertura e fechamento)", "65eb1535": "Comandas por tipo", "4762e3f9": "Comandas por profissional",
  "73d1b3b4": "Faturamento por categoria", "999d7e8a": "Itens com forma de pagamento", "90e4501f": "Itens de comanda (sem cliente)", "3d19e75c": "Comandas aprovadas",
  d3aa5ffc: "Cheques", "88631db7": "Comandas por cliente (valor)", fb28b669: "Comandas por cliente", "507021c8": "Comandas por cliente e profissional",
  b5e47425: "Comandas (quem criou)", "3646fb19": "Itens com status", "8d25b52d": "Cupons usados", "1877878b": "Vales-presente", "44d320a4": "Promoções usadas",
  "75ba7de9": "Promoções cadastradas", "78717dcb": "Comandas excluídas", f0431917: "Itens excluídos", "36cb1942": "Saídas de produto excluídas",
  e1e97c79: "Caixinha por cliente", "5cacd6e2": "Caixinha por profissional", cc4d6e76: "Comissão de assistentes", bffbf711: "Comissão por item (cadastrada)",
  "0e3feff0": "Lucratividade por serviço", "48c49b38": "Comissão por profissional", "8ea83a39": "Faturamento por profissional", "902551df": "Atendimentos por profissional",
  "22d37c87": "Faturamento por profissional e cargo", "3a373d8f": "Faturamento profissional x salão", "7c09079a": "Valores por profissional",
  "90f0bb43": "Clientes com preferência de profissional", e30391f0: "Tipos de atendimento por profissional", "7c99eae4": "Faturamento por cargo", "9e673d7d": "Custo por cargo",
  "4c20d186": "Rateio por categoria", "60a4e928": "Custo por categoria", "2ab62616": "Custo total por categoria", a9c0e7d0: "Lucratividade por categoria",
  "49a2d2bb": "Margem por categoria", "2b4a413e": "Faturamento por bandeira", "541268c4": "Nota x comanda", "638c6750": "Nota x comanda (valor)",
  "895bad02": "Notas das profissionais x salão", f736c64b: "Pedidos de compra", "0d25e619": "Faturamento por produto", "1c84aa08": "Lucratividade por produto",
  fb87dcc1: "Preços dos produtos", a11266b7: "Estoque de produtos", b2da8a31: "Reposição de estoque", "5ee5c958": "Margem dos produtos", c306bec9: "Custo médio dos produtos",
  "36c3ff89": "Vendas por marca", c87358ae: "Produtos vendidos por profissional", d9ed6210: "Descontos de produtos das profissionais", "83b6a63a": "Itens descontados",
  "2ca9923b": "Saídas de produto por profissional", "1638a715": "Saídas de produtos", f80459ea: "Dados fiscais dos produtos", "247b884a": "Produtos mais vendidos",
  "65800d14": "Produtos usados nos serviços", "9db4f036": "Inventário", ebf204a9: "Produtos descartados", "858bbd29": "Custo por marca",
  "2e24b54c": "Gasto com produtos por serviço", "29b2260c": "Produtos (códigos)", "296b7b0e": "Produtos cadastrados", "0d9e9347": "Saídas de estoque",
  a328342d: "Valor do estoque", "46c10a5d": "Produtos vendidos (comissão)", "7d4a75d6": "Saídas de estoque (custo)", cd09f8e7: "Lucro por produto",
  "1040dba8": "Vendas de produto por profissional", "2903b510": "Movimento de estoque", "8821aba2": "Lucratividade dos produtos", "5855fb02": "Recálculos solicitados",
  fec3819b: "Comandas: taxas e custos", "68b6a870": "Split de pagamento", "3f9f04aa": "Recibos de comissão", "64e8cd2a": "Comissões pagas por item",
};

const TITLE_RULES: [(h: Set<string>) => boolean, string][] = [
  [(h) => h.has("banco") || h.has("agencia"), "Pagamento das profissionais"],
  [(h) => [...h].some((c) => c.includes("nota") && !c.includes("(1-5)")) || h.has("link xml"), "Notas fiscais"],
  [(h) => [...h].some((c) => c.includes("avalia") || c === "nota (1-5)"), "Avaliações"],
  [(h) => [...h].some((c) => c.includes("pontos") || c.includes("pontuacao")), "Fidelidade"],
  [(h) => h.has("caixinha") || h.has("nome do profissional"), "Caixinha"],
  [(h) => [...h].some((c) => c.includes("estoque") || c === "marca" || c.includes("codigo de barra") || c.includes("cod. barras") || c === "ncm"), "Produtos e estoque"],
  [(h) => [...h].some((c) => c.startsWith("produto")), "Produtos"],
  [(h) => [...h].some((c) => c.startsWith("comissao") || c.startsWith("com. ")), "Comissões"],
  [(h) => [...h].some((c) => c.includes("pagamento") || c.includes("forma pag")), "Pagamentos"],
  [(h) => [...h].some((c) => c.includes("vale presente") || c.includes("promocao") || c === "desconto"), "Promoções e vales"],
  [(h) => [...h].some((c) => c.includes("exclus") || c.includes("deletad")), "Exclusões"],
  [(h) => [...h].some((c) => c.includes("comanda")), "Comandas"],
  [(h) => [...h].some((c) => c.includes("fatura") || c.includes("ticket") || c.includes("lucr") || c.includes("custo")), "Faturamento"],
  [(h) => h.has("profissional") || h.has("cargo"), "Profissionais (resumo)"],
  [(h) => [...h].some((c) => c.includes("cliente")), "Clientes (resumo)"],
];

const ROLE_TITLE: Record<AvecRole, string> = {
  profissionais: "Profissionais", servicos: "Serviços", contatos: "Clientes", agendamentos: "Reservas", cancelamentos: "Cancelamentos", sem_baixa: "Agendados sem desfecho no Avec",
  bloqueios: "Bloqueios de agenda", pacotes: "Pacotes das clientes", usos_pacote: "Uso de pacotes", itens: "Itens de comanda", pagamentos: "Pagamentos de comanda", fichas: "Fichas das clientes", fidelidade: "Pontos de fidelidade das clientes", produtos: "Posição de estoque",
};
const ROLE_ORDER: AvecRole[] = ["agendamentos", "cancelamentos", "sem_baixa", "bloqueios", "pacotes", "usos_pacote", "itens", "pagamentos", "fichas", "fidelidade", "produtos", "profissionais", "servicos", "contatos"];

/** Título amigável (PT-BR) do formato: o do mapa ou, se não estiver lá, deduzido das colunas. */
export function titleOf(header: string[], roles: AvecRole[] = rolesOf(header)): string {
  const known = TITLES[signatureOf(header)];
  if (known) return known;
  const main = ROLE_ORDER.find((r) => roles.includes(r) && r !== "contatos");
  if (main) return ROLE_TITLE[main];
  const h = new Set(header.map(normHeader));
  const rule = TITLE_RULES.find(([test]) => test(h));
  if (rule) return rule[1];
  if (roles.includes("contatos")) return "Clientes";
  return `Relatório: ${header.slice(0, 3).join(", ")}`;
}

/** Formato de um cabeçalho: assinatura, título e destinos. */
export function detectFormat(header: string[]): AvecFormat {
  const roles = rolesOf(header);
  return { signature: signatureOf(header), title: titleOf(header, roles), roles };
}

/** A coluna de data que define o período do relatório (para listar por período). */
export function periodColumn(header: string[]): number {
  return colOf(header, "data reserva", "data", "data comanda", "data da comanda", "data pagamento", "data inicial", "data venda", "compra", "data competencia", "data de pagamento");
}
