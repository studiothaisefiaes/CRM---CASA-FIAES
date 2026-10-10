// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Conversation, bubblePropsEqual, type Msg } from "./conversation";

afterEach(cleanup);
const msg = (over: Partial<Msg>): Msg => ({ id: "m1", direction: "in", kind: "text", body: "oi", status: "received", createdAt: new Date().toISOString(), sender: null, fromPhone: false, externalId: "EXT1", ...over });

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
    await waitFor(() => expect(screen.queryByRole("button", { name: /novas? mensagens?/ })).toBeNull()); // sai com a animação de opacidade
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
