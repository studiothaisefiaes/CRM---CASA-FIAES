// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Conversation, type Msg } from "./conversation";

beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
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
