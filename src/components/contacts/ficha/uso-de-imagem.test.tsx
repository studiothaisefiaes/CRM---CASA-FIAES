// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const updateContactProfileAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { changed: [] as string[] } }));
vi.mock("@/app/(app)/contatos/actions", () => ({
  updateContactProfileAction: (...a: unknown[]) => updateContactProfileAction(...a), setCpfAction: vi.fn(),
}));
vi.mock("@/app/(app)/funil/actions", () => ({ setTeamContactAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/contatos/c1" }));
import { FichaMoreMenu, type EditableData } from "./more-menu";
import { FichaData } from "./header";
import { ToastProvider } from "@/components/ui/toast";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const EDIT: EditableData = {
  name: "Rita", nickname: "", email: "", instagram: "", phoneAlt: "", birthday: "", hairType: "", cpf: null,
  preferredId: "", preferredHint: "", preferredAuto: "Automática", professionals: [], imageUse: "sim", imageUseOn: "2026-03-12", imageUseMode: "edit",
};
const abre = (edit: EditableData) => {
  render(<ToastProvider><FichaMoreMenu contactId="c1" canExport={false} canTeam={false} isTeam={false} data={edit} /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Editar dados/ }));
};

it("Editar dados: com permissão, escolhe o uso de imagem e a data; salva só o campo mexido", async () => {
  abre(EDIT);
  expect((screen.getByLabelText("Autorizou desde") as HTMLInputElement).value).toBe("2026-03-12");
  await act(async () => { fireEvent.change(screen.getByLabelText("Uso de imagem"), { target: { value: "nao" } }); });
  expect(updateContactProfileAction).toHaveBeenCalledWith("c1", { imageUse: "nao" });
});
it("Editar dados: a data só salva ao sair do campo (digitar o ano não grava a cada tecla)", async () => {
  abre(EDIT);
  const d = screen.getByLabelText("Autorizou desde");
  fireEvent.change(d, { target: { value: "0002-03-12" } });
  fireEvent.change(d, { target: { value: "2026-03-12" } });
  expect(updateContactProfileAction).not.toHaveBeenCalled();
  fireEvent.change(d, { target: { value: "2026-03-10" } });
  await act(async () => { fireEvent.blur(d); });
  expect(updateContactProfileAction).toHaveBeenCalledTimes(1);
  expect(updateContactProfileAction).toHaveBeenCalledWith("c1", { imageUseOn: "2026-03-10" });
});
it("Editar dados: sem a permissão só lê; sem a função some", () => {
  abre({ ...EDIT, imageUseMode: "read" });
  expect(screen.queryByLabelText("Uso de imagem")).toBeNull();
  expect(screen.getByText(/Sim, desde 12\/03\/2026/)).toBeTruthy();
  cleanup();
  abre({ ...EDIT, imageUseMode: "off" });
  expect(screen.queryByText(/Uso de imagem/)).toBeNull();
  expect(screen.queryByLabelText("Uso de imagem")).toBeNull();
});
it("Dados da cliente: Sim, desde a data · Não · Não informado; some com a função desligada", () => {
  const snap = { origin: null, preferred: null, avecProfessionalHint: null } as never;
  const mk = (imageUse: "sim" | "nao" | null, imageUseOn: string | null, show = true) =>
    <FichaData data={{ contact: { nickname: null, email: null, instagram: null, phoneAlt: null, hairType: null, imageUse, imageUseOn } } as never} snap={snap} birthday={null} preferred={{ name: null, hint: "" }} showImageUse={show} />;
  const { container, rerender } = render(mk("sim", "2026-03-12"));
  expect(container.querySelector('[data-campo="uso-imagem"]')?.textContent).toBe("Uso de imagemSim, desde 12/03/2026");
  rerender(mk("nao", null));
  expect(container.querySelector('[data-campo="uso-imagem"]')?.textContent).toBe("Uso de imagemNão");
  rerender(mk(null, null));
  expect(container.querySelector('[data-campo="uso-imagem"]')?.textContent).toBe("Uso de imagemNão informado");
  rerender(mk("nao", null, false));
  expect(container.querySelector('[data-campo="uso-imagem"]')).toBeNull();
});
