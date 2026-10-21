// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const base = { id: "s1", resumo: "Quer horário.", sugestao: "Tenho terça às 9h ou 13h, qual prefere?", precisaHumano: false, motivo: null };
const { getAiSuggestionAction, requestAiSuggestionAction, prepareAiBookingAction, markAiSuggestionAction } = vi.hoisted(() => ({ getAiSuggestionAction: vi.fn(), requestAiSuggestionAction: vi.fn(), prepareAiBookingAction: vi.fn(), markAiSuggestionAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/ai-actions", () => ({ getAiSuggestionAction, markAiSuggestionAction, requestAiSuggestionAction, prepareAiBookingAction }));
vi.mock("@/components/shell/live", () => ({ useLive: () => {} }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { agendaNote, AiSuggestion } from "./ai-suggestion";
import * as draft from "./composer-draft";

afterEach(cleanup);

describe("cartão da sugestão: horários da agenda", () => {
  it("ofereceu horários: mostra de quando é a agenda e pede para conferir", async () => {
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pronta", suggestion: { ...base, agendaAt: new Date().toISOString() } } });
    render(<AiSuggestion dealId="d1" />);
    expect(await screen.findByText(/^Horários da agenda de hoje às \d{2}:\d{2} — confira antes de enviar$/)).toBeTruthy();
  });
  it("sem horários: sem o aviso", async () => {
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pronta", suggestion: { ...base, agendaAt: null } } });
    render(<AiSuggestion dealId="d1" />);
    await screen.findByTestId("sugestao-ia");
    expect(screen.queryByText(/Horários da agenda/)).toBeNull();
  });
  it("agendaNote: hora de Salvador; outro dia mostra a data", () => {
    expect(agendaNote("2026-10-20T17:05:00Z", new Date("2026-10-20T20:00:00Z"))).toBe("Horários da agenda de hoje às 14:05 — confira antes de enviar");
    expect(agendaNote("2026-10-20T17:05:00Z", new Date("2026-10-21T13:00:00Z"))).toBe("Horários da agenda de 20/10 às 14:05 — confira antes de enviar");
  });
});

describe("Sugerir resposta a qualquer momento: tema opcional e mensagem marcada", () => {
  it("o botão leva o tema e a mensagem que a atendente marcou para responder", async () => {
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pode_pedir" } });
    requestAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pronta", suggestion: { ...base, agendaAt: null } } });
    render(<AiSuggestion dealId="d1" replyTo={{ id: "m9", text: "Onde fica?" }} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Sobre o quê? (opcional)" }), { target: { value: "mandar o endereço e como estacionar" } });
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));
    await waitFor(() => expect(requestAiSuggestionAction).toHaveBeenCalledWith("d1", "primeira", { tema: "mandar o endereço e como estacionar", quotedId: "m9" }));
    expect(await screen.findByTestId("sugestao-ia")).toBeTruthy();
  });
  it("sem tema e sem marcada: pedido vazio", async () => {
    requestAiSuggestionAction.mockClear();
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pode_pedir" } });
    requestAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pode_pedir" } });
    render(<AiSuggestion dealId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sugerir resposta" }));
    await waitFor(() => expect(requestAiSuggestionAction).toHaveBeenCalledWith("d1", "primeira", { tema: null, quotedId: null }));
  });
});

describe("17/10: o botão nunca some (a Cati retoma conversas a qualquer momento)", () => {
  it("fechar a sugestão traz o 'Sugerir resposta' de volta na hora, sem esperar mensagem nova", async () => {
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pronta", suggestion: { ...base, agendaAt: null } } });
    render(<AiSuggestion dealId="d1" />);
    await screen.findByTestId("sugestao-ia");
    fireEvent.click(screen.getByRole("button", { name: "Fechar a sugestão" }));
    expect(await screen.findByRole("button", { name: "Sugerir resposta" })).toBeTruthy();
  });
});

describe("horário proposto pela IA: 'Marcar este horário' abre a folha preenchida (nada é marcado aqui)", () => {
  const horario = { id: "h3", day: "2026-10-20", time: "15:00", professionalId: "p-thaise", professionalName: "THAISE FIAES", serviceId: "s-aval", serviceLabel: "AVALIAÇÃO", durationMin: 60, origem: "lista" as const };
  const pronta = { ok: true, data: { state: "pronta", suggestion: { ...base, sugestao: "Tenho terça, 20/10, às 15h com a Thaise. Posso reservar?", agendaAt: null, horario } } };
  it("mostra 'Horário proposto: ter 20/10 às 15h · Thaise Fiaes · Avaliação'; o botão confere no servidor e chama a folha com o horário", async () => {
    getAiSuggestionAction.mockResolvedValue(pronta);
    const booking = { suggestionId: "s1", slot: horario, livre: true, confirm: "Confirmado agendamento de Avaliação dia 20/10 às 15:00h com Thaise." };
    prepareAiBookingAction.mockResolvedValue({ ok: true, data: booking });
    const onBook = vi.fn();
    render(<AiSuggestion dealId="d1" onBook={onBook} />);
    expect((await screen.findByTestId("horario-proposto")).textContent).toContain("Horário proposto: ter 20/10 às 15h · Thaise Fiaes · Avaliação");
    fireEvent.click(screen.getByRole("button", { name: "Marcar este horário" }));
    await waitFor(() => expect(onBook).toHaveBeenCalledWith(booking, expect.any(Function)));
    expect(prepareAiBookingAction).toHaveBeenCalledWith({ id: "s1", dealId: "d1" });
    // Só abrir a folha: a sugestão continua na tela e nada foi marcado como usado.
    expect(screen.getByTestId("sugestao-ia")).toBeTruthy();
    expect(markAiSuggestionAction).not.toHaveBeenCalled();
  });
  it("ia-horarios2: o botão aparece sempre que há horário, também pedindo alguém da equipe; sem horário, não; abrir a sugestão não marca nem confere nada", async () => {
    prepareAiBookingAction.mockClear(); markAiSuggestionAction.mockClear();
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pronta", suggestion: { ...pronta.data.suggestion, precisaHumano: true, motivo: "remarcação" } } });
    const onBook = vi.fn();
    render(<AiSuggestion dealId="d1" onBook={onBook} />);
    expect(await screen.findByRole("button", { name: "Marcar este horário" })).toBeTruthy();
    expect(screen.getByText(/Pede alguém da equipe:/)).toBeTruthy();
    expect(prepareAiBookingAction).not.toHaveBeenCalled();
    expect(onBook).not.toHaveBeenCalled();
    expect(markAiSuggestionAction).not.toHaveBeenCalled();
    cleanup();
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pronta", suggestion: { ...base, agendaAt: null, horario: null } } });
    render(<AiSuggestion dealId="d1" onBook={onBook} />);
    await screen.findByTestId("sugestao-ia");
    expect(screen.queryByRole("button", { name: "Marcar este horário" })).toBeNull();
  });
  it("sem permissão de marcar (sem onBook): mostra o horário, sem o botão", async () => {
    getAiSuggestionAction.mockResolvedValue(pronta);
    render(<AiSuggestion dealId="d1" />);
    await screen.findByTestId("horario-proposto");
    expect(screen.queryByRole("button", { name: "Marcar este horário" })).toBeNull();
  });
  it("depois de 'Usar e editar', o horário fica numa faixa com o botão até marcar", async () => {
    getAiSuggestionAction.mockResolvedValue(pronta);
    prepareAiBookingAction.mockResolvedValue({ ok: true, data: { suggestionId: "s1", slot: horario, livre: true, confirm: "x" } });
    const onBook = vi.fn((_b: unknown, onBooked: () => void) => onBooked());
    render(<AiSuggestion dealId="d1" onBook={onBook} />);
    fireEvent.click(await screen.findByRole("button", { name: "Usar e editar" }));
    const faixa = await screen.findByRole("region", { name: "Horário proposto pela IA" });
    expect(faixa.textContent).toContain("ter 20/10 às 15h");
    fireEvent.click(within(faixa).getByRole("button", { name: "Marcar este horário" }));
    // Marcou (onBooked): a faixa some.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Horário proposto pela IA" })).toBeNull());
  });
});

describe("20/10: o texto da sugestão se edita no próprio cartão", () => {
  it("o que a atendente escreveu no cartão é o que vai para a caixa de mensagem", async () => {
    const offer = vi.spyOn(draft, "offerDraft").mockImplementation(() => {});
    getAiSuggestionAction.mockResolvedValue({ ok: true, data: { state: "pronta", suggestion: { ...base, agendaAt: null } } });
    render(<AiSuggestion dealId="d1" />);
    const box = (await screen.findByTestId("sugestao-ia")) as HTMLTextAreaElement;
    expect(box.value).toBe(base.sugestao);
    fireEvent.change(box, { target: { value: "Tenho terça às 9h. Posso reservar?" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar e editar" }));
    expect(offer).toHaveBeenCalledWith("d1", "Tenho terça às 9h. Posso reservar?");
    offer.mockRestore();
  });
});
