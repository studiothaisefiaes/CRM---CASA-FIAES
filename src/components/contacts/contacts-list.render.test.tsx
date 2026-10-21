// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
vi.mock("./contacts-bulk-bar", () => ({ ContactsBulkBar: () => null }));
import { ContactsList } from "./contacts-list";
import type { ContactRow } from "@/server/queries/contacts";
afterEach(cleanup);

const row = (o: Partial<ContactRow> = {}): ContactRow => ({
  id: "c1", name: "THAMIRES SOUZA", phone: "+5571966000601", email: null, instagram: null, isClient: true, clientSince: null, lastServiceAt: null,
  ignored: false, hasAvatar: true, lastDealId: null, openDealId: null, openDealOwnerId: null, openDealOwnerName: null, deals: 1, snippet: null,
  visits: 3, lastVisitOn: null, nextAppointmentAt: null, nextProfessional: null, preferredProfessional: null, pkg: null, birthday: null, origin: null,
  situation: "", states: [], ...o,
});

it("lista de Clientes com a foto também na tabela (computador) e o nome em Título", () => {
  const { container } = render(<ContactsList rows={[row()]} term="" tagOptions={[]} canExport={false} />);
  const table = container.querySelector("table")!;
  expect(table.querySelector('img[src="/api/avatar/c1"]')).toBeTruthy();
  expect(table.textContent).toContain("Thamires Souza");
  expect(container.textContent).not.toContain("THAMIRES");
});

it("celular: o nome não é cortado com reticências (quebra a linha)", () => {
  const { container } = render(<ContactsList rows={[row({ name: "Thamires Souza Bastos Fictícia" })]} term="" tagOptions={[]} canExport={false} />);
  const name = [...container.querySelectorAll('ul[aria-label="Clientes"] span')].find((s) => s.textContent === "Thamires Souza Bastos Fictícia" && s.className.includes("font-medium"))!;
  expect(name.className).not.toContain("truncate");
});
