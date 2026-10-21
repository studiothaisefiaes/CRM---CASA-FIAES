// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClientAlertPopup } from "./client-alert-popup";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
beforeEach(() => { try { sessionStorage.clear(); } catch { /* sem armazenamento */ } });
afterEach(cleanup);

it("salta uma vez por visita: depois do Entendi, abrir de novo não salta", () => {
  const { unmount } = render(<ClientAlertPopup contactId="c1" scope="v1" alertNotes={"Alérgica a amônia"} imageUse="nao" />);
  expect(screen.getByRole("dialog", { name: "Aviso da cliente" })).toBeTruthy();
  expect(screen.getByText("Alérgica a amônia")).toBeTruthy();
  expect(screen.getByText("Não autorizou uso de imagem")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
  unmount();
  render(<ClientAlertPopup contactId="c1" scope="v1" alertNotes={"Alérgica a amônia"} imageUse="nao" />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("outra visita, ou texto novo, salta de novo", () => {
  const { unmount } = render(<ClientAlertPopup contactId="c1" scope="v1" alertNotes="A" imageUse={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
  unmount();
  const r2 = render(<ClientAlertPopup contactId="c1" scope="v2" alertNotes="A" imageUse={null} />);
  expect(screen.getByRole("dialog")).toBeTruthy();
  r2.unmount();
  render(<ClientAlertPopup contactId="c1" scope="v1" alertNotes="A mudou" imageUse={null} />);
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("sem aviso e sem 'não autorizou' não salta; desligado não salta; texto configurado aparece", () => {
  const { rerender } = render(<ClientAlertPopup contactId="c1" scope="v1" alertNotes={null} imageUse="sim" />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<ClientAlertPopup contactId="c1" scope="v1" alertNotes="Aviso" imageUse={null} enabled={false} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<ClientAlertPopup contactId="c1" scope="v1" alertNotes={null} imageUse="nao" noImageText="Sem foto, por favor" />);
  expect(screen.getByText("Sem foto, por favor")).toBeTruthy();
});
