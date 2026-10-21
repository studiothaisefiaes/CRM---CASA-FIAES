import { describe, expect, it } from "vitest";
import { CONFIG_GROUPS, CONFIG_ITEMS, configGroups, groupHint, configTabs, defaultConfigGroup, itemHref, matchConfigItem, searchConfig, stateOf, type ConfigSnapshot } from "./config-tabs";

const ids = (perms: string[]) => configTabs(perms).map((t) => t.id);
const ALL = ["config.diaadia", "config.sistema", "equipe.gerir", "config.funcoes", "config.marcadores", "config.aviso_cliente", "config.fichas", "nota.configurar"];

describe("grupos e itens", () => {
  it("poucos grupos, numa ordem só, com a Área de cuidado por último", () => {
    expect(CONFIG_GROUPS.map((g) => g.id)).toEqual(["casa", "pessoas", "mensagens", "conversas", "agenda", "clientes", "dados", "cuidado"]);
    expect(CONFIG_GROUPS.find((g) => g.id === "mensagens")?.label).toBe("Mensagens automáticas");
    expect(CONFIG_GROUPS.at(-1)?.danger).toBe(true);
  });
  it("todo item tem grupo, nome, frase e palavras para a busca; ids e endereços não se repetem", () => {
    for (const i of CONFIG_ITEMS) {
      expect(CONFIG_GROUPS.some((g) => g.id === i.group), i.id).toBe(true);
      expect(i.description.length, i.id).toBeGreaterThan(20);
      expect(i.keywords.length, i.id).toBeGreaterThan(0);
    }
    expect(new Set(CONFIG_ITEMS.map((i) => i.id)).size).toBe(CONFIG_ITEMS.length);
    expect(new Set(CONFIG_ITEMS.map((i) => i.href)).size).toBe(CONFIG_ITEMS.length);
  });
  it("tudo que manda mensagem para cliente está em Mensagens automáticas, inclusive a resposta fora do horário", () => {
    const sends = CONFIG_ITEMS.filter((i) => i.sends).map((i) => i.id);
    expect(sends).toEqual(expect.arrayContaining(["fora-do-horario", "boas-vindas", "menu", "ausencia", "encerramento", "lembrete", "massa", "regras"]));
    for (const i of CONFIG_ITEMS.filter((x) => x.sends)) expect(i.group, i.id).toBe("mensagens");
  });
  it("só os perigosos ficam na Área de cuidado; Importar fica fora dela", () => {
    expect(CONFIG_ITEMS.filter((i) => i.group === "cuidado").map((i) => i.id)).toEqual(["whatsapp", "avec"]);
    for (const i of CONFIG_ITEMS) expect(!!i.danger, i.id).toBe(i.group === "cuidado");
    expect(CONFIG_ITEMS.find((i) => i.id === "importar")?.group).toBe("dados");
  });
  it("Pessoas é um item só (equipe, quem recebe conversa nova e perfis)", () => {
    const pessoas = CONFIG_ITEMS.filter((i) => i.group === "pessoas" && i.id === "pessoas");
    expect(pessoas).toHaveLength(1);
    expect(pessoas[0].also).toEqual(expect.arrayContaining(["/config/distribuicao", "/config/equipe/perfis"]));
  });
});

describe("quem vê o quê", () => {
  it("dia a dia vê Pessoas, etiquetas, respostas, listas, origens e profissionais; nada do sistema", () => {
    expect(ids(["config.diaadia"]).sort()).toEqual(["biblioteca", "etiquetas", "motivos", "objecoes", "origens", "palavras", "pessoas", "profissionais", "respostas"].sort());
  });
  it("o Aviso da cliente só aparece com config.aviso_cliente (dia a dia e sistema não bastam)", () => {
    expect(ids(["config.diaadia", "config.sistema"])).not.toContain("aviso-cliente");
    expect(ids(["config.aviso_cliente"])).toEqual(["aviso-cliente"]);
  });
  it("sistema vê as mensagens automáticas e a Área de cuidado; não vê etiquetas", () => {
    const s = ids(["config.sistema"]);
    expect(s).toEqual(expect.arrayContaining(["fora-do-horario", "lembrete", "massa", "whatsapp", "avec", "importar", "horario", "pessoas"]));
    expect(s).not.toContain("etiquetas");
  });
  it("Nota fiscal pede nota.configurar: config.sistema sozinha não abre", () => {
    expect(ids(["config.sistema"])).not.toContain("nota-fiscal");
    expect(ids(["nota.configurar"])).toEqual(["nota-fiscal"]);
    expect(configGroups(["nota.configurar"]).map((g) => g.id)).toEqual(["agenda"]);
    expect(defaultConfigGroup(["nota.configurar"])).toBe("agenda");
    expect(ids(ALL)).toContain("nota-fiscal");
  });
  it("Depois do atendimento (Fase B): em Mensagens automáticas, manda mensagem, só com config.sistema", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "depois-atendimento");
    expect(i).toMatchObject({ group: "mensagens", href: "/config/depois-atendimento", need: "sistema", sends: true, label: "Depois do atendimento" });
    expect(ids(["config.sistema"])).toContain("depois-atendimento");
    expect(ids(["config.diaadia"])).not.toContain("depois-atendimento");
    expect(matchConfigItem("/config/depois-atendimento", "")?.id).toBe("depois-atendimento");
  });
  it("Virada (Fase B, Task 10): em Mensagens automáticas, manda mensagem, achada por ChatGuru, Avec e desligar", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "virada");
    expect(i).toMatchObject({ group: "mensagens", href: "/config/virada", sends: true, label: "Troca do ChatGuru para o CRM" });
    expect(i?.keywords).toEqual(expect.arrayContaining(["chatguru", "avec", "desligar"]));
    expect(matchConfigItem("/config/virada", "")?.id).toBe("virada");
  });
  it("a gestão vê todos os itens; sem permissão, nenhum", () => {
    expect(ids(ALL)).toHaveLength(CONFIG_ITEMS.length);
    expect(ids([])).toEqual([]);
  });
  it("grupos vazios somem; o grupo de entrada é Mensagens automáticas quando a pessoa pode ver", () => {
    expect(configGroups(["config.diaadia"]).map((g) => g.id)).toEqual(["pessoas", "conversas", "agenda"]);
    expect(defaultConfigGroup(ALL)).toBe("mensagens");
    expect(defaultConfigGroup(["config.diaadia"])).toBe("pessoas");
    expect(defaultConfigGroup([])).toBeNull();
  });
  it("Pessoas abre a equipe para quem gere; para quem não gere, abre quem recebe conversa nova", () => {
    const pessoas = CONFIG_ITEMS.find((i) => i.id === "pessoas")!;
    expect(itemHref(pessoas, ["equipe.gerir"])).toBe("/config/equipe");
    expect(itemHref(pessoas, ["config.diaadia"])).toBe("/config/distribuicao");
  });
});

describe("Funções (Regra do dono)", () => {
  it("o item pede a permissão config.funcoes: só quem a tem vê e abre", () => {
    expect(ids(ALL)).toContain("funcoes");
    expect(ids(["config.diaadia", "config.sistema", "equipe.gerir"])).not.toContain("funcoes");
    expect(ids(["config.funcoes"])).toEqual(["funcoes"]);
    expect(matchConfigItem("/config/funcoes", "")?.id).toBe("funcoes");
  });
  it("o estado diz quantas funções estão ligadas", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "funcoes")!;
    expect(stateOf(i, { funcoes: { on: 12, total: 12 } })).toEqual({ text: "12 de 12 ligados", on: true });
    expect(stateOf(i, { funcoes: { on: 1, total: 12 } })?.text).toBe("1 de 12 ligados");
    expect(stateOf(i, {})).toBeNull();
  });
});

describe("Marcadores do horário (Fase C, item 19)", () => {
  it("o item pede a permissão config.marcadores: só quem a tem vê e abre", () => {
    expect(ids(ALL)).toContain("marcadores");
    expect(ids(["config.diaadia", "config.sistema", "equipe.gerir", "config.funcoes"])).not.toContain("marcadores");
    expect(ids(["config.marcadores"])).toEqual(["marcadores"]);
    expect(matchConfigItem("/config/marcadores", "")?.id).toBe("marcadores");
  });
  it("o estado diz quantos marcadores estão em uso", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "marcadores")!;
    expect(stateOf(i, { marcadores: 9 })?.text).toBe("9 marcadores em uso");
    expect(stateOf(i, { marcadores: 1 })?.text).toBe("1 marcador em uso");
    expect(stateOf(i, {})).toBeNull();
  });
});

describe("Fichas da cliente (Fase C, itens 21 e 25b)", () => {
  it("o item fica no grupo Clientes e pede a permissão config.fichas: só quem a tem vê e abre", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "fichas")!;
    expect([i.group, i.label, i.href]).toEqual(["clientes", "Fichas da cliente", "/config/fichas"]);
    expect(CONFIG_GROUPS.find((g) => g.id === "clientes")).toMatchObject({ label: "Clientes", description: "O que a Casa pergunta e anota de cada cliente." });
    expect(ids(ALL)).toContain("fichas");
    expect(ids(["config.diaadia", "config.sistema", "equipe.gerir", "config.funcoes"])).not.toContain("fichas");
    expect(ids(["config.fichas"])).toEqual(["fichas"]);
    expect(configGroups(["config.fichas"]).map((g) => g.id)).toEqual(["clientes"]);
    expect(matchConfigItem("/config/fichas", "?ficha=consultoria")?.id).toBe("fichas");
  });
  it("o estado diz quantas perguntas estão em uso; a busca acha por anamnese", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "fichas")!;
    expect(stateOf(i, { fichas: 32 })?.text).toBe("32 perguntas em uso");
    expect(stateOf(i, { fichas: 1 })?.text).toBe("1 pergunta em uso");
    expect(stateOf(i, {})).toBeNull();
    expect(searchConfig(configTabs(ALL), "anamnese").map((x) => x.id)).toContain("fichas");
  });
});

describe("busca", () => {
  const found = (q: string, perms = ALL) => searchConfig(configTabs(perms), q).map((i) => i.id);
  it("procura pelo nome, pela frase e por sinônimos, sem ligar para acento e maiúscula", () => {
    expect(found("lembrete")[0]).toBe("lembrete");
    expect(found("robô")).toContain("boas-vindas");
    expect(found("ROBO")).toContain("boas-vindas");
    expect(found("agendar mensagem")).toContain("respostas");
    expect(found("qr code")).toContain("whatsapp");
    expect(found("chatguru").sort()).toEqual(["importar", "virada"]); // Virada (Task 10): desligar o lembrete do ChatGuru
    expect(found("expediente")).toContain("horario");
    expect(found("fora do horario")[0]).toBe("fora-do-horario");
  });
  it("busca vazia não filtra; nada encontrado volta vazio; só acha o que a pessoa pode abrir", () => {
    expect(found("  ")).toHaveLength(CONFIG_ITEMS.length);
    expect(found("xyzw")).toEqual([]);
    expect(found("whatsapp", ["config.diaadia"])).toEqual([]);
  });
});

describe("onde estou", () => {
  it("acha o item pelo caminho e pela parte da página", () => {
    expect(matchConfigItem("/config/mensagens", "?parte=fora-do-horario")?.id).toBe("fora-do-horario");
    expect(matchConfigItem("/config/automacoes", "?parte=lembrete")?.id).toBe("lembrete");
    expect(matchConfigItem("/config/listas", "?aba=keyword")?.id).toBe("palavras");
    expect(matchConfigItem("/config/equipe/perfis", "")?.id).toBe("pessoas");
    expect(matchConfigItem("/config/distribuicao", "")?.id).toBe("pessoas");
    expect(matchConfigItem("/config/whatsapp", "")?.id).toBe("whatsapp");
    expect(matchConfigItem("/config/profissionais", "?id=abc")?.id).toBe("profissionais");
  });
  it("página inteira sem parte (endereço antigo) e o índice não acham item", () => {
    expect(matchConfigItem("/config/mensagens", "")).toBeNull();
    expect(matchConfigItem("/config", "")).toBeNull();
  });
});

describe("Repetir horário (Fase C, item 23a)", () => {
  it("fica em Agenda e caixa, pede config.sistema e mora em /config/agenda?parte=repetir; sem parte continua o Intervalo", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "repetir")!;
    expect(i).toMatchObject({ group: "agenda", need: "sistema", label: "Repetir horário" });
    expect(ids(["config.sistema"])).toContain("repetir");
    expect(ids(["config.diaadia", "config.marcadores", "config.funcoes"])).not.toContain("repetir");
    expect(matchConfigItem("/config/agenda", "?parte=repetir")?.id).toBe("repetir");
    expect(matchConfigItem("/config/agenda", "")?.id).toBe("intervalo");
    expect(searchConfig(CONFIG_ITEMS, "repetir")[0]?.id).toBe("repetir");
  });
  it("o estado mostra os limites, ou que a função está desligada", () => {
    const i = CONFIG_ITEMS.find((x) => x.id === "repetir")!;
    expect(stateOf(i, { repetir: { maxSemanas: 12, maxVezes: 26, on: true } })).toEqual({ text: "Até 12 semanas · 26 vezes", on: true });
    expect(stateOf(i, { repetir: { maxSemanas: 12, maxVezes: 26, on: false } })).toEqual({ text: "Função desligada", on: false });
    expect(stateOf(i, {})).toBeNull();
  });
});

describe("estado de cada item", () => {
  const snap: ConfigSnapshot = {
    autoReply: true, welcome: false, menu: false, away: false, closing: false, reminder: false, mass: false, suggestedReturn: true,
    automations: { on: 2, total: 9, sendingOn: 1 }, hours: { summary: "ter–sáb 9–18", saved: true },
    whatsapp: { connected: 1, total: 1 }, agendaMode: "consulta", caixaMode: "avec", passoMin: 30, exigeCaixaAberto: false, financeiro: { contasAPagar: true, resultado: false }, estoque: { ligado: true }, relatorios: { ocupacao: true }, nota: { nfse: "teste" },
    lists: { quick_reply: 38, objection: 4, lost_reason: 6, service: 11, keyword: 3, origin: 6 },
    tags: 9, stages: 8, sources: 3, professionals: 6, people: { active: 4, pending: 1 }, distribution: false, onlineBooking: false,
    clientPage: { endereco: true, cancelarAteHoras: 24 },
  };
  const st = (id: string, s: ConfigSnapshot = snap) => stateOf(CONFIG_ITEMS.find((i) => i.id === id)!, s);
  it("mensagens mostram ligada/desligada de um jeito que se vê de longe", () => {
    expect(st("fora-do-horario")).toEqual({ text: "Ligada", on: true });
    expect(st("boas-vindas")).toEqual({ text: "Desligada", on: false });
    expect(st("menu")).toEqual({ text: "Desligado", on: false });
    expect(st("lembrete")).toEqual({ text: "Desligado", on: false });
    expect(st("depois-atendimento")).toBeNull(); // sem leitura, sem estado inventado
    expect(st("depois-atendimento", { ...snap, afterVisit: false })).toEqual({ text: "Desligado", on: false });
    expect(st("depois-atendimento", { ...snap, afterVisit: true })).toEqual({ text: "Ligado", on: true });
    expect(st("regras")).toEqual({ text: "2 de 9 ligadas · 1 manda mensagem", on: true });
    expect(st("retorno")).toEqual({ text: "Ligada · não manda mensagem", on: true });
  });
  it("os outros mostram o resumo do que está valendo", () => {
    expect(st("horario")?.text).toBe("ter–sáb 9–18");
    expect(st("horario", { hours: { summary: "seg–sex 8–20", saved: false } })?.text).toBe("seg–sex 8–20 · padrão, ninguém salvou");
    expect(st("respostas")?.text).toBe("38 respostas");
    expect(st("pessoas")?.text).toBe("4 pessoas · 1 convite pendente · distribuição desligada");
    expect(st("intervalo")?.text).toBe("A cada 30 min");
    expect(st("financeiro")).toEqual({ text: "Contas a pagar: Ligadas · Resultado: Desligado", on: true });
    expect(st("financeiro", {})).toBeNull();
    expect(st("estoque")).toEqual({ text: "Ligado", on: true });
    expect(st("estoque", { estoque: { ligado: false } })).toEqual({ text: "Desligado", on: false });
    expect(st("estoque", {})).toBeNull();
    expect(st("relatorios")).toEqual({ text: "Ocupação: Ligada", on: true });
    expect(st("relatorios", { relatorios: { ocupacao: false } })).toEqual({ text: "Ocupação: Desligada", on: false });
    expect(st("relatorios", {})).toBeNull();
    expect(st("nota-fiscal")).toEqual({ text: "Teste", on: true });
    expect(st("nota-fiscal", { nota: { nfse: "desligada" } })).toEqual({ text: "Desligada", on: false });
    expect(st("nota-fiscal", {})).toBeNull();
    expect(st("avec")?.text).toBe("Agenda só consulta · caixa no Avec");
    expect(st("whatsapp")).toEqual({ text: "Conectado", on: true });
    expect(st("whatsapp", { whatsapp: { connected: 0, total: 1 } })).toEqual({ text: "Desconectado", on: false, alert: true });
    expect(st("importar")?.text).toBe("Não envia nada");
  });
  it("sem o dado (falhou ao ler), não inventa estado", () => {
    expect(st("fora-do-horario", {})).toBeNull();
    expect(st("respostas", {})).toBeNull();
  });
  it("a coluna da esquerda mostra quantas mensagens estão ligadas e se o WhatsApp caiu", () => {
    const g = (id: string) => CONFIG_GROUPS.find((x) => x.id === id)!;
    expect(groupHint(g("mensagens"), CONFIG_ITEMS, snap)).toEqual({ text: "2 de 8 ligadas", on: true });
    expect(groupHint(g("mensagens"), CONFIG_ITEMS, {})).toEqual({ text: g("mensagens").hint });
    expect(groupHint(g("cuidado"), CONFIG_ITEMS, { whatsapp: { connected: 0, total: 1 } })).toEqual({ text: "WhatsApp desconectado", on: false, alert: true });
    expect(groupHint(g("dados"), CONFIG_ITEMS, snap)).toEqual({ text: "Não envia nada" });
  });
});
