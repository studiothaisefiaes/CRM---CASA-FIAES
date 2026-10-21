// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const saveFichaAnswerAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/contatos/actions", () => ({
  saveFichaAnswerAction: (...a: unknown[]) => saveFichaAnswerAction(...a), updateContactProfileAction: vi.fn(), setCpfAction: vi.fn(),
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
  preferredId: "", preferredHint: "", preferredAuto: "Automática", professionals: [], imageUseMode: "off",
  campos: [{ id: "k1", label: "Apelido do pet", kind: "texto", options: [], value: "Totó" }, { id: "k2", label: "Gosta de café", kind: "sim_nao", options: [], value: null }],
};
const abre = (edit: EditableData) => {
  render(<ToastProvider><FichaMoreMenu contactId="c1" canExport={false} canTeam={false} isTeam={false} data={edit} /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Mais ações" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Editar dados/ }));
};

it("Editar dados: os Campos da ficha salvam sozinhos ao sair do campo, só se mudaram", async () => {
  abre(EDIT);
  const input = screen.getByLabelText("Apelido do pet") as HTMLInputElement;
  expect(input.value).toBe("Totó");
  await act(async () => { fireEvent.blur(input); });
  expect(saveFichaAnswerAction).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Bolinha" } });
  await act(async () => { fireEvent.blur(input); });
  expect(saveFichaAnswerAction).toHaveBeenCalledWith({ contactId: "c1", questionId: "k1", value: "Bolinha" });
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Sim" })); });
  expect(saveFichaAnswerAction).toHaveBeenLastCalledWith({ contactId: "c1", questionId: "k2", value: "sim" });
});
it("Editar dados: sem a permissão de responder (ou sem a função) os campos não aparecem", () => {
  abre({ ...EDIT, campos: undefined });
  expect(screen.queryByText("Campos da ficha")).toBeNull();
  expect(screen.queryByLabelText("Apelido do pet")).toBeNull();
});
it("Dados da cliente: uma linha por campo (resposta, ou traço); sem a lista não mostra nada", () => {
  const snap = { origin: null, preferred: null, avecProfessionalHint: null } as never;
  const mk = (campos?: { label: string; kind: "texto" | "sim_nao" | "caixas"; value: string | string[] | null }[]) =>
    <FichaData data={{ contact: { nickname: null, email: null, instagram: null, phoneAlt: null, hairType: null, imageUse: null, imageUseOn: null } } as never} snap={snap} birthday={null} preferred={{ name: null, hint: "" }} campos={campos} />;
  const { container, rerender } = render(mk([{ label: "Apelido do pet", kind: "texto", value: "Totó" }, { label: "Gosta de café", kind: "sim_nao", value: "nao" }, { label: "Cores", kind: "caixas", value: ["Loiro", "Mel"] }, { label: "Marido", kind: "texto", value: null }]));
  const rows = [...container.querySelectorAll('[data-campo="campo-ficha"]')].map((r) => r.textContent);
  expect(rows).toEqual(["Apelido do petTotó", "Gosta de caféNão", "CoresLoiro, Mel", "Marido—"]);
  rerender(mk(undefined));
  expect(container.querySelector('[data-campo="campo-ficha"]')).toBeNull();
});
