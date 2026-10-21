// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { QueueItem } from "@/server/queries/queue";
import { HoursProvider } from "@/components/pipeline/timer";
import type { BusinessHours } from "@/lib/business-hours";
import { QueueList } from "./queue-list";

const allDay: [string, string] = ["00:00", "24:00"];
const HOURS: BusinessHours = { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay };
const item = (id: string): QueueItem => ({ dealId: id, contactId: id, name: `C${id}`, phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: 15,
  lastMessage: "oi", lastKind: "text", lastDirection: "in", lastAt: null, stageKey: "lead", stageName: "Lead", sourceLabel: "", ownerName: null, signals: [], tags: [] });
afterEach(() => cleanup());

it("a lista é uma só (desenho aprovado): sem cabeçalhos de seção nem 'Bola com a cliente' recolhida; a ordem é a do servidor (atrasadas primeiro)", () => {
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[
    { key: "atrasados", items: [item("1")] }, { key: "perto", n: 3, items: [item("2")] }, { key: "aguardando-cliente", items: [item("3"), item("4")] },
  ]} /></HoursProvider>);
  expect(container.querySelectorAll("[role=group]")).toHaveLength(0);
  expect(container.textContent).not.toMatch(/Bola com a cliente|Quase no prazo|responda primeiro/);
  const lb = container.querySelector("[role=listbox]")!;
  expect([...lb.querySelectorAll("[role=option]")].map((o) => o.getAttribute("data-deal-id"))).toEqual(["1", "2", "3", "4"]);
  expect(container.querySelectorAll("[role=listbox] button, [role=listbox] a:not([role=option])")).toHaveLength(0);
  expect(container.querySelectorAll("button")).toHaveLength(0);
});

it("tocar na etiqueta da etapa pede a troca de etapa ali mesmo (não abre a conversa)", () => {
  const taps: string[] = []; const opens: string[] = [];
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items: [{ ...item("1"), stageName: "Em conversa", stageColor: "#2f7d4f" }] }]}
    onOpen={(i) => opens.push(i.dealId)} onStageTap={(i) => taps.push(i.dealId)} /></HoursProvider>);
  const tag = container.querySelector("[data-etapa]")!;
  expect(tag.textContent).toBe("Em conversa");
  expect(tag.getAttribute("title")).toBe("Trocar a etapa");
  fireEvent.click(tag);
  expect(taps).toEqual(["1"]);
  expect(opens).toEqual([]);
});

it("bolinha verde com o número de não lidas e a hora em verde; a conversa aberta já conta como lida", () => {
  Element.prototype.scrollIntoView ??= () => {};
  const { container } = render(<HoursProvider hours={HOURS}><QueueList selectedId="2" sections={[{ key: "aguardando", items: [
    { ...item("1"), unread: 2, lastAt: new Date().toISOString() }, { ...item("2"), unread: 1, lastAt: new Date().toISOString() }, item("3"),
  ] }]} /></HoursProvider>);
  const [a, b, c] = [...container.querySelectorAll("[role=option]")];
  const dot = a.querySelector("[data-nao-lidas]")!;
  expect(dot.textContent).toBe("2");
  expect(dot.className).toContain("bg-ok");
  expect(a.getAttribute("aria-label")).toBeNull();
  expect(a.textContent).toContain("2 não lidas");
  expect(a.querySelector("[data-hora]")!.className).toContain("text-ok");
  expect(b.querySelector("[data-nao-lidas]")).toBeNull();
  expect(c.querySelector("[data-nao-lidas]")).toBeNull();
  expect(c.querySelector("[data-hora]")).toBeNull();
});

it("depois de aberta, a conversa não volta a mostrar a bolinha antes da lista atualizar; mensagem mais nova volta a contar", () => {
  Element.prototype.scrollIntoView ??= () => {};
  const t0 = "2026-10-15T12:00:00.000Z";
  const one = (extra: Partial<QueueItem>) => [{ key: "aguardando" as const, items: [{ ...item("9"), unread: 1, lastAt: t0, ...extra }, item("8")] }];
  const { container, rerender } = render(<HoursProvider hours={HOURS}><QueueList selectedId="9" sections={one({})} /></HoursProvider>);
  rerender(<HoursProvider hours={HOURS}><QueueList selectedId="8" sections={one({})} /></HoursProvider>);
  expect(container.querySelector('[data-deal-id="9"] [data-nao-lidas]')).toBeNull();
  rerender(<HoursProvider hours={HOURS}><QueueList selectedId="8" sections={one({ lastAt: "2026-10-15T12:05:00.000Z", unread: 2 })} /></HoursProvider>);
  expect(container.querySelector('[data-deal-id="9"] [data-nao-lidas]')!.textContent).toBe("2");
});

it("botão direito na linha abre o “Marcar como…” no ponto clicado, sem abrir a conversa", () => {
  const menus: { id: string; x: number; y: number }[] = []; const opens: string[] = [];
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items: [item("1")] }]}
    onOpen={(i) => opens.push(i.dealId)} onKindMenu={(i, at) => menus.push({ id: i.dealId, ...at })} /></HoursProvider>);
  const row = container.querySelector("[role=option]")!;
  const ev = fireEvent.contextMenu(row, { clientX: 120, clientY: 340 });
  expect(ev).toBe(false); // o menu do navegador não aparece
  expect(menus).toEqual([{ id: "1", x: 120, y: 340 }]);
  expect(opens).toEqual([]);
});

it("celular: toque longo abre o “Marcar como…”; o toque que solta não abre a conversa; arrastar (rolar) cancela", async () => {
  const menus: string[] = []; const opens: string[] = [];
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items: [item("1"), item("2")] }]}
    onOpen={(i) => opens.push(i.dealId)} onKindMenu={(i) => menus.push(i.dealId)} /></HoursProvider>);
  const [a, b] = [...container.querySelectorAll("[role=option]")];
  fireEvent.touchStart(a, { touches: [{ clientX: 10, clientY: 10 }] });
  await new Promise((r) => setTimeout(r, 650));
  fireEvent.touchEnd(a);
  fireEvent.click(a);
  expect(menus).toEqual(["1"]);
  expect(opens).toEqual([]);
  // rolar a lista não é toque longo
  fireEvent.touchStart(b, { touches: [{ clientX: 10, clientY: 10 }] });
  fireEvent.touchMove(b, { touches: [{ clientX: 10, clientY: 60 }] });
  await new Promise((r) => setTimeout(r, 650));
  expect(menus).toEqual(["1"]);
});
