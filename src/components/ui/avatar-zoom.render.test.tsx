// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AvatarZoom } from "./avatar-zoom";
afterEach(cleanup);

const open = () => fireEvent.click(screen.getByRole("button", { name: "Ver a foto de Paula Souza" }));
const gone = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

it("tocar na foto abre a foto ampliada (a mesma do WhatsApp, em tamanho grande)", () => {
  render(<AvatarZoom contactId="c1" hasAvatar name="Paula Souza" size={96} />);
  expect(screen.getByRole("button", { name: "Ver a foto de Paula Souza" }).querySelector("img")?.getAttribute("width")).toBe("96");
  open();
  const dlg = screen.getByRole("dialog", { name: "Foto de Paula Souza" });
  expect(dlg.querySelector("img")?.getAttribute("src")).toBe("/api/avatar/c1?full=1");
});

it("fecha com Esc", async () => {
  render(<AvatarZoom contactId="c1" hasAvatar name="Paula Souza" />);
  open();
  act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
  await gone();
});

it("fecha clicando fora da foto", async () => {
  render(<AvatarZoom contactId="c1" hasAvatar name="Paula Souza" />);
  open();
  fireEvent.click(screen.getByTestId("foto-fundo"));
  await gone();
});

it("fecha pelo botão Fechar", async () => {
  render(<AvatarZoom contactId="c1" hasAvatar name="Paula Souza" />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Fechar a foto" }));
  await gone();
});

it("sem foto: só as iniciais, sem botão de ampliar", () => {
  render(<AvatarZoom contactId="c1" hasAvatar={false} name="Paula Souza" />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("PS")).toBeTruthy();
});
