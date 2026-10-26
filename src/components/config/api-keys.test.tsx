// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const criar = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { chave: "cf_EXEMPLOexemploEXEMPLOexemploEXEMPLOexemploEXE", prefixo: "cf_EXEMP" } }));
const revogar = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/config/api/actions", () => ({ createApiKeyAction: (...a: unknown[]) => criar(...a), revokeApiKeyAction: (...a: unknown[]) => revogar(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/config/api" }));
import { ApiKeys, type ChaveRow } from "./api-keys";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const EU = { id: "eu", nome: "Gestora" };
const PESSOAS = [EU, { id: "u1", nome: "Ana" }];
const CHAVES: ChaveRow[] = [
  { id: "k1", nome: "Planilha", prefixo: "cf_AbCdE", escopos: ["ler", "enviar"], pessoa: "Ana", criadaEm: "2026-10-20T12:00:00Z", ultimoUso: null, expiraEm: null, situacao: "ativa" },
  { id: "k2", nome: "Antiga", prefixo: "cf_ZyXwV", escopos: ["ler"], pessoa: "Ana", criadaEm: "2026-10-01T12:00:00Z", ultimoUso: null, expiraEm: null, situacao: "revogada" },
];

it("cria a chave e mostra o segredo uma vez; lista com o começo da chave e o que pode; revoga só a ativa, com confirmação", async () => {
  render(<ToastProvider><ApiKeys chaves={CHAVES} eu={EU} pessoas={PESSOAS} /></ToastProvider>);
  expect(screen.getByText("cf_AbCdE…")).toBeTruthy();
  // A Gestão: o padrão é ela mesma; pode escolher outra pessoa.
  expect((screen.getByLabelText("Em nome de") as HTMLSelectElement).value).toBe("eu");
  expect(screen.getByText("Revogada")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Revogar" })).toHaveLength(1);

  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Script" } });
  fireEvent.change(screen.getByLabelText("Em nome de"), { target: { value: "u1" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Escrever/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar chave" })); });
  expect(criar).toHaveBeenCalledWith({ nome: "Script", userId: "u1", escopos: ["ler", "escrever"], validade: null });
  expect(screen.getByTestId("chave-api").textContent).toBe("cf_EXEMPLOexemploEXEMPLOexemploEXEMPLOexemploEXE");
  expect(screen.getByText(/não aparece de novo/)).toBeTruthy();

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Já guardei" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Revogar" })); });
  const botoes = screen.getAllByRole("button", { name: "Revogar" });
  await act(async () => { fireEvent.click(botoes[botoes.length - 1]); });
  expect(revogar).toHaveBeenCalledWith("k1");
});

it("quem não é da Gestão: a chave é dela (sem escolher pessoa) e a tela diz que outra pessoa só pela Gestão", async () => {
  render(<ToastProvider><ApiKeys chaves={[]} eu={{ id: "ana", nome: "Ana" }} pessoas={null} /></ToastProvider>);
  expect(screen.queryByLabelText("Em nome de")).toBeNull();
  expect(screen.getByText("Você (Ana)")).toBeTruthy();
  expect(screen.getByText(/Só a Gestão cria chave em nome de outra pessoa/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Minha" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar chave" })); });
  expect(criar).toHaveBeenCalledWith({ nome: "Minha", userId: null, escopos: ["ler"], validade: null });
});
