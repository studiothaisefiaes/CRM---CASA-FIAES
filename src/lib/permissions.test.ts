import { describe, expect, it } from "vitest";
import { GESTAO_OPTIONAL, GESTAO_REQUIRED, ONE_TIME_GRANTS, PERMS, PERM_GROUP, PERM_GROUPS, PERM_HELP, PERM_OTHERS, PERM_LABEL, SYSTEM_PROFILES, can, canSeeSalon, isPerm, legacyRoleOf, firstAllowedPath, canConfigure, isProOnly } from "./permissions";

const FASE_C_NOVAS = [
  "agenda.marcador", "agenda.repetir", "agenda.passar_dia", "fidelidade.resgatar", "fidelidade.programas", "servicos.custo", "servicos.por_profissional",
  "contatos.uso_imagem", "fichas.ver", "fichas.responder", "fotos.adicionar", "fotos.apagar", "contatos.unir", "config.marcadores", "config.fichas", "config.aviso_cliente", "config.funcoes",
] as const;
const FASE_C_EQUIPE = ["agenda.marcador", "agenda.repetir", "agenda.passar_dia", "fidelidade.resgatar", "contatos.uso_imagem", "fichas.ver", "fichas.responder", "fotos.adicionar", "fotos.apagar", "config.marcadores", "config.fichas", "config.aviso_cliente"] as const;
const FASE_C_RECEPCAO = ["servicos.por_profissional", "contatos.unir"] as const;
const QA66_EQUIPE = ["contatos.editar", "contatos.importar", "mensagem.apagar_todos"] as const;
const profile = (key: string) => SYSTEM_PROFILES.find((p) => p.key === key)!;

describe("can", () => {
  it("libera só a permissão que está na lista", () => {
    expect(can(["atendimento.ver"], "atendimento.ver")).toBe(true);
    expect(can(["atendimento.ver"], "relatorios.ver")).toBe(false);
  });
  it("lista vazia, nula ou com chave desconhecida não libera nada", () => {
    expect(can([], "relatorios.ver")).toBe(false);
    expect(can(undefined, "relatorios.ver")).toBe(false);
    expect(can(null, "relatorios.ver")).toBe(false);
    expect(can(["relatorios"], "relatorios.ver")).toBe(false);
  });
});

describe("perfis de sistema", () => {
  it("Gestão tem todas as permissões, menos entrar no rodízio de leads (opcional, como era o papel gestor), mensagem em massa (Lote 5) e o app da profissional (Lote 7A)", () => {
    expect([...profile("gestao").permissions].sort()).toEqual(PERMS.filter((p) => !["distribuicao.receber", "mensagem.massa", "pro.app", "pro.ganhos"].includes(p)).sort());
    expect(GESTAO_OPTIONAL).toEqual(["distribuicao.receber", "mensagem.massa", "pro.app", "pro.ganhos"]);
  });
  it("perfil Profissional (Lote 7A): só o app e os próprios ganhos, os ganhos no grupo 'Comissão'", () => {
    expect([...profile("profissional").permissions].sort()).toEqual(["pro.app", "pro.ganhos"]);
    expect(profile("profissional").name).toBe("Profissional");
    expect(PERM_GROUP["pro.app"]).toBe("Agenda");
    expect(PERM_GROUP["pro.ganhos"]).toBe("Comissão");
    // Um nome para cada coisa (Plano 5): a permissão de abrir as conversas se chama Conversas na tela; a chave continua atendimento.ver.
    expect(PERM_LABEL["atendimento.ver"]).toBe("Ver Conversas");
    expect(PERM_GROUP["atendimento.ver"]).toBe("Conversas");
    expect(PERM_GROUPS[0]).toBe("Conversas");
    expect(PERM_LABEL["pro.app"]).toBe("Entrar no app da profissional (só a própria agenda)");
    expect(PERM_LABEL["pro.ganhos"]).toBe("Ver os próprios ganhos no app");
    expect(ONE_TIME_GRANTS.some((g) => g.perm.startsWith("pro."))).toBe(false);
  });
  it("Atendente e Recepção fazem o mesmo atendimento (fechar venda, transferir, Quadro, Clientes, dia a dia, marcar e encaixar na Agenda); Relatórios só a gestão (pedido da Casa)", () => {
    const equipe = ["agenda.encaixar", "agenda.marcar", "atendimento.fechar", "atendimento.pausar", "atendimento.setor", "atendimento.transferir", "atendimento.ver", "biblioteca.enviar", "caixa.assistente", "caixa.cancelar", "caixa.dinheiro", "caixa.divida", "caixa.operar", "caixa.vale", "cliente.consentimento", "config.diaadia", "contatos.ver", "conversa.acompanhar", "conversa.nao_lida", "distribuicao.receber", "mensagem.contato", "mensagem.editar", "mensagem.encaminhar", "mensagem.localizacao", "mensagem.reagir", "nota.emitir", "nota.ver", "quadro.ver", ...FASE_C_EQUIPE, ...QA66_EQUIPE].sort();
    expect([...profile("atendente").permissions].sort()).toEqual(equipe);
    // Aba Serviços (16/10): só a recepção muda serviços e preços; a atendente consulta.
    expect([...profile("recepcao").permissions].sort()).toEqual([...equipe, "servicos.editar", "biblioteca.gerir", "estoque.produtos", "estoque.movimentar", ...FASE_C_RECEPCAO].sort());
  });
  it("Agenda (Lote 6A): marcar e encaixar no grupo 'Agenda', obrigatórias na Gestão", () => {
    expect(PERM_GROUPS).toContain("Agenda");
    expect(PERM_GROUP["agenda.marcar"]).toBe("Agenda");
    expect(PERM_LABEL["agenda.marcar"]).toBe("Marcar, remarcar, cancelar e bloquear na Agenda");
    expect(PERM_LABEL["agenda.encaixar"]).toBe("Encaixar por cima de outro horário ou fora do horário de trabalho");
    expect(profile("gestao").permissions).toEqual(expect.arrayContaining(["agenda.marcar", "agenda.encaixar"]));
    expect(GESTAO_OPTIONAL).not.toContain("agenda.marcar");
  });
  it("concessão única: as duas da agenda para Atendente e Recepção que já existem", () => {
    expect(ONE_TIME_GRANTS).toEqual([
      { profile: "atendente", perm: "agenda.marcar" }, { profile: "atendente", perm: "agenda.encaixar" },
      { profile: "recepcao", perm: "agenda.marcar" }, { profile: "recepcao", perm: "agenda.encaixar" },
      { profile: "atendente", perm: "caixa.operar" }, { profile: "recepcao", perm: "caixa.operar" },
      { profile: "recepcao", perm: "servicos.editar" },
      ...FASE_C_EQUIPE.flatMap((perm) => [{ profile: "atendente" as const, perm }, { profile: "recepcao" as const, perm }]),
      ...FASE_C_RECEPCAO.map((perm) => ({ profile: "recepcao" as const, perm })),
      { profile: "atendente", perm: "atendimento.setor" }, { profile: "recepcao", perm: "atendimento.setor" },
      { profile: "atendente", perm: "atendimento.pausar" }, { profile: "recepcao", perm: "atendimento.pausar" },
      { profile: "atendente", perm: "cliente.consentimento" }, { profile: "recepcao", perm: "cliente.consentimento" },
      { profile: "atendente", perm: "biblioteca.enviar" }, { profile: "recepcao", perm: "biblioteca.enviar" }, { profile: "recepcao", perm: "biblioteca.gerir" },
      ...["mensagem.reagir", "mensagem.editar", "mensagem.localizacao", "mensagem.contato", "mensagem.encaminhar", "conversa.nao_lida", "conversa.acompanhar"].flatMap((perm) => [{ profile: "atendente", perm }, { profile: "recepcao", perm }]),
      { profile: "recepcao", perm: "estoque.produtos" }, { profile: "recepcao", perm: "estoque.movimentar" },
      { profile: "atendente", perm: "nota.emitir" }, { profile: "atendente", perm: "nota.ver" },
      { profile: "recepcao", perm: "nota.emitir" }, { profile: "recepcao", perm: "nota.ver" },
      { profile: "atendente", perm: "caixa.cancelar" }, { profile: "recepcao", perm: "caixa.cancelar" },
    ]);
  });
  it("Nota fiscal (Fase D): emitir e ver para a equipe; cancelar só a Gestão; no grupo 'Caixa'", () => {
    expect(PERM_LABEL["nota.emitir"]).toBe("Emitir nota fiscal");
    expect(PERM_LABEL["nota.ver"]).toBe("Ver e baixar notas fiscais (XML e PDF)");
    expect(PERM_LABEL["nota.cancelar"]).toBe("Cancelar nota fiscal");
    for (const p of ["nota.emitir", "nota.ver", "nota.cancelar"] as const) { expect(PERM_GROUP[p]).toBe("Caixa"); expect(PERM_HELP[p]).toMatch(/\.$/); }
    expect(profile("gestao").permissions).toEqual(expect.arrayContaining(["nota.emitir", "nota.ver", "nota.cancelar"]));
    for (const k of ["atendente", "recepcao"] as const) { expect(profile(k).permissions).toEqual(expect.arrayContaining(["nota.emitir", "nota.ver"])); expect(profile(k).permissions).not.toContain("nota.cancelar"); }
  });
  it("Resolver nota fora do CRM (revisão final, I-2): só a Gestão, no grupo 'Gestão'", () => {
    expect(PERM_LABEL["nota.resolver"]).toBe("Resolver nota fora do CRM");
    expect(PERM_GROUP["nota.resolver"]).toBe("Gestão");
    expect(PERM_HELP["nota.resolver"]).toMatch(/\.$/);
    expect(profile("gestao").permissions).toContain("nota.resolver");
    for (const k of ["atendente", "recepcao", "profissional"] as const) expect(profile(k).permissions).not.toContain("nota.resolver");
    expect(ONE_TIME_GRANTS.some((g) => g.perm === "nota.resolver")).toBe(false);
  });
  it("Biblioteca (Fase B): enviar vai para Atendente e Recepção; subir e apagar para Gestão e Recepção", () => {
    expect(PERM_LABEL["biblioteca.gerir"]).toBe("Subir e apagar arquivos da Biblioteca");
    expect(PERM_LABEL["biblioteca.enviar"]).toBe("Enviar arquivo da Biblioteca na conversa");
    expect(PERM_GROUP["biblioteca.gerir"]).toBe("Conversas");
    expect(profile("gestao").permissions).toEqual(expect.arrayContaining(["biblioteca.gerir", "biblioteca.enviar"]));
    expect(profile("atendente").permissions).toContain("biblioteca.enviar");
    expect(profile("atendente").permissions).not.toContain("biblioteca.gerir");
    expect(profile("recepcao").permissions).toEqual(expect.arrayContaining(["biblioteca.enviar", "biblioteca.gerir"]));
  });
  it("Setores (Fase B): passar para setor vai para Atendente e Recepção; criar e editar setores só para a Gestão", () => {
    expect(PERM_LABEL["atendimento.setor"]).toBe("Passar conversa para um setor");
    expect(PERM_LABEL["setores.gerir"]).toBe("Criar e editar setores");
    expect(PERM_GROUP["atendimento.setor"]).toBe("Conversas");
    expect(PERM_GROUP["setores.gerir"]).toBe("Gestão");
    expect(profile("gestao").permissions).toEqual(expect.arrayContaining(["atendimento.setor", "setores.gerir"]));
    for (const k of ["atendente", "recepcao"] as const) {
      expect(profile(k).permissions).toContain("atendimento.setor");
      expect(profile(k).permissions).not.toContain("setores.gerir");
    }
  });
  it("Consentimento e pausa (Fase B): Gestão, Atendente e Recepção recebem; Profissional não", () => {
    expect(PERM_LABEL["cliente.consentimento"]).toBe("Mudar o que a cliente aceita");
    expect(PERM_LABEL["atendimento.pausar"]).toBe("Pausar as automáticas de uma cliente");
    for (const k of ["gestao", "atendente", "recepcao"] as const) expect(profile(k).permissions).toEqual(expect.arrayContaining(["cliente.consentimento", "atendimento.pausar"]));
    expect(profile("profissional").permissions).not.toContain("atendimento.pausar");
  });
  it("Caixa (Lote 6C): operar, gerir e ver a comissão de todas, nos grupos Caixa e Comissão; só operar vai para a equipe", () => {
    expect(PERM_LABEL["caixa.operar"]).toBe("Abrir comanda, receber e operar o caixa");
    expect(PERM_LABEL["caixa.gerir"]).toBe("Gerir o caixa: aprovar diferença, reabrir caixa e cancelar comanda");
    expect(PERM_LABEL["comissao.ver"]).toBe("Ver a comissão de todas");
    for (const p of ["caixa.operar", "caixa.gerir"] as const) expect(PERM_GROUP[p]).toBe("Caixa");
    expect(PERM_GROUP["comissao.ver"]).toBe("Comissão");
    expect(profile("gestao").permissions).toEqual(expect.arrayContaining(["caixa.operar", "caixa.gerir", "comissao.ver"]));
    expect(profile("recepcao").permissions).not.toContain("caixa.gerir");
    expect(profile("recepcao").permissions).not.toContain("comissao.ver");
  });
  it("Fase A: as 10 permissões novas existem, são obrigatórias na Gestão e a equipe só tem as de operar", () => {
    const novas = ["caixa.dinheiro", "caixa.outros", "caixa.taxas", "caixa.assistente", "caixa.divida", "caixa.vale", "comissao.regras", "comissao.lancar", "comissao.pagar", "relatorios.excecoes"] as const;
    for (const p of novas) {
      expect(PERMS).toContain(p);
      expect(GESTAO_REQUIRED).toContain(p);
      expect(profile("gestao").permissions).toContain(p);
      expect(PERM_LABEL[p]).toBeTruthy();
      expect(PERM_HELP[p]).toBeTruthy();
      expect(PERM_GROUP[p]).toBe(p === "relatorios.excecoes" ? "Relatórios" : p.startsWith("comissao.") ? "Comissão" : "Caixa");
    }
    expect(PERM_LABEL["comissao.pagar"]).toBe("Pagar a comissão e desfazer o pagamento");
    for (const k of ["atendente", "recepcao"] as const) {
      for (const p of ["caixa.dinheiro", "caixa.assistente", "caixa.divida", "caixa.vale"] as const) expect(profile(k).permissions).toContain(p);
      for (const p of ["comissao.pagar", "comissao.lancar", "comissao.regras", "caixa.outros", "caixa.taxas", "relatorios.excecoes"] as const) expect(profile(k).permissions).not.toContain(p);
    }
    expect(profile("profissional").permissions).toEqual(["pro.app", "pro.ganhos"]);
  });
  it("Tarefa 12: grupos Agenda, Caixa e Comissão, nenhum 'Agenda e caixa' e 'ver de outras' no grupo certo", () => {
    expect(PERM_GROUPS).toEqual(["Conversas", "Agenda", "Caixa", "Comissão", "Visões", "Clientes", "Relatórios", "Gestão"]);
    for (const p of PERMS) expect(PERM_GROUPS).toContain(PERM_GROUP[p]);
    expect(PERMS.filter((p) => (PERM_GROUP[p] as string) === "Agenda e caixa")).toEqual([]);
    expect(PERMS.filter((p) => p.startsWith("agenda.") || p === "pro.app").every((p) => PERM_GROUP[p] === "Agenda")).toBe(true);
    expect(PERMS.filter((p) => p.startsWith("caixa.") || p === "servicos.editar").every((p) => PERM_GROUP[p] === "Caixa")).toBe(true);
    expect(PERMS.filter((p) => p.startsWith("comissao.") || p === "pro.ganhos").every((p) => PERM_GROUP[p] === "Comissão")).toBe(true);
    expect(PERM_OTHERS).toEqual({ Conversas: "atendimento.todas", Caixa: "caixa.outros", "Comissão": "comissao.ver", "Relatórios": "relatorios.equipe" });
    for (const [g, p] of Object.entries(PERM_OTHERS)) expect(PERM_GROUP[p]).toBe(g);
    expect(PERM_HELP["caixa.gerir"]).not.toMatch(/caixas da equipe/i);
    expect(PERM_HELP["caixa.gerir"]).not.toMatch(/taxa/i);
  });
  it("nenhum perfil de sistema usa permissão inexistente", () => {
    for (const p of SYSTEM_PROFILES) for (const perm of p.permissions) expect(isPerm(perm)).toBe(true);
  });
  it("toda permissão tem rótulo, grupo e explicação", () => {
    for (const p of PERMS) {
      expect(PERM_LABEL[p]).toBeTruthy();
      expect(PERM_GROUP[p]).toBeTruthy();
      expect(PERM_HELP[p]).toBeTruthy();
    }
  });
});

describe("Regra do dono (Fase C): permissões novas", () => {
  it("as 17 existem, com rótulo, ajuda e grupo exatos", () => {
    const grupos: Record<string, string> = {
      "agenda.marcador": "Agenda", "agenda.repetir": "Agenda", "agenda.passar_dia": "Agenda", "fidelidade.resgatar": "Agenda",
      "fidelidade.programas": "Agenda", "servicos.custo": "Caixa", "servicos.por_profissional": "Caixa",
      "contatos.uso_imagem": "Clientes", "fichas.ver": "Clientes", "fichas.responder": "Clientes", "fotos.adicionar": "Clientes", "fotos.apagar": "Clientes", "contatos.unir": "Clientes",
      "config.marcadores": "Gestão", "config.fichas": "Gestão", "config.aviso_cliente": "Gestão", "config.funcoes": "Gestão",
    };
    expect(FASE_C_NOVAS).toHaveLength(17);
    for (const p of FASE_C_NOVAS) { expect(isPerm(p), p).toBe(true); expect(PERM_GROUP[p], p).toBe(grupos[p]); expect(PERM_HELP[p].length, p).toBeGreaterThan(20); }
    expect(PERM_LABEL["agenda.marcador"]).toBe("Pôr marcador e tipo no horário");
    expect(PERM_LABEL["agenda.passar_dia"]).toBe("Passar o dia de uma profissional para outra");
    expect(PERM_LABEL["config.aviso_cliente"]).toBe("Configurar o aviso da cliente");
    expect(PERM_LABEL["servicos.custo"]).toBe("Ver e mudar o custo do serviço");
    expect(PERM_LABEL["contatos.unir"]).toBe("Unir cadastros duplicados");
    expect(PERM_LABEL["config.funcoes"]).toBe("Ligar e desligar funções");
    expect(PERM_HELP["config.funcoes"]).toBe("Liga e desliga cada função nova do sistema em Configurações › Recursos.");
  });
  it("a Gestão tem todas (obrigatórias); Profissional, nenhuma; custo e funções só a Gestão", () => {
    for (const p of FASE_C_NOVAS) { expect(GESTAO_REQUIRED, p).toContain(p); expect(GESTAO_OPTIONAL, p).not.toContain(p); expect(profile("gestao").permissions, p).toContain(p); expect(profile("profissional").permissions, p).not.toContain(p); }
    for (const k of ["atendente", "recepcao"]) for (const p of ["servicos.custo", "config.funcoes"]) expect(profile(k).permissions).not.toContain(p);
    expect(profile("atendente").permissions).not.toContain("fidelidade.programas");
  });
});

describe("legacyRoleOf", () => {
  it("quem gere a equipe vira gestor na coluna antiga; o resto, atendente", () => {
    expect(legacyRoleOf(profile("gestao").permissions)).toBe("gestor");
    expect(legacyRoleOf(profile("atendente").permissions)).toBe("atendente");
    expect(legacyRoleOf([])).toBe("atendente");
  });
});

describe("firstAllowedPath", () => {
  it("vai para o Hoje, que todo mundo abre; quem só tem os relatórios (Contador, 26/10) vai para Relatórios", () => {
    expect(firstAllowedPath([])).toBe("/");
    expect(firstAllowedPath(["relatorios.ver", "atendimento.ver"])).toBe("/");
    expect(firstAllowedPath(["relatorios.ver", "caixa.operar"])).toBe("/");
    expect(firstAllowedPath(["relatorios.ver"])).toBe("/relatorios");
  });
});

describe("canSeeSalon", () => {
  it("Salão: números do salão inteiro, então pede Relatórios e 'toda a equipe'", () => {
    expect(canSeeSalon(["relatorios.ver"])).toBe(false);
    expect(canSeeSalon(["relatorios.ver", "relatorios.equipe"])).toBe(true);
    expect(canSeeSalon(profile("gestao").permissions)).toBe(true);
    expect(canSeeSalon(profile("atendente").permissions)).toBe(false);
  });
});

describe("configurações em duas (Lote 4)", () => {
  it("config.editar deixou de existir; a Gestão tem o dia a dia e o sistema; a Atendente, só o dia a dia", () => {
    expect(isPerm("config.editar")).toBe(false);
    expect(profile("gestao").permissions).toEqual(expect.arrayContaining(["config.diaadia", "config.sistema"]));
    expect(profile("atendente").permissions).toContain("config.diaadia");
    expect(profile("atendente").permissions).not.toContain("config.sistema");
  });
  it("entra em Configurações quem tem qualquer uma das três", () => {
    expect(canConfigure(["config.diaadia"])).toBe(true);
    expect(canConfigure(["config.sistema"])).toBe(true);
    expect(canConfigure(["equipe.gerir"])).toBe(true);
    expect(canConfigure(["config.marcadores"])).toBe(true);
    expect(canConfigure(["config.fichas"])).toBe(true);
    expect(canConfigure(["nota.configurar"])).toBe(true);
    expect(canConfigure(["atendimento.ver"])).toBe(false);
  });
});

it("mensagem em massa: ninguém tem por padrão, nem a Gestão", () => {
  for (const p of SYSTEM_PROFILES) expect(p.permissions).not.toContain("mensagem.massa");
});

describe("app da profissional (Lote 7A)", () => {
  const pro = [...SYSTEM_PROFILES.find((p) => p.key === "profissional")!.permissions];
  it("quem só tem o app da profissional vai para /pro; o resto, para o Hoje", () => {
    expect(isProOnly(pro)).toBe(true);
    expect(firstAllowedPath(pro)).toBe("/pro");
    expect(isProOnly(["pro.app", "atendimento.ver"])).toBe(false);
    expect(firstAllowedPath(["pro.app", "atendimento.ver"])).toBe("/");
    expect(firstAllowedPath(["atendimento.ver"])).toBe("/");
    expect(firstAllowedPath([])).toBe("/");
    expect(isProOnly(null)).toBe(false);
  });
  it("Cadastrar Dias especiais (Fase B, item 14): só a Gestão recebe, no grupo Gestão", () => {
    expect(PERM_LABEL["horario.dias_especiais"]).toBe("Cadastrar Dias especiais");
    expect(PERM_GROUP["horario.dias_especiais"]).toBe("Gestão");
    expect(PERM_HELP["horario.dias_especiais"]).toBeTruthy();
    expect(profile("gestao").permissions).toContain("horario.dias_especiais");
    for (const k of ["atendente", "recepcao", "profissional"] as const) expect(profile(k).permissions).not.toContain("horario.dias_especiais");
    expect(ONE_TIME_GRANTS.some((g) => g.perm === "horario.dias_especiais")).toBe(false);
  });
  it("Fazer a Virada (Fase B, Task 10): só a Gestão recebe, no grupo Gestão", () => {
    expect(PERM_LABEL["virada.fazer"]).toBe("Fazer a troca do ChatGuru para o CRM e ligar o lembrete e o Depois do atendimento");
    expect(PERM_GROUP["virada.fazer"]).toBe("Gestão");
    expect(PERM_HELP["virada.fazer"]).toBeTruthy();
    expect(profile("gestao").permissions).toContain("virada.fazer");
    for (const k of ["atendente", "recepcao", "profissional"] as const) expect(profile(k).permissions).not.toContain("virada.fazer");
    expect(ONE_TIME_GRANTS.some((g) => g.perm === "virada.fazer")).toBe(false);
  });
});
