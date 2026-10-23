// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { QueueItem } from "@/server/queries/queue";
import { HoursProvider } from "@/components/pipeline/timer";
import type { BusinessHours } from "@/lib/business-hours";
import { QueueList, __itemRenderCount } from "./queue-list";

/** Casa aberta 24 h: o teste não pode depender da hora em que roda (fora do expediente a espera não anda). */
const allDay: [string, string] = ["00:00", "24:00"];
const HOURS: BusinessHours = { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay };

afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([100, 30])("o relógio não re-renderiza os itens da fila (%i itens; só as folhas do tempo)", (n) => {
  vi.useFakeTimers();
  const items: QueueItem[] = Array.from({ length: n }, (_, i) => ({
    dealId: String(i), contactId: String(i), name: `C${i}`, phone: "+55", hasAvatar: false,
    awaitingSince: new Date(Date.now() - 60_000).toISOString(), slaMinutes: 2, lastMessage: "oi", lastKind: "text", lastDirection: "in" as const, lastAt: null,
    stageKey: "lead", stageName: "Lead", sourceLabel: "", ownerName: null, signals: [], tags: [],
  }));
  render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items }]} /></HoursProvider>);
  const before = __itemRenderCount.value;
  expect(before).toBeGreaterThan(0); // o contador existe e contou a primeira pintura
  act(() => { vi.advanceTimersByTime(3000); });
  expect(__itemRenderCount.value - before).toBe(0);
});

it("o status anda sozinho: Aberto fica vermelho ao passar do prazo (só a folha do status)", () => {
  vi.useFakeTimers();
  const items: QueueItem[] = [{
    dealId: "1", contactId: "1", name: "Ana", phone: "+55", hasAvatar: false, awaitingSince: new Date(Date.now() - 50_000).toISOString(), slaMinutes: 1,
    lastMessage: "oi", lastKind: "text", lastDirection: "in", lastAt: null, stageKey: "lead", stageName: "Lead", sourceLabel: "", ownerName: null, signals: [], tags: [],
  }];
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items }]} /></HoursProvider>);
  expect(container.querySelector("[data-status]")!.hasAttribute("data-atrasado")).toBe(false);
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(container.querySelector("[data-status]")!.hasAttribute("data-atrasado")).toBe(true);
});

it("mostra quem respondeu na prévia ('Cati:'); o cartão fino não tem dona nem 'respondida por'", () => {
  const items: QueueItem[] = [{
    dealId: "1", contactId: "1", name: "Ana", phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: 5,
    lastMessage: "*CATI - CASA FIAES:*\nConfirmado!", lastKind: "text", lastDirection: "out", lastAt: null, stageKey: "atendimento", stageName: "Atendimento",
    sourceLabel: "", ownerName: "Sara Lima", ownerShort: "Sara", lastAuthorName: "Cati", repliedByName: "Cati", signals: [], tags: [],
  }];
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando-cliente", items }]} /></HoursProvider>);
  expect(container.textContent).toContain("Cati: Confirmado!");
  expect(container.textContent).not.toContain("Você:");
  expect(container.textContent).not.toContain("CASA FIAES");
  expect(container.querySelector("[data-dona]")).toBeNull();
  expect(container.querySelector("[data-respondida]")).toBeNull();
});

const base: QueueItem = { dealId: "x", contactId: "x", name: "Ana", phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: 15, lastMessage: "oi", lastKind: "text",
  lastDirection: "out", lastAt: null, stageKey: "atendimento", stageName: "Atendimento", sourceLabel: "Não identificada", ownerName: null, signals: [], tags: [] };

it("cartão fino (pedido do dono, 16/10): sem origem, sinais (Interesse/Pediu preço), selos, etiquetas, dona, 'passou para' nem prazo escrito", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T17:30:00Z"));
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "atrasados", items: [
    { ...base, sourceLabel: "Instagram", badges: ["Novo"], signals: ["Pediu preço", "Interesse: Escova"], tags: ["Uso de imagem"], transferNote: "Cati te passou esta conversa",
      ownerName: "Sara Lima", ownerShort: "Sara", repliedByName: "Cati", alert: true, awaitingSince: new Date(Date.now() - 27 * 60_000).toISOString(), lastDirection: "in" },
  ] }]} /></HoursProvider>);
  const row = container.querySelector("[role=option]")!;
  for (const t of ["Instagram", "Novo", "Pediu preço", "Interesse", "Uso de imagem", "te passou", "Sara", "respondida", "Passou", "Responda em"]) expect(row.textContent).not.toContain(t);
  expect(row.querySelectorAll("[data-signal], [data-badge], [data-tag], [data-dona], [data-sem-dono], [data-prazo]")).toHaveLength(0);
  expect(row.className).toContain("min-h-16");
});

it("linha 3: duas pílulas, a etapa (cor da etapa) e o status (Aberto / Aguardando / Resolvido), e o traço da borda na cor do status", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T17:30:00Z"));
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items: [
    { ...base, dealId: "a", stageName: "Em conversa", awaitingSince: new Date(Date.now() - 60_000).toISOString(), lastDirection: "in" },
    { ...base, dealId: "b", stageName: "Agendado", awaitingSince: null },
    { ...base, dealId: "c", stageName: "Atendida", resolved: true },
    { ...base, dealId: "d", stageName: "Em conversa", alert: true, awaitingSince: new Date(Date.now() - 40 * 60_000).toISOString(), lastDirection: "in" },
  ] }]} /></HoursProvider>);
  const rows = [...container.querySelectorAll("[role=option]")];
  expect(rows.map((r) => [r.querySelector("[data-etapa]")!.textContent, r.querySelector("[data-status]")!.textContent])).toEqual([
    ["Em conversa", "Aberto"], ["Agendado", "Aguardando"], ["Atendida", "Resolvido"], ["Em conversa", "Atrasado"],
  ]);
  const cor = (r: Element) => (r.querySelector("[data-traco]") as HTMLElement).style.backgroundColor;
  expect(new Set(rows.slice(0, 3).map(cor)).size).toBe(3);
  expect(rows[3].querySelector("[data-status]")!.hasAttribute("data-atrasado")).toBe(true);
  expect(cor(rows[3])).toBe("rgb(179, 38, 30)"); // vermelho só no atraso
});

it("nome em MAIÚSCULAS aparece em Título; à direita a hora da última mensagem (não outro contador)", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T12:40:00Z")); // 09:40 em Salvador
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items: [
    { ...base, dealId: "a", name: "CARLA GOMES DOS HENRIQUES", lastDirection: "in", lastAt: "2026-10-15T12:31:00Z", awaitingSince: "2026-10-15T12:31:00Z" },
    { ...base, dealId: "b", name: "Marília", lastDirection: "in", lastAt: "2026-10-14T20:00:00Z", awaitingSince: "2026-10-15T12:35:00Z" },
    { ...base, dealId: "c", name: "Nicollas", lastDirection: "in", lastAt: "2026-10-10T20:00:00Z", awaitingSince: "2026-10-15T12:36:00Z" },
  ] }]} /></HoursProvider>);
  const [a, b, c] = [...container.querySelectorAll("[role=option]")];
  expect(a.querySelector("[data-nome]")!.textContent).toBe("Carla Gomes dos Henriques");
  expect(a.querySelector("[data-hora]")!.textContent).toBe("09:31");
  expect(b.querySelector("[data-hora]")!.textContent).toBe("ontem");
  expect(c.querySelector("[data-hora]")!.textContent).toBe("10/10");
  expect(a.textContent).not.toMatch(/\d+ min \d+ s|\b\d+ s\b/); // o relógio de espera saiu da linha
});

it("conversa aberta: fundo dourado suave, sem anel grosso", () => {
  Element.prototype.scrollIntoView ??= () => {}; // jsdom não tem
  const { container } = render(<HoursProvider hours={HOURS}><QueueList selectedId="x" sections={[{ key: "aguardando", items: [base] }]} /></HoursProvider>);
  const row = container.querySelector("[role=option]")!;
  expect(row.getAttribute("aria-selected")).toBe("true");
  expect(row.className).toContain("bg-gold-soft");
  expect(row.className).not.toMatch(/ring-2/);
});

it("áudio na prévia: duração e começo da transcrição", () => {
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando-cliente", items: [
    { ...base, lastMessage: null, lastKind: "audio", lastDirection: "in", lastDurationSec: 42, lastTranscript: "Oi, queria marcar escova para sábado" },
  ] }]} /></HoursProvider>);
  expect(container.querySelector("[role=option]")!.textContent).toContain("Áudio (0:42): Oi, queria marcar escova para sábado");
});

it("mensagem que é só a assinatura não deixa a prévia vazia ('Cati: Mensagem')", () => {
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando-cliente", items: [
    { ...base, lastMessage: "*CATI - CASA FIAES:*", lastAuthorName: "Cati" },
  ] }]} /></HoursProvider>);
  expect(container.textContent).toContain("Cati: Mensagem");
});

it("a conversa aberta continua com a foto: a caixinha de seleção só aparece ao passar o mouse na foto, nunca pelo foco da linha aberta", () => {
  Element.prototype.scrollIntoView ??= () => {};
  const it1 = (id: string): QueueItem => ({ dealId: id, contactId: id, name: `C${id}`, phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: null,
    lastMessage: "oi", lastKind: "text", lastDirection: "in", lastAt: null, stageKey: "lead", stageName: "Lead", sourceLabel: "", ownerName: null, signals: [], tags: [] });
  const selection = { mode: false, selected: new Set<string>(), enter: () => {}, exit: () => {}, toggle: () => {}, clear: () => {} };
  const { container } = render(<HoursProvider hours={HOURS}><QueueList selectedId="1" selection={selection} sections={[{ key: "aguardando", items: [it1("1"), it1("2")] }]} /></HoursProvider>);
  const [open, other] = [...container.querySelectorAll('[data-testid="item-selecionar"]')];
  expect(open.className).toContain("group-hover/foto:opacity-100");
  expect(open.className).not.toContain("group-hover:opacity-100");
  expect(open.className).not.toContain("group-focus-visible:opacity-100");
  expect(other.className).toContain("group-focus-visible:opacity-100");
});
