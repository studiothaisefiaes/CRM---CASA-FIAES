// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const toast = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { PhotoField } from "./photo-field";

afterEach(() => { cleanup(); toast.mockReset(); refresh.mockReset(); vi.unstubAllGlobals(); });
const file = (size: number) => new File([new Uint8Array(size)], "foto.jpg", { type: "image/jpeg" });

it("Enviar foto manda o arquivo e mostra a nova; Tirar foto abre a câmera da frente", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ photoVersion: "42" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<PhotoField professionalId="p1" name="Ana" color={null} photoUrl={null} />);
  expect(screen.getByLabelText("Tirar foto").getAttribute("capture")).toBe("user");
  await act(async () => { fireEvent.change(screen.getByLabelText("Enviar foto"), { target: { files: [file(10)] } }); });
  expect(fetchMock).toHaveBeenCalledWith("/api/profissionais/p1/foto", expect.objectContaining({ method: "POST" }));
  expect(toast).toHaveBeenCalledWith("Foto salva");
  expect(refresh).toHaveBeenCalled();
  expect(document.querySelector("img")?.getAttribute("src")).toBe("/api/profissionais/p1/foto?v=42&tam=grande");
});

it("acima de 5 MB avisa sem enviar; erro do servidor aparece como veio", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "Use uma foto JPG, PNG ou WEBP." }), { status: 400 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<PhotoField professionalId="p1" name="Ana" color={null} photoUrl={null} />);
  await act(async () => { fireEvent.change(screen.getByLabelText("Enviar foto"), { target: { files: [file(5 * 1024 * 1024 + 1)] } }); });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("A foto passa de 5 MB. Escolha uma menor.", "error");
  await act(async () => { fireEvent.change(screen.getByLabelText("Enviar foto"), { target: { files: [file(10)] } }); });
  expect(toast).toHaveBeenLastCalledWith("Use uma foto JPG, PNG ou WEBP.", "error");
});
