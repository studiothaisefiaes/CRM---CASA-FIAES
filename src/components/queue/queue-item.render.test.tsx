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
    stageKey: "lead", stageName: "Lead", sourceLabel: "", ownerName: null, signals: [],
  }));
  render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items }]} /></HoursProvider>);
  const before = __itemRenderCount.value;
  expect(before).toBeGreaterThan(0); // o contador existe e contou a primeira pintura
  act(() => { vi.advanceTimersByTime(3000); });
  expect(__itemRenderCount.value - before).toBe(0);
});

it("o tempo na linha continua andando (a folha atualiza sozinha)", () => {
  vi.useFakeTimers();
  const items: QueueItem[] = [{
    dealId: "1", contactId: "1", name: "Ana", phone: "+55", hasAvatar: false, awaitingSince: new Date(Date.now() - 50_000).toISOString(), slaMinutes: 5,
    lastMessage: "oi", lastKind: "text", lastDirection: "in", lastAt: null, stageKey: "lead", stageName: "Lead", sourceLabel: "", ownerName: null, signals: [],
  }];
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items }]} /></HoursProvider>);
  const antes = container.textContent;
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(container.textContent).not.toBe(antes);
});
