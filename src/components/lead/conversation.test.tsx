// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Conversation, bubblePropsEqual, optimisticArrived, quotePreview, type Msg } from "./conversation";

/**
 * Relógio injetado: só o `Date` é falso (timers e requestAnimationFrame seguem reais, o motion precisa deles). Meio-dia fixo evita que o rótulo
 * do dia ("Hoje") e a hora das mensagens dependam de quando o teste roda (virada de meia-noite, fuso, máquina lenta).
 */
const AGORA = new Date("2026-10-09T15:00:00.000Z"); // 12:00 em America/Bahia
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: AGORA }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const msg = (over: Partial<Msg>): Msg => ({ id: "m1", direction: "in", kind: "text", body: "oi", status: "received", createdAt: AGORA.toISOString(), sender: null, fromPhone: false, externalId: "EXT1", ...over });

describe("botão Responder", () => {
  it("só aparece em mensagem que tem id no WhatsApp (senão a citação some em silêncio)", () => {
    render(<Conversation onReply={() => {}} messages={[msg({ id: "a", body: "com id" }), msg({ id: "b", body: "sem id", externalId: null }), msg({ id: "c", body: "indefinido", externalId: undefined })]} />);
    expect(screen.getAllByRole("button", { name: "Responder" })).toHaveLength(1);
  });
  it("clicar entrega a mensagem certa", () => {
    const onReply = vi.fn();
    render(<Conversation onReply={onReply} messages={[msg({ id: "a" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});

describe("Apagar para todos (17/10)", () => {
  it("só nas mensagens enviadas pela Casa que chegaram ao WhatsApp (inclusive do celular/ChatGuru); nunca na da cliente", async () => {
    const onDelete = vi.fn();
    render(<Conversation onDelete={onDelete} messages={[
      msg({ id: "in", body: "da cliente" }),
      msg({ id: "crm", direction: "out", status: "sent", body: "do CRM" }),
      msg({ id: "cel", direction: "out", status: "delivered", body: "do celular", fromPhone: true, sentVia: "celular", externalId: "EXT2" }),
      msg({ id: "falhou", direction: "out", status: "failed", body: "não saiu", externalId: null }),
      msg({ id: "nota", direction: "out", kind: "nota", status: "sent", body: "nota", externalId: null }),
    ]} />);
    const menus = screen.getAllByRole("button", { name: "Mais ações da mensagem" });
    expect(menus).toHaveLength(2);
    fireEvent.click(menus[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Apagar para todos" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "crm" }));
  });
  it("apagada mostra só o aviso, sem o conteúdo (20/10): 'Mensagem apagada' / 'A cliente apagou esta mensagem'; sem menu", () => {
    render(<Conversation onDelete={() => {}} messages={[msg({ id: "a", direction: "out", status: "sent", body: "repetida", deleted: true }), msg({ id: "b", body: "dela", deleted: true })]} />);
    expect(screen.getByText(/Mensagem apagada/)).toBeTruthy();
    expect(screen.getByText(/A cliente apagou esta mensagem/)).toBeTruthy();
    expect(screen.queryByText("repetida")).toBeNull();
    expect(screen.queryByText("dela")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mais ações da mensagem" })).toBeNull();
  });
});

/** O jsdom não tem layout: o teste informa as medidas da área de rolagem (altura do conteúdo 1000, janela 300). */
function medidas(log: HTMLElement) {
  Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(log, "clientHeight", { configurable: true, get: () => 300 });
}
const rolarPara = (log: HTMLElement, top: number) => { log.scrollTop = top; fireEvent.scroll(log); };

describe("rolagem da conversa", () => {
  it("abre no fim, sem rolagem animada", () => {
    const scrollTo = vi.fn();
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown; scrollTo?: unknown };
    proto.scrollTo = scrollTo; proto.scrollIntoView = scrollTo;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1000 });
    try {
      render(<Conversation messages={[msg({ id: "a" }), msg({ id: "b" })]} />);
      expect(screen.getByRole("log", { name: "Mensagens" }).scrollTop).toBe(1000); // direto no fim (scrollTop = scrollHeight)
      expect(scrollTo).not.toHaveBeenCalled(); // nenhuma chamada com `behavior: "smooth"`
    } finally { delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight; }
  });

  it("mensagem nova com a pessoa no fim: desce junto e não mostra o aviso", () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" })]} />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 700); // no fim (1000 - 300)
    rerender(<Conversation messages={[msg({ id: "a" }), msg({ id: "b", body: "nova" })]} />);
    expect(screen.queryByRole("button", { name: /nova/ })).toBeNull();
    expect(log.scrollTop).toBe(1000);
  });

  it("com a pessoa lá em cima: não puxa a leitura, mostra '1 nova mensagem' e descer limpa o aviso", async () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" })]} />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 100);
    rerender(<Conversation messages={[msg({ id: "a" }), msg({ id: "b", body: "nova" })]} />);
    expect(log.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: "1 nova mensagem" })).toBeTruthy();
    rerender(<Conversation messages={[msg({ id: "a" }), msg({ id: "b", body: "nova" }), msg({ id: "c", body: "outra" })]} />);
    expect(screen.getByRole("button", { name: "2 novas mensagens" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2 novas mensagens" }));
    expect(log.scrollTop).toBe(1000);
    await waitFor(() => expect(screen.queryByRole("button", { name: /novas? mensagens?/ })).toBeNull(), { timeout: 3000 }); // sai com a animação de opacidade
  });

  it("trocar de conversa abre nas mais recentes, mesmo se a anterior estava lá em cima", () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" }), msg({ id: "b" })]} />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 100);
    rerender(<Conversation messages={[msg({ id: "x1" }), msg({ id: "x2", body: "outra cliente" })]} />);
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /novas? mensagens?/ })).toBeNull();
  });

  it("lendo mensagens antigas: 'Mais recentes' leva de volta ao fim", () => {
    render(<Conversation messages={[msg({ id: "a" })]} />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 100);
    fireEvent.click(screen.getByRole("button", { name: /Mais recentes/ }));
    expect(log.scrollTop).toBe(1000);
  });

  it("o que eu mesma envio sempre desce, mesmo com a leitura lá em cima", () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" })]} />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 100);
    rerender(<Conversation messages={[msg({ id: "a" }), msg({ id: "optimistic", direction: "out", status: "pending", body: "enviando" })]} />);
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: /nova/ })).toBeNull();
  });
});

describe("quem manda e o que isso faz com a rolagem", () => {
  it("saída por outro canal (celular da Casa, automação) com a pessoa lá em cima segue a regra do aviso", () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" })]} />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 100);
    rerender(<Conversation messages={[msg({ id: "a" }), msg({ id: "b", direction: "out", fromPhone: true, status: "sent", body: "do celular" })]} />);
    expect(log.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: "1 nova mensagem" })).toBeTruthy();
  });

  it("envio de mídia (forceEndKey muda) desce, mesmo sem balão provisório", () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" })]} forceEndKey={0} />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 100);
    rerender(<Conversation messages={[msg({ id: "a" })]} forceEndKey={1} />);
    expect(log.scrollTop).toBe(1000);
  });

  it("trocar de aba: se estava no fim, volta ao fim ao reexibir; se estava lendo, volta onde estava", () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" })]} visible />);
    const log = screen.getByRole("log", { name: "Mensagens" });
    medidas(log);
    rolarPara(log, 700); // no fim
    rerender(<Conversation messages={[msg({ id: "a" })]} visible={false} />);
    log.scrollTop = 0; // o navegador zera a rolagem de um elemento escondido
    rerender(<Conversation messages={[msg({ id: "a" })]} visible />);
    expect(log.scrollTop).toBe(1000);

    rolarPara(log, 200); // lendo no meio
    rerender(<Conversation messages={[msg({ id: "a" })]} visible={false} />);
    log.scrollTop = 0;
    rerender(<Conversation messages={[msg({ id: "a" })]} visible />);
    expect(log.scrollTop).toBe(200);
  });
});

describe("balões memoizados", () => {
  const props = (m: Msg, over = {}) => ({ m, day: null, onReply: undefined, animateIn: false, ...over });
  it("objetos novos com o mesmo conteúdo não re-renderizam o balão", () => {
    expect(bubblePropsEqual(props(msg({ id: "a" })), props({ ...msg({ id: "a" }) }))).toBe(true);
  });
  it("mudou o estado da mensagem (enviada → lida) ou o texto: re-renderiza", () => {
    const base = msg({ id: "a", direction: "out", status: "sent" });
    expect(bubblePropsEqual(props(base), props({ ...base, status: "read" }))).toBe(false);
    expect(bubblePropsEqual(props(base), props({ ...base, body: "editado", edited: true }))).toBe(false);
  });
  it("mudou o rótulo do dia ou a função de responder: re-renderiza", () => {
    expect(bubblePropsEqual(props(msg({})), props(msg({}), { day: "Hoje" }))).toBe(false);
    expect(bubblePropsEqual(props(msg({})), props(msg({}), { onReply: () => {} }))).toBe(false);
  });
});

describe("quem enviou", () => {
  it("balão da Casa mostra nome e por onde saiu, sem repetir a assinatura no texto", () => {
    render(<Conversation onReply={() => {}} messages={[
      msg({ id: "a", direction: "out", status: "sent", fromPhone: true, sentVia: "celular", sender: "Cati", body: "*CATI - CASA FIAES:*\nConfirmado!" }),
      msg({ id: "b", direction: "out", status: "sent", fromPhone: false, sentVia: "crm", sender: "Sara Lima", body: "*SARA - CASA FIAES:*\nOi" }),
      msg({ id: "c", direction: "out", status: "sent", fromPhone: true, sender: null, body: "*MARIA - CASA FIAES:*\nOlá" }),
      msg({ id: "d", direction: "out", status: "sent", fromPhone: false, sender: null, body: "Lembrete" }),
    ]} />);
    expect(screen.getByText("Confirmado!")).toBeTruthy();
    expect(screen.queryByText(/CASA FIAES/)).toBeNull();
    // O nome vai pequeno no topo do balão quando muda quem fala; o rodapé fica com por onde saiu e a hora (uma informação por lugar).
    expect([...document.querySelectorAll("[data-quem]")].map((e) => e.textContent)).toEqual(["Cati", "Sara", "Maria"]);
    expect(screen.getAllByText(/^pelo celular · /)).toHaveLength(2);
    expect(screen.queryByText(/Cati · /)).toBeNull();
    expect(screen.getByText(/automática ·/)).toBeTruthy();
  });
});

describe("nome de quem fala", () => {
  it("aparece só quando muda quem fala (a mesma atendente seguida não repete); mensagem da cliente não leva nome", () => {
    render(<Conversation messages={[
      msg({ id: "1", direction: "in", body: "Oi" }),
      msg({ id: "2", direction: "out", status: "sent", sentVia: "crm", sender: "Sara", body: "*SARA - CASA FIAES:*\nOlá" }),
      msg({ id: "3", direction: "out", status: "sent", sentVia: "crm", sender: "Sara", body: "*SARA - CASA FIAES:*\nTudo bem?", createdAt: new Date(AGORA.getTime() + 20 * 60_000).toISOString() }),
      msg({ id: "4", direction: "out", status: "sent", sentVia: "celular", fromPhone: true, sender: "Cati", body: "*CATI - CASA FIAES:*\nConfirmado" }),
    ]} />);
    expect([...document.querySelectorAll("[data-quem]")].map((e) => e.textContent)).toEqual(["Sara", "Cati"]);
  });
});

describe("citação", () => {
  it("a citação e o 'Respondendo a' não mostram a assinatura *CATI - CASA FIAES:*", () => {
    render(<Conversation messages={[msg({ id: "q", direction: "in", body: "Pode ser às 15h", quotedBody: "*CATI - CASA FIAES:*\nVamos marcar?" })]} />);
    expect(screen.getByText("Vamos marcar?")).toBeTruthy();
    expect(screen.queryByText(/CASA FIAES/)).toBeNull();
    expect(quotePreview(msg({ direction: "out", body: "*CATI - CASA FIAES:*\nVamos marcar?" }))).toBe("Vamos marcar?");
  });
});

describe("balão provisório do envio", () => {
  const sent = { text: "Oi, tudo bem?", at: AGORA.getTime() };
  it("some quando a mensagem chega do servidor com a assinatura de quem enviou na frente (senão aparecem dois balões enquanto envia)", () => {
    expect(optimisticArrived([msg({ id: "p", direction: "out", status: "pending", body: "*SARA - CASA FIAES:*\nOi, tudo bem?" })], sent)).toBe(true);
  });
  it("continua sem assinatura, e não confunde com mensagem antiga ou da cliente", () => {
    expect(optimisticArrived([msg({ id: "p", direction: "out", status: "pending", body: "Oi, tudo bem?" })], sent)).toBe(true);
    expect(optimisticArrived([msg({ id: "v", direction: "out", body: "*SARA - CASA FIAES:*\nOi, tudo bem?", createdAt: new Date(AGORA.getTime() - 60_000).toISOString() })], sent)).toBe(false);
    expect(optimisticArrived([msg({ id: "c", direction: "in", body: "Oi, tudo bem?" })], sent)).toBe(false);
  });
});

describe("nota interna", () => {
  it("aparece como nota da equipe: sem Responder, sem tique e com o @ em destaque", () => {
    render(<Conversation onReply={() => {}} messages={[msg({ id: "nota:n1", kind: "nota", direction: "out", status: "nota", body: "@Cati confere o sinal", sender: "Sara", externalId: null, note: "crm" })]} />);
    const note = screen.getByRole("note", { name: "Nota interna" });
    expect(note.textContent).toContain("Nota interna · só a equipe vê");
    expect(note.textContent).toContain("Sara");
    expect(note.querySelector("b")?.textContent).toBe("@Cati");
    expect(screen.queryByRole("button", { name: "Responder" })).toBeNull();
    expect(screen.queryByLabelText(/Status:/)).toBeNull();
  });
});

describe("ligações e reações (Lote 5)", () => {
  it("ligação perdida aparece como registro no meio da conversa", () => {
    render(<Conversation messages={[msg({ id: "c1", kind: "call", body: "Ligação perdida", externalId: "call:1" })]} />);
    expect(screen.getByTestId("ligacao").textContent).toContain("Ligação perdida");
  });
  it("ligação atendida: recebida/feita, atendida e a duração", () => {
    render(<Conversation messages={[msg({ id: "c1", kind: "call", body: "x", call: { video: false, status: "atendida", durationSecs: 185 } }),
      msg({ id: "c2", kind: "call", direction: "out", body: "x", call: { video: false, status: "perdida" } })]} />);
    const rows = screen.getAllByTestId("ligacao").map((e) => e.textContent);
    expect(rows[0]).toContain("Ligação recebida · atendida · 3 min");
    expect(rows[1]).toContain("Ligação feita · não atendida");
  });
  it("reação aparece embaixo do balão, dizendo de quem é", () => {
    render(<Conversation messages={[msg({ id: "m1", reactions: { cliente: "❤️" } })]} />);
    expect(screen.getByLabelText("Reação da cliente: ❤️")).toBeTruthy();
  });
  it("a anotação da ligação aparece dentro dela, com assunto, autora e hora", () => {
    render(<Conversation messages={[msg({ id: "c1", kind: "call", body: "x", call: { video: false, status: "atendida" },
      callNotes: [{ id: "n1", subject: "Agendamento", body: "marcou corte sábado 14h com a Ana", authorName: "Sara", createdAt: AGORA.toISOString() }] })]} />);
    const row = screen.getByTestId("ligacao-card");
    expect(row.textContent).toContain("Agendamento");
    expect(row.textContent).toContain("marcou corte sábado 14h com a Ana");
    expect(row.textContent).toContain("Sara");
  });
  it("Anotar o que foi falado: assunto + o que ocorreu, salva e oferece Marcar horário", async () => {
    const onNote = vi.fn(async () => true);
    const onBook = vi.fn();
    render(<Conversation callActions={{ onNote, onBook }} messages={[msg({ id: "c1", kind: "call", body: "x", call: { video: false, status: "atendida" } }),
      msg({ id: "c2", kind: "call", body: "Ligação perdida", call: { video: false, status: "perdida" } })]} />);
    // Toda ligação aceita anotação (a atendida no celular chega como "recebida"; a perdida pode ter sido retornada).
    expect(screen.getAllByRole("button", { name: "Anotar o que foi falado" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Anotar o que foi falado" })[0]);
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Agendamento" } });
    const save = screen.getByRole("button", { name: "Salvar anotação" });
    expect((save as HTMLButtonElement).disabled).toBe(true); // falta o que ocorreu
    fireEvent.change(screen.getByLabelText("O que ocorreu"), { target: { value: "marcou corte sábado 14h com a Ana" } });
    fireEvent.click(save);
    await waitFor(() => expect(onNote).toHaveBeenCalledWith("c1", { subject: "Agendamento", body: "marcou corte sábado 14h com a Ana" }));
    fireEvent.click(await screen.findByRole("button", { name: "Marcar horário" }));
    expect(onBook).toHaveBeenCalled();
  });
});

describe("ligação recebida sem resultado: marcar à mão", () => {
  it("'recebida' mostra Foi atendida / Foi perdida; a escolha chama onMark", async () => {
    const onMark = vi.fn(async () => true);
    render(<Conversation callActions={{ onNote: async () => true, onMark }} messages={[msg({ id: "c1", kind: "call", body: "Ligação recebida", call: { video: false, status: "recebida" } }),
      msg({ id: "c2", kind: "call", body: "x", call: { video: false, status: "atendida" } })]} />);
    expect(screen.getAllByRole("button", { name: "Foi atendida" })).toHaveLength(1); // a atendida pelo WhatsApp não pergunta
    fireEvent.click(screen.getByRole("button", { name: "Foi perdida" }));
    await waitFor(() => expect(onMark).toHaveBeenCalledWith("c1", "perdida"));
  });
  it("marcada à mão: rótulo novo (perdida em vermelho) e dá para trocar pelo menu discreto", async () => {
    const onMark = vi.fn(async () => true);
    render(<Conversation callActions={{ onNote: async () => true, onMark }} messages={[msg({ id: "c1", kind: "call", body: "x",
      call: { video: false, status: "perdida", marked: { by: "u1", at: AGORA.toISOString(), prevAwaitingSince: null } } })]} />);
    const row = screen.getByTestId("ligacao");
    expect(row.textContent).toContain("Ligação perdida");
    expect(row.className).toContain("text-alert");
    expect(screen.queryByRole("button", { name: "Foi atendida" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Trocar resultado da ligação" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Foi atendida" }));
    await waitFor(() => expect(onMark).toHaveBeenCalledWith("c1", "atendida"));
  });
  it("ligação feita registrada à mão mostra quem registrou", () => {
    render(<Conversation messages={[msg({ id: "c1", kind: "call", direction: "out", sender: "Sara Lima", body: "x", call: { video: false, status: "perdida", manual: true } })]} />);
    expect(screen.getByTestId("ligacao-card").textContent).toContain("Ligação feita · não atendida");
    expect(screen.getByTestId("ligacao-card").textContent).toContain("registrada por Sara");
  });
});

describe("balão de áudio", () => {
  const aud = (over: Partial<Msg>) => msg({ id: "aud", kind: "audio", body: null, hasMedia: true, ...over });
  it("mostra a duração real e oferece m4a e ogg ao player", () => {
    const { container } = render(<Conversation messages={[aud({ durationSec: 42, hasPlayback: true })]} />);
    expect(screen.getByText("0:42")).toBeTruthy();
    const sources = [...container.querySelectorAll("audio source")].map((s) => [s.getAttribute("src"), s.getAttribute("type")]);
    expect(sources).toEqual([["/api/media/aud", "audio/mp4"], ["/api/media/aud?original=1", "audio/ogg"]]);
  });
  it("sem a cópia m4a ainda: só o original", () => {
    const { container } = render(<Conversation messages={[aud({ durationSec: 75 })]} />);
    expect(screen.getByText("1:15")).toBeTruthy();
    expect(container.querySelectorAll("audio source")).toHaveLength(1);
  });
  it("transcrição aparece embaixo, recolhível, com ver tudo quando é longa", () => {
    const longa = "Oi, bom dia! ".repeat(30) + "fim da fala";
    render(<Conversation messages={[aud({ durationSec: 90, transcript: longa, transcriptStatus: "pronta" })]} />);
    const t = screen.getByTestId("transcricao");
    expect(t.textContent).toContain("fim da fala");
    expect(t.className).toMatch(/line-clamp-3/);
    fireEvent.click(screen.getByRole("button", { name: "ver tudo" }));
    expect(screen.getByTestId("transcricao").className).not.toMatch(/line-clamp-3/);
    fireEvent.click(screen.getByRole("button", { name: /Transcrição/ }));
    expect(screen.queryByTestId("transcricao")).toBeNull();
  });
  it("transcrição curta não tem ver tudo", () => {
    render(<Conversation messages={[aud({ transcript: "Pode ser às 15h?", transcriptStatus: "pronta" })]} />);
    expect(screen.getByTestId("transcricao").textContent).toBe("Pode ser às 15h?");
    expect(screen.queryByRole("button", { name: "ver tudo" })).toBeNull();
  });
  it("pendente mostra Transcrevendo…; sem fala e falhou não mostram nada", () => {
    const { rerender } = render(<Conversation messages={[aud({ transcriptStatus: "pendente" })]} />);
    expect(screen.getByText("Transcrevendo…")).toBeTruthy();
    rerender(<Conversation messages={[aud({ transcriptStatus: "sem_fala" })]} />);
    expect(screen.queryByText("Transcrevendo…")).toBeNull();
    expect(screen.queryByText(/Transcrição/)).toBeNull();
    rerender(<Conversation messages={[aud({ transcriptStatus: "falhou" })]} />);
    expect(screen.queryByText(/Transcri/)).toBeNull();
  });
  it("áudio de mais de 10 min avisa que a transcrição é só do começo", () => {
    render(<Conversation messages={[aud({ durationSec: 900, transcript: "começo", transcriptStatus: "pronta" })]} />);
    expect(screen.getByText(/10 primeiros minutos/)).toBeTruthy();
  });
});

describe("citação clicável", () => {
  const at = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString();
  const conv = () => [
    msg({ id: "orig", body: "Quais horários livres na terça à tarde?", createdAt: at(-30) }),
    msg({ id: "x", direction: "out", body: "*SARA - CASA FIAES:*\nVou ver aqui", createdAt: at(-20) }),
    msg({ id: "cita", direction: "out", body: "*SARA - CASA FIAES:*\nTerça 15h com a Maiara", quotedBody: "Quais horários livres na terça à tarde?", createdAt: at(-10) }),
    msg({ id: "velha", body: "Ok", quotedBody: "mensagem que não está carregada", createdAt: at(-5) }),
  ];
  it("findQuoted: acha a original antes da que cita (citação cortada vale); fora do histórico → null", async () => {
    const { findQuoted } = await import("./conversation");
    expect(findQuoted(conv(), "cita")).toBe("orig");
    expect(findQuoted([msg({ id: "o", body: "Oi! Quero saber o preço da progressiva e da hidratação" }), msg({ id: "c", quotedBody: "Oi! Quero saber o preço da progressiva" })], "c")).toBe("o");
    expect(findQuoted(conv(), "velha")).toBeNull();
  });
  it("clicar na citação rola até a original e destaca ~2 s; fora do histórico avisa", async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<Conversation messages={conv()} />);
    fireEvent.click(screen.getByRole("button", { name: /Ir para a mensagem citada: Quais horários/ }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts[0]).toBe(document.querySelector('[data-msg-id="orig"]'));
    const balao = () => document.querySelector('[data-msg-id="orig"] [data-destaque]');
    expect(balao()).not.toBeNull();
    await waitFor(() => expect(balao()).toBeNull(), { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: /Ir para a mensagem citada: mensagem que não/ }));
    expect(await screen.findByText("Mensagem antiga, fora do histórico carregado")).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("balão de foto", () => {
  it("mostra a miniatura (?thumb=1, prioridade baixa) e o toque abre o original", () => {
    const { container } = render(<Conversation messages={[msg({ id: "img1", kind: "image", body: null, hasMedia: true })]} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/media/img1?thumb=1");
    expect(img.getAttribute("fetchpriority")).toBe("low");
    expect(img.closest("a")?.getAttribute("href")).toBe("/api/media/img1");
  });
});

describe("balão de foto sem miniatura", () => {
  it("se a miniatura falhar, tenta o original uma vez; se o original também falhar, avisa", () => {
    const { container } = render(<Conversation messages={[msg({ id: "img2", kind: "image", body: null, hasMedia: true })]} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/api/media/img2");
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("não foi possível carregar");
  });
});

describe("Reagir e Editar (Task 12)", () => {
  it("sem tools, nada de barra nem de menu; com tools, o botão direito abre a barra e reagir entrega a mensagem e o emoji", () => {
    const { rerender } = render(<Conversation messages={[msg({ id: "a" })]} />);
    fireEvent.contextMenu(screen.getByText("oi"));
    expect(screen.queryByTestId("barra-mensagem")).toBeNull();
    const react = vi.fn();
    rerender(<Conversation tools={{ react }} messages={[msg({ id: "a" }), msg({ id: "b", body: "sem id", externalId: null })]} />);
    fireEvent.contextMenu(screen.getByText("sem id"));
    expect(screen.queryByTestId("barra-mensagem")).toBeNull();
    fireEvent.contextMenu(screen.getByText("oi"));
    expect(screen.getByTestId("barra-mensagem")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reagir 🙏" }));
    expect(react).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "🙏");
  });
  it("Editar aparece só quando canEdit libera a mensagem", () => {
    const edit = vi.fn();
    render(<Conversation tools={{ edit, canEdit: (m) => m.id === "mine" }} messages={[
      msg({ id: "mine", direction: "out", status: "sent", body: "minha", sentVia: "crm" }), msg({ id: "other", direction: "out", status: "sent", body: "de outra", sentVia: "crm", externalId: "E2" })]} />);
    fireEvent.contextMenu(screen.getByText("de outra"));
    expect(screen.queryByTestId("barra-mensagem")).toBeNull();
    fireEvent.contextMenu(screen.getByText("minha"));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: "mine" }));
  });
  it("Encaminhar fica à vista ao lado do Responder (foto da cliente), sem abrir o menu", () => {
    const forward = vi.fn();
    render(<Conversation onReply={() => {}} tools={{ forward, canForward: (m) => m.id === "foto" }} messages={[
      msg({ id: "foto", kind: "image", body: "" }), msg({ id: "nota", body: "não encaminha", externalId: "E3" })]} />);
    const botoes = screen.getAllByRole("button", { name: "Encaminhar" });
    expect(botoes).toHaveLength(1);
    fireEvent.click(botoes[0]);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ id: "foto" }));
  });
});

describe("links no balão (22/10, reel do Instagram da cliente não abria)", () => {
  it("http(s) e www. viram link em aba nova; a pontuação do fim fica fora; texto sem link continua texto", () => {
    render(<Conversation messages={[
      msg({ id: "a", body: "Mando como referência https://www.instagram.com/reel/DTWC_vLkaKQ/?igsh=x1 olha" }),
      msg({ id: "b", body: "veja www.casafiaes.com.br.", externalId: "EXT2" }),
      msg({ id: "c", body: "javascript:alert(1) sem link", externalId: "EXT3" }),
    ]} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href"), l.getAttribute("target")])).toEqual([
      ["https://www.instagram.com/reel/DTWC_vLkaKQ/?igsh=x1", "https://www.instagram.com/reel/DTWC_vLkaKQ/?igsh=x1", "_blank"],
      ["www.casafiaes.com.br", "https://www.casafiaes.com.br", "_blank"],
    ]);
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/javascript:alert\(1\) sem link/)).toBeTruthy();
  });
});
