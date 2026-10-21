// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const empresaSalva = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const modo = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const regrasSalvas = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const modoNfce = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/(app)/config/nota-fiscal/actions", () => ({
  salvarFiscalEmpresa: (...a: unknown[]) => empresaSalva(...a), mudarNfseModo: (...a: unknown[]) => modo(...a), salvarFiscalRegras: (...a: unknown[]) => regrasSalvas(...a),
  mudarNfceModo: (...a: unknown[]) => modoNfce(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { DEFAULT_FISCAL_EMPRESA, DEFAULT_FISCAL_REGRAS } from "@/lib/fiscal-settings";
import { FiscalSettingsForm } from "./fiscal-settings";

beforeEach(() => { empresaSalva.mockClear(); modo.mockClear(); regrasSalvas.mockClear(); modoNfce.mockClear(); });
afterEach(cleanup);
const show = (missing: string[] = ["CNPJ da Casa"]) => render(<FiscalSettingsForm empresa={DEFAULT_FISCAL_EMPRESA} regras={DEFAULT_FISCAL_REGRAS} nfse="desligada" nfce="desligada" missing={missing} />);

it("a pergunta, os quatro blocos, as frases da chave e o que falta", () => {
  show();
  expect(screen.getByRole("heading", { name: "Como a Casa emite nota fiscal?" })).toBeTruthy();
  for (const t of ["Situação", "Dados da Casa", "Padrão dos serviços", "Regras e textos"]) expect(screen.getByRole("heading", { name: t })).toBeTruthy();
  expect(screen.getByText("Desligada: a Casa emite à mão no nfse.gov.br.")).toBeTruthy();
  expect(screen.getByText("Teste: emite no ambiente de teste do governo (sem valor fiscal).")).toBeTruthy();
  expect(screen.getByText("Produção: emite de verdade.")).toBeTruthy();
  expect(screen.getAllByText("CNPJ da Casa").some((el) => el.tagName === "LI")).toBe(true);
  expect(within(screen.getByRole("radiogroup", { name: "Chave da nota de serviço (NFS-e)" })).getByRole("radio", { name: "Desligada" }).getAttribute("aria-checked")).toBe("true");
  expect(within(screen.getByRole("radiogroup", { name: "Chave da nota do produto (NFC-e)" })).getByRole("radio", { name: "Desligada" }).getAttribute("aria-checked")).toBe("true");
});

it("mudar a chave chama a ação com o estado escolhido", async () => {
  show();
  await act(async () => { fireEvent.click(within(screen.getByRole("radiogroup", { name: "Chave da nota de serviço (NFS-e)" })).getByRole("radio", { name: "Teste" })); });
  expect(modo).toHaveBeenCalledWith("teste");
  expect(modoNfce).not.toHaveBeenCalled();
});

it("a chave da NFC-e agora se troca na tela (nota.configurar no servidor) e mostra o que falta para ela", async () => {
  render(<FiscalSettingsForm empresa={DEFAULT_FISCAL_EMPRESA} regras={DEFAULT_FISCAL_REGRAS} nfse="teste" nfce="desligada" missing={[]} missingNfce={["Inscrição estadual", "CSC da SEFAZ-BA no servidor"]} />);
  expect(screen.queryByText(/Ainda não dá para ligar por aqui/)).toBeNull();
  const nfce = screen.getByRole("region", { name: "Nota do produto (NFC-e)" });
  expect(within(nfce).getByText("Inscrição estadual").tagName).toBe("LI");
  expect(within(nfce).getByText("CSC da SEFAZ-BA no servidor").tagName).toBe("LI");
  await act(async () => { fireEvent.click(within(screen.getByRole("radiogroup", { name: "Chave da nota do produto (NFC-e)" })).getByRole("radio", { name: "Teste" })); });
  expect(modoNfce).toHaveBeenCalledWith("teste");
  expect(modo).not.toHaveBeenCalled();
});

it("dados da Casa: CNPJ com máscara, alíquota em % vira pontos-base; endereço pela metade é recusado na tela", async () => {
  show();
  fireEvent.change(screen.getByLabelText("CNPJ da Casa"), { target: { value: "11222333000181" } });
  fireEvent.change(screen.getByLabelText("Alíquota do Simples (%)"), { target: { value: "6,5" } });
  fireEvent.change(screen.getByLabelText("Rua"), { target: { value: "Rua A" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar dados da Casa" })); });
  expect(empresaSalva).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Preencha o endereço inteiro");
  fireEvent.change(screen.getByLabelText("Rua"), { target: { value: "" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar dados da Casa" })); });
  expect(empresaSalva).toHaveBeenCalledWith(expect.objectContaining({ cnpj: "11.222.333/0001-81", aliquotaSimplesBp: 650, cTribNacPadrao: "060101", nbsPadrao: null, endereco: null }));
});

it("padrão dos serviços: alíquota do ISS em % vira pontos-base; fora de 2% a 5% é recusada na tela", async () => {
  show();
  const iss = screen.getByLabelText("Alíquota do ISS (só se “Informar a alíquota na nota” estiver ligado)");
  fireEvent.change(iss, { target: { value: "7" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar padrão dos serviços" })); });
  expect(empresaSalva).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe("A alíquota do ISS fica entre 2% e 5%.");
  fireEvent.change(iss, { target: { value: "2,5" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar padrão dos serviços" })); });
  expect(empresaSalva).toHaveBeenCalledWith(expect.objectContaining({ aliquotaIssBp: 250 }));
});

it("regras e textos: dois campos com o aviso de não confirmado, texto sugerido restaura, salva só com mudança", async () => {
  show();
  expect(screen.getAllByText("Valor não confirmado no manual oficial: confira com o contador e no teste da Produção Restrita.")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Salvar regras e textos" })).toBeNull(); // r68 #10: sem mudança, sem botão cinza
  const txt = screen.getByLabelText("Texto dos serviços") as HTMLTextAreaElement;
  fireEvent.change(txt, { target: { value: "Outro: {servicos}" } });
  expect((screen.getByRole("button", { name: "Salvar regras e textos" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido: Texto dos serviços" }));
  expect(txt.value).toBe(DEFAULT_FISCAL_REGRAS.textos.servicos);
  fireEvent.change(screen.getByLabelText("Assinatura da NFS-e"), { target: { value: "sha256" } });
  fireEvent.click(screen.getByRole("switch", { name: "Informar a alíquota na nota" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar regras e textos" })); });
  expect(regrasSalvas).toHaveBeenCalledWith({ ...DEFAULT_FISCAL_REGRAS, assinaturaNfse: "sha256", informarAliquotaNaDps: true });
});
