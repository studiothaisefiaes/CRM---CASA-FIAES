// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/components/ui/contact-avatar", () => ({ ContactAvatar: () => null }));
import type { BoardCard } from "@/server/queries/board";
import { DealCard } from "./deal-card";

afterEach(cleanup);
const card = (origin: string) => ({
  id: "d1", contactId: "c1", hasAvatar: false, contactName: "Aline Prado", phone: "+5571990000003", origin, ownerId: null, ownerName: null,
  stageId: "s1", awaitingReplySince: null, stageEnteredAt: new Date().toISOString(), lastMessage: null, lastMessageKind: null, lastMessageAt: null, lastDirection: null,
  isClient: false, scheduledAt: null, valueCents: null, urgency: "ok", waitSeconds: 0, followupAttempt: 0, pkg: null,
}) as unknown as BoardCard;

it("a origem gravada como Retorno sugerido aparece como Hora de voltar no cartão (o valor no banco não muda)", () => {
  render(<DealCard card={card("Retorno sugerido")} slaMinutes={null} stageKind="retorno" filtersQs="" />);
  expect(screen.getByText("Hora de voltar")).toBeTruthy();
  expect(screen.queryByText(/Retorno sugerido/)).toBeNull();
});
