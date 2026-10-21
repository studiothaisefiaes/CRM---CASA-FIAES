// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DealDetail } from "@/server/queries/deal";
import { ContextStrip } from "./context-strip";

afterEach(cleanup);

const d = {
  deal: { id: "d-1" }, contact: { id: "c-1" }, messages: [],
  context: {
    firstContactAt: "2020-03-10T15:00:00.000Z", isFirstContact: false, lastVisit: { at: "2026-09-25T15:00:00.000Z", service: null, by: null }, visits: 12,
    lastSales: [], totalCents: null, previousOwner: null, nextAppointment: null, activePackage: null,
    situation: "última visita há 20 dias · na hora de voltar (prevista 11/10)", short: "Na hora de voltar · última visita há 20 dias", states: ["na_hora_de_voltar"],
    retorno: { basis: "ritmo", everyDays: 25, dueOn: "2026-10-11", daysSince: 20, lateDays: 4, status: "na_hora" }, preferredProfessional: "MAIARA", alertNotes: null, knownSince: "2020-03-10T15:00:00.000Z",
  },
} as unknown as DealDetail;

it("a faixa usa a frase curta da situação; aberta, mostra a frase inteira, a preferida e o link para a ficha", () => {
  render(<ContextStrip d={d} />);
  expect(screen.getByRole("button", { name: /Na hora de voltar · última visita há 20 dias/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /ver mais/ }));
  expect(screen.getByText("última visita há 20 dias · na hora de voltar (prevista 11/10)")).toBeTruthy();
  expect(screen.getByText("Maiara")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Ver ficha completa" }).getAttribute("href")).toBe("/contatos/c-1");
});
