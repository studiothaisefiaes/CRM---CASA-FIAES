import { describe, expect, it } from "vitest";
import {
  ALERT_HELP, ALERT_TYPES, SECTION_TITLE, alertGroupOf, alertText, answeredText, chipHelp, clientLabel, dueText, firstName, helpCatalog,
  lastMessageTime, ownerHint, sectionHelp, sectionShort, sinceLabel, slaText, stoppedText, taskTitleFor, transferText, waitClockText,
} from "./alert-copy";
import { SIGNAL_LABEL, SIGNAL_ORDER } from "../server/domain/signals";

const bahia = (iso: string) => new Date(`${iso}-03:00`).getTime();
const NOW = bahia("2026-10-15T14:30:00"); // quinta 14:30 em Salvador

describe("quem e quando", () => {
  it("cliente: nome; sem nome, final do telefone; número oculto, 'cliente sem nome'. Nunca o +55 cru", () => {
    expect(clientLabel("  Edson Moreira ", "+5571999990000")).toBe("Edson Moreira");
    expect(clientLabel(null, "+5571999990000")).toBe("cliente com final 0000");
    expect(clientLabel("", "lid:123456")).toBe("cliente sem nome");
    expect(firstName("Catarina Souza")).toBe("Catarina");
    expect(firstName(null)).toBeNull();
  });
  it("hora com o dia quando não é hoje", () => {
    expect(sinceLabel(bahia("2026-10-15T14:02:00"), NOW)).toBe("14:02");
    expect(sinceLabel(bahia("2026-10-14T13:00:00"), NOW)).toBe("ontem 13:00");
    expect(dueText(bahia("2026-10-14T13:00:00"), NOW)).toBe("venceu ontem 13:00");
    expect(dueText(bahia("2026-10-15T16:00:00"), NOW)).toBe("vence hoje 16:00");
    expect(stoppedText(1)).toBe("parado há 1 dia");
    expect(stoppedText(3)).toBe("parado há 3 dias");
  });
});

describe("prazo", () => {
  it("um texto só: quanto falta ou quanto passou", () => {
    expect(slaText(4 * 60, 15)).toBe("Responda em 11 min");
    expect(slaText(14 * 60 + 30, 15)).toBe("Responda em menos de 1 min");
    expect(slaText(15 * 60 + 20, 15)).toBe("O prazo acabou");
    expect(slaText(19 * 60, 15)).toBe("Passou 4 min do prazo");
    expect(slaText(80 * 60, 15)).toBe("Passou 1 h 05 do prazo");
    expect(slaText(600, null)).toBeNull();
  });
  it("relógio do cabeçalho", () => {
    expect(waitClockText("12 min", 15)).toBe("Esperando há 12 min (prazo 15)");
    expect(waitClockText("3 min", null)).toBe("Esperando há 3 min");
  });
});

describe("Fila", () => {
  it("títulos novos e a frase fixa de cada seção", () => {
    expect(SECTION_TITLE).toEqual({
      atrasados: "Atrasados", perto: "Quase no prazo", aguardando: "Esperando a Casa responder", "acoes-hoje": "Combinados para hoje e atrasados",
      parados: "Parados", "aguardando-cliente": "Aguardando a cliente", reengajar: "Hora de voltar", arquivadas: "Resolvidas",
    });
    expect(sectionHelp("atrasados")).toBe("A cliente escreveu e ninguém respondeu no prazo. Responda primeiro.");
    expect(sectionHelp("perto", 3)).toBe("Responda em até 3 min.");
    expect(sectionHelp("aguardando")).toBe("A cliente escreveu; ainda está no prazo.");
    expect(sectionHelp("parados", 2)).toBe("Há 2 dias ou mais sem ninguém decidir o próximo passo. Marque Agendar, Aguardar cliente ou Resolver.");
    expect(sectionHelp("aguardando-cliente")).toBe("A Casa respondeu; agora é com ela.");
    expect(sectionHelp("arquivadas")).toBe("Voltam sozinhas se a cliente escrever.");
  });
  it("dona, transferência e quem respondeu", () => {
    expect(ownerHint(null, false)).toBe("Ninguém assumiu. Toque em Assumir se for você.");
    expect(ownerHint("Sara Lima", false)).toBe("Sara está cuidando. Assumir tira dela.");
    expect(ownerHint("Sara Lima", true)).toBe("Você está cuidando desta conversa.");
    expect(transferText("Catarina Souza", "Sara Lima", true)).toBe("Catarina te passou esta conversa");
    expect(transferText("Catarina Souza", "Sara Lima", false)).toBe("Catarina passou para Sara");
    expect(answeredText({ by: "Cati Souza", fromPhone: true, at: "ontem 13:15" })).toBe("Cati respondeu ontem 13:15 pelo celular; agora é a vez da cliente.");
    expect(answeredText({ by: null, fromPhone: true, at: "hoje 09:00" })).toBe("A Casa respondeu hoje 09:00 pelo celular; agora é a vez da cliente.");
    expect(answeredText({ by: null, fromPhone: false, at: "hoje 09:00" })).toBe("A mensagem automática saiu hoje 09:00; agora é a vez da cliente.");
  });
  it("todo chip que a Fila mostra tem dica", () => {
    for (const s of SIGNAL_ORDER) expect(chipHelp(SIGNAL_LABEL[s]).length).toBeGreaterThan(10);
    for (const c of ["Sem dono", "Novo", "Convite de retorno", "Agendado hoje", "Agendado amanhã", "Interesse: Progressiva", "Mega hair"]) expect(chipHelp(c).length).toBeGreaterThan(10);
  });
});

describe("alertas: sem nome repetido nem telefone cru", () => {
  it("espera e escalado dizem desde quando, o prazo e a dona", () => {
    expect(alertText.wait({ client: "Fulana", sinceMs: bahia("2026-10-15T14:02:00"), slaMinutes: 15, ownerName: "Sara Lima", now: NOW })).toBe("Fulana espera resposta desde 14:02 (prazo 15 min). Dona: Sara.");
    expect(alertText.wait({ client: "Edson", sinceMs: bahia("2026-10-14T17:50:00"), slaMinutes: 15, ownerName: null, now: NOW })).toBe("Edson espera resposta desde ontem 17:50 (prazo 15 min). Sem dono.");
    expect(alertText.escalated({ client: "Fulana", sinceMs: bahia("2026-10-15T14:02:00"), ownerName: "Sara", now: NOW })).toBe("Escalado: Fulana sem resposta desde 14:02. Dona: Sara.");
  });
  it("combinado: o título sem o nome da cliente nem telefone", () => {
    expect(taskTitleFor("Retomar contato com Joana Lima", "Joana Lima")).toBe("retomar contato");
    expect(taskTitleFor("Retomar contato com a cliente", null)).toBe("retomar contato");
    expect(taskTitleFor("Retomar contato com +5571999990000", null)).toBe("retomar contato");
    expect(taskTitleFor("Remarcar com Bianca", "Bianca Teles")).toBe("remarcar");
    expect(taskTitleFor("Mandar valores", "Joana")).toBe("mandar valores");
    expect(alertText.taskDue({ title: "Retomar contato com Joana Lima", contactName: "Joana Lima", client: "Joana Lima", overdue: false })).toBe("Combinado vencendo: retomar contato (Joana Lima).");
    expect(alertText.taskDue({ title: "Retomar contato com +5571999990000", contactName: null, client: clientLabel(null, "+5571999990000"), overdue: true })).toBe("Combinado vencido: retomar contato (cliente com final 0000).");
  });
  it("conversa passada: sem artigo, funciona com nome masculino", () => {
    expect(alertText.claimed("Catarina Souza", "Edson")).toBe("Catarina assumiu a conversa de Edson");
    expect(alertText.transferred("Catarina Souza", "Edson")).toBe("Catarina te passou a conversa de Edson");
    expect(alertText.offer("Edson")).toBe("A dona não respondeu. Pode assumir Edson?");
  });
  it("outra pessoa respondeu a conversa da dona (aviso do Lote 1A): mesma frase, sem telefone", () => {
    expect(alertText.repliedByOther("Catarina Souza", "Edson")).toBe("Catarina respondeu a conversa de Edson. A conversa passou para ela (quem responde assume).");
    expect(alertText.repliedByOther(null, "Edson")).toBe("Outra pessoa respondeu a conversa de Edson. A conversa passou para ela (quem responde assume).");
  });
  it("aniversário diz o dia e não promete mensagem pronta", () => {
    expect(alertText.birthday("Fulana", 17, 10)).toBe("Aniversário de Fulana dia 17/10. Que tal mandar um parabéns?");
  });
  it("envio automático que falhou diz o que fazer", () => {
    expect(alertText.autoSendFailed("Fulana", "WhatsApp desconectado")).toBe("Mensagem automática para Fulana não saiu (WhatsApp desconectado). Abra a conversa e envie manualmente.");
  });
  it("nenhum texto de alerta mostra +55 cru", () => {
    const client = clientLabel(null, "+5571988887777");
    for (const t of [alertText.wait({ client, sinceMs: NOW, slaMinutes: 15, ownerName: null, now: NOW }), alertText.offer(client), alertText.claimed("Ana", client), alertText.repliedByOther("Ana", client), alertText.birthday(client, 1, 2), alertText.autoSendFailed(client)])
      expect(t).not.toMatch(/\+55/);
  });
});

describe("ajuda e sino", () => {
  it("a página cobre toda seção, todo sinal e todo tipo de alerta, com âncoras únicas", () => {
    const ids = helpCatalog().flatMap((g) => g.entries.map((e) => e.id));
    for (const k of Object.keys(SECTION_TITLE)) expect(ids).toContain(`fila-${k}`);
    for (const s of SIGNAL_ORDER) expect(ids).toContain(`sinal-${s}`);
    for (const t of ALERT_TYPES) expect(ALERT_HELP.some((h) => h.types.includes(t))).toBe(true);
    for (const h of ALERT_HELP) expect(ids).toContain(h.id);
    expect(ALERT_TYPES).toContain("respondida_por_outra");
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("a ajuda explica os selos do funil novo (tentativa e pacote)", () => {
    const ids = helpCatalog().flatMap((g) => g.entries.map((e) => e.id));
    expect(ids).toEqual(expect.arrayContaining(["linha-tentativa", "linha-pacote"]));
  });
  it("tipo desconhecido cai em Outros", () => {
    expect(alertGroupOf("sem_resposta_minutos")).toBe("espera");
    expect(alertGroupOf("tarefa_vencendo")).toBe("combinados");
    expect(alertGroupOf("folga_pedida")).toBe("agenda");
    expect(alertGroupOf("respondida_por_outra")).toBe("conversas");
    expect(alertGroupOf("x")).toBe("outros");
  });
});

describe("linha da Fila: hora da última mensagem e cabeçalho curto", () => {
  it("hoje a hora, ontem 'ontem', antes dd/mm (relógio de Salvador)", () => {
    expect(lastMessageTime(bahia("2026-10-15T09:31:00"), NOW)).toBe("09:31");
    expect(lastMessageTime(bahia("2026-10-15T00:05:00"), NOW)).toBe("00:05");
    expect(lastMessageTime(bahia("2026-10-14T23:59:00"), NOW)).toBe("ontem");
    expect(lastMessageTime(bahia("2026-10-13T10:00:00"), NOW)).toBe("13/10");
    expect(lastMessageTime(bahia("2025-12-31T10:00:00"), NOW)).toBe("31/12");
  });
  it("cabeçalho da seção: 'N · frase curta'", () => {
    expect(sectionShort("atrasados", 2)).toBe("2 · responda primeiro");
    expect(sectionShort("perto", 1, 3)).toBe("1 · até 3 min");
    expect(sectionShort("perto", 1)).toBe("1 · quase acabando");
    expect(sectionShort("aguardando", 5)).toBe("5 · no prazo");
    expect(sectionShort("acoes-hoje", 4)).toBe("4 · hoje"); // o título já diz "combinados": curto para caber numa linha nos 340 px
    expect(sectionShort("parados", 3, 4)).toBe("3 · há 4+ dias");
    expect(sectionShort("aguardando-cliente", 72)).toBe("72 · com ela");
    expect(sectionShort("reengajar", 9)).toBe("9 · +90 dias");
    expect(sectionShort("arquivadas", 1)).toBe("1 · voltam sozinhas");
  });
});
