// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
const emitirNota = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const cancelarNota = vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string });
const emitirNotaProduto = vi.fn(async (..._a: unknown[]) => ({ ok: true, data: { id: "p1", status: "autorizada" } }));
const cancelarNotaProduto = vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string });
const resolverNotaFora = vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean; error?: string });
vi.mock("@/app/(app)/caixa/actions", () => ({
  resolverNotaFora: (...a: unknown[]) => resolverNotaFora(...a),
  emitirNota: (...a: unknown[]) => emitirNota(...a), cancelarNota: (...a: unknown[]) => cancelarNota(...a),
  emitirNotaProduto: (...a: unknown[]) => emitirNotaProduto(...a), cancelarNotaProduto: (...a: unknown[]) => cancelarNotaProduto(...a),
}));
import type { NotaFiscalInfo } from "@/server/domain/fiscal/draft";
import { NotaFiscalBlock } from "./nota-fiscal-block";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const dados = { cpf: "11144477735", discriminacao: "Serviços de beleza: Corte.", valor: "121,50", valorCents: 12150, codigoServico: "060101" };

it("chave desligada: mostra 'Dados da nota (para o nfse.gov.br)' e os botões Copiar", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const info: NotaFiscalInfo = { modo: "desligada", dados, documento: null };
  render(<NotaFiscalBlock info={info} />);
  expect(screen.getByText("Dados da nota (para o nfse.gov.br)")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /^Copiar / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Copiar CPF", "Copiar Discriminação", "Copiar Valor", "Copiar Código do serviço"]);
  fireEvent.click(screen.getByRole("button", { name: "Copiar Discriminação" }));
  await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Copiado"));
  expect(writeText).toHaveBeenCalledWith("Serviços de beleza: Corte.");
  fireEvent.click(screen.getByRole("button", { name: "Copiar CPF" }));
  expect(writeText).toHaveBeenLastCalledWith("11144477735");
});
it("sem dados (rascunho desligado ou nada a declarar): não desenha nada", () => {
  const { container } = render(<NotaFiscalBlock info={{ modo: "desligada", dados: null, documento: null }} />);
  expect(container.textContent).toBe("");
});
it("chave em teste: mostra a situação da nota, sem 'Dados da nota'", () => {
  const { container } = render(<NotaFiscalBlock info={{ modo: "teste", dados: null, documento: { id: "d", environment: "teste", status: "rejeitada", number: 3, amountCents: 12150, rejectReason: "E160", accessKey: null, attempts: 1 } }} />);
  expect(container.textContent).toContain("Rejeitada");
  expect(container.textContent).toContain("E160");
  expect(container.textContent).not.toContain("Dados da nota");
});

const CHAVE = "29274082112223330001810000000000000000000000000042";
const doc = (status: string, o: Partial<NonNullable<NotaFiscalInfo["documento"]>> = {}) => ({ id: "d1", environment: "teste", status, number: 3, amountCents: 12150, rejectReason: null, accessKey: status === "autorizada" || status === "cancelada" ? CHAVE : null, attempts: 1, ...o });
const TUDO = { emitir: true, cancelar: true, ver: true };
const botoes = () => screen.queryAllByRole("button").map((b) => b.textContent);

it("sem nota: 'Emitir nota' só com nota.emitir; clicar chama a ação da comanda e recarrega", async () => {
  const onChanged = vi.fn();
  render(<NotaFiscalBlock comandaId="c1" onChanged={onChanged} info={{ modo: "teste", dados: null, documento: null, acoes: TUDO }} />);
  fireEvent.click(screen.getByRole("button", { name: "Emitir nota" }));
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(emitirNota).toHaveBeenCalledWith("c1");
  cleanup();
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: null, acoes: { emitir: false, cancelar: true, ver: true } }} />);
  expect(screen.queryByRole("button", { name: "Emitir nota" })).toBeNull();
});
it("comanda sem serviço (nada a declarar): sem 'Emitir nota' e com a frase", () => {
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: null, semServico: true, acoes: TUDO }} />);
  expect(screen.queryByRole("button", { name: "Emitir nota" })).toBeNull();
  expect(screen.getByText("Essa comanda não tem serviço para nota.")).toBeTruthy();
});
it("autorizada: Cancelar nota, Ver nota no nfse.gov.br (com a chave) e Baixar XML; sem 'Emitir de novo'", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: doc("autorizada"), acoes: TUDO }} />);
  expect(botoes()).toEqual(["Ver nota no nfse.gov.br", "Cancelar nota"]);
  expect(screen.getByRole("link", { name: "Baixar XML" }).getAttribute("href")).toBe("/api/notas-fiscais/d1?formato=xml");
  fireEvent.click(screen.getByRole("button", { name: "Ver nota no nfse.gov.br" }));
  expect(screen.getByText(`Abra a nota no nfse.gov.br com a chave ${CHAVE}.`)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copiar a chave" }));
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(CHAVE));
});
it("Cancelar nota: pede o motivo (15 letras) e só então chama a ação; o erro do servidor aparece", async () => {
  cancelarNota.mockResolvedValueOnce({ ok: false, error: "O governo não cancelou a nota: prazo encerrado (E1)" });
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: doc("autorizada"), acoes: TUDO }} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar nota" }));
  const confirmar = screen.getByRole("button", { name: "Cancelar a nota no governo" }) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText("Motivo do cancelamento da nota"), { target: { value: "curto" } });
  expect(confirmar.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Motivo do cancelamento da nota"), { target: { value: "Serviço lançado errado" } });
  expect(confirmar.disabled).toBe(false);
  fireEvent.click(confirmar);
  await vi.waitFor(() => expect(screen.getByText("O governo não cancelou a nota: prazo encerrado (E1)")).toBeTruthy());
  expect(cancelarNota).toHaveBeenCalledWith("d1", { reason: "Serviço lançado errado" });
});
it("sem nota.cancelar nem nota.ver: nada de Cancelar, PDF ou XML", () => {
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: doc("autorizada"), acoes: { emitir: true, cancelar: false, ver: false } }} />);
  expect(botoes()).toEqual([]);
  expect(screen.queryByRole("link", { name: "Baixar XML" })).toBeNull();
});
it("'Emitir de novo' só para rejeitada e erro no envio; enviando não tem ação", () => {
  for (const st of ["rejeitada", "erro_envio"]) {
    render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: doc(st), acoes: TUDO }} />);
    expect(screen.getByRole("button", { name: "Emitir de novo" })).toBeTruthy();
    cleanup();
  }
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: doc("pendente"), acoes: TUDO }} />);
  expect(botoes()).toEqual([]);
  expect(screen.queryByRole("button", { name: "Emitir de novo" })).toBeNull();
});

it("chave desligada com nota já emitida: mostra a nota e deixa cancelar, sem emitir", () => {
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "desligada", dados, documento: doc("autorizada"), acoes: TUDO }} />);
  expect(screen.getByText(/Nota 3 · Autorizada/)).toBeTruthy();
  expect(botoes()).toContain("Cancelar nota");
  expect(screen.queryByRole("button", { name: /Emitir/ })).toBeNull();
  expect(screen.getByText("Dados da nota (para o nfse.gov.br)")).toBeTruthy();
});

it("parceira sem CNPJ: o aviso aparece com destaque (chave desligada, no rascunho, e ligada, sem nota)", () => {
  const aviso = "A parceira Bia está sem CNPJ: a cota-parte dela não entrou no texto. Cadastre o CNPJ em Configurações › Profissionais.";
  render(<NotaFiscalBlock info={{ modo: "desligada", dados, documento: null, avisos: [aviso] }} />);
  expect(within(screen.getByRole("region", { name: "Dados da nota" })).getByRole("alert").textContent).toBe(aviso);
  cleanup();
  render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: null, avisos: [aviso], acoes: TUDO }} />);
  expect(within(screen.getByRole("region", { name: "Nota fiscal" })).getByRole("alert").textContent).toBe(aviso);
});

describe("Resolver fora do CRM (I-2, só com nota.resolver)", () => {
  const COM = { ...TUDO, resolver: true };
  it("aparece para erro no envio, enviando já enviada e autorizada; não para rejeitada, pendente nunca enviada ou sem a permissão", () => {
    for (const d of [doc("erro_envio", { attempts: 10 }), doc("pendente", { attempts: 2 }), doc("autorizada", { attempts: 1 })]) {
      render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: d, acoes: COM }} />);
      expect(screen.getByRole("button", { name: "Resolver fora do CRM" })).toBeTruthy();
      cleanup();
    }
    for (const d of [doc("rejeitada", { attempts: 2 }), doc("pendente", { attempts: 0 })]) {
      render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: d, acoes: COM }} />);
      expect(screen.queryByRole("button", { name: "Resolver fora do CRM" })).toBeNull();
      cleanup();
    }
    render(<NotaFiscalBlock comandaId="c1" info={{ modo: "teste", dados: null, documento: doc("erro_envio", { attempts: 10 }), acoes: TUDO }} />);
    expect(screen.queryByRole("button", { name: "Resolver fora do CRM" })).toBeNull();
  });
  it("pede a escolha e o motivo (15 letras); a chave é opcional e só vale para 'saiu'; chama a ação e recarrega", async () => {
    const onChanged = vi.fn();
    render(<NotaFiscalBlock comandaId="c1" onChanged={onChanged} info={{ modo: "producao", dados: null, documento: doc("erro_envio", { attempts: 10 }), acoes: COM }} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolver fora do CRM" }));
    const confirmar = screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true); // sem escolha
    fireEvent.click(screen.getByLabelText("A nota saiu e foi resolvida fora do CRM (cancelada/estornada no portal ou na SEFAZ)"));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Cancelada no portal do nfse.gov.br" } });
    fireEvent.change(screen.getByLabelText("Chave de acesso (opcional)"), { target: { value: CHAVE } });
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(resolverNotaFora).toHaveBeenCalledWith("d1", { escolha: "saiu_resolvida", motivo: "Cancelada no portal do nfse.gov.br", chave: CHAVE });
    cleanup();
    resolverNotaFora.mockResolvedValueOnce({ ok: false, error: "Você não tem permissão para resolver nota fora do CRM." });
    render(<NotaFiscalBlock comandaId="c1" info={{ modo: "producao", dados: null, documento: doc("erro_envio", { attempts: 10 }), acoes: COM }} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolver fora do CRM" }));
    fireEvent.click(screen.getByLabelText("Conferi no portal: a nota NÃO saiu"));
    expect(screen.queryByLabelText("Chave de acesso (opcional)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Conferi no portal e não achei" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await vi.waitFor(() => expect(screen.getByText("Você não tem permissão para resolver nota fora do CRM.")).toBeTruthy());
    expect(resolverNotaFora).toHaveBeenLastCalledWith("d1", { escolha: "nao_saiu", motivo: "Conferi no portal e não achei", chave: null });
  });
  it("NFC-e autorizada fora do prazo: 'Resolver fora do CRM' na linha da NFC-e", () => {
    const nfce = { id: "e1", environment: "producao", status: "autorizada", number: 1, amountCents: 4590, rejectReason: null, accessKey: "2".repeat(44), consultaUrl: null, cancelarAte: new Date(Date.now() - 60_000).toISOString(), attempts: 1 };
    render(<NotaFiscalBlock comandaId="c1" info={{ modo: "desligada", dados: null, documento: null, nfce: { modo: "producao", documento: nfce }, acoes: COM }} />);
    const linha = screen.getByRole("region", { name: "Nota de produto (NFC-e)" });
    expect(within(linha).getByRole("button", { name: "Resolver fora do CRM" })).toBeTruthy();
  });
});

describe("Nota de produto (NFC-e), Task 13", () => {
  const QR = "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=29261011222333000181650010000000011123456786|2|2|1|ABC";
  const nfceDoc = (status: string, o: Partial<NonNullable<NonNullable<NotaFiscalInfo["nfce"]>["documento"]>> = {}) => ({
    id: "e1", environment: "teste", status, number: 1, amountCents: 4590, rejectReason: null, accessKey: status === "autorizada" || status === "cancelada" ? "29261011222333000181650010000000011123456786" : null,
    consultaUrl: status === "autorizada" || status === "cancelada" ? QR : null, cancelarAte: status === "autorizada" ? new Date(Date.now() + 10 * 60_000).toISOString() : null, attempts: 1, ...o,
  });
  const nfseVazia = { modo: "desligada" as const, dados: null, documento: null };

  it("sem NFC-e (chave desligada e nenhuma emitida): a linha não aparece", () => {
    const { container } = render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: undefined, acoes: TUDO }} />);
    expect(container.textContent).toBe("");
  });
  it("NFC-e ligada e sem nota: 'Nota de produto (NFC-e)' com 'Emitir NFC-e' (nota.emitir), mesmo com a NFS-e desligada", async () => {
    const onChanged = vi.fn();
    render(<NotaFiscalBlock comandaId="c1" onChanged={onChanged} info={{ ...nfseVazia, nfce: { modo: "teste", documento: null }, acoes: TUDO }} />);
    expect(screen.getByText("Nota de produto (NFC-e)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Emitir NFC-e" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(emitirNotaProduto).toHaveBeenCalledWith("c1");
    expect(emitirNota).not.toHaveBeenCalled();
    cleanup();
    render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: { modo: "teste", documento: null }, acoes: { emitir: false, cancelar: true, ver: true } }} />);
    expect(screen.queryByRole("button", { name: "Emitir NFC-e" })).toBeNull();
  });
  it("comanda sem produto: a frase, sem botão", () => {
    render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: { modo: "teste", documento: null, semProduto: true }, acoes: TUDO }} />);
    expect(screen.getByText("Essa comanda não tem produto para nota.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Emitir NFC-e" })).toBeNull();
  });
  it("autorizada: situação, 'Consultar pelo QR Code', Baixar XML e Cancelar NFC-e com o motivo", async () => {
    render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: { modo: "teste", documento: nfceDoc("autorizada") }, acoes: TUDO }} />);
    const linha = screen.getByRole("region", { name: "Nota de produto (NFC-e)" });
    expect(linha.textContent).toContain("NFC-e 1 · Autorizada");
    expect(screen.getByRole("link", { name: "Consultar pelo QR Code" }).getAttribute("href")).toBe(QR);
    expect(within(linha).getByRole("link", { name: "Baixar XML" }).getAttribute("href")).toBe("/api/notas-fiscais/e1?formato=xml");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar NFC-e" }));
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento da NFC-e"), { target: { value: "Produto lançado errado na comanda" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar a NFC-e na SEFAZ" }));
    await vi.waitFor(() => expect(cancelarNotaProduto).toHaveBeenCalledWith("e1", { reason: "Produto lançado errado na comanda" }));
    expect(cancelarNota).not.toHaveBeenCalled();
  });
  it("dentro do prazo mostra até quando; depois do prazo some o botão e aparece 'Prazo de cancelamento encerrado.'", () => {
    render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: { modo: "teste", documento: nfceDoc("autorizada") }, acoes: TUDO }} />);
    expect(screen.getByText(/^Dá para cancelar na SEFAZ até as \d{2}:\d{2}\.$/)).toBeTruthy();
    expect(screen.queryByText("Prazo de cancelamento encerrado.")).toBeNull();
    cleanup();
    render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: { modo: "teste", documento: nfceDoc("autorizada", { cancelarAte: new Date(Date.now() - 60_000).toISOString() }) }, acoes: TUDO }} />);
    expect(screen.queryByRole("button", { name: "Cancelar NFC-e" })).toBeNull();
    expect(screen.queryByText(/Dá para cancelar/)).toBeNull();
    expect(screen.getByText("Prazo de cancelamento encerrado.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Consultar pelo QR Code" })).toBeTruthy();
  });
  it("sem permissão de ver e de cancelar: só a situação", () => {
    render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: { modo: "teste", documento: nfceDoc("autorizada") }, acoes: { emitir: true, cancelar: false, ver: false } }} />);
    expect(screen.queryByRole("button", { name: "Cancelar NFC-e" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Consultar pelo QR Code" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Baixar XML" })).toBeNull();
  });
  it("rejeitada: mostra o motivo e 'Emitir NFC-e de novo'", () => {
    render(<NotaFiscalBlock comandaId="c1" info={{ ...nfseVazia, nfce: { modo: "teste", documento: nfceDoc("rejeitada", { rejectReason: "Informado NCM inexistente (cStat 778)" }) }, acoes: TUDO }} />);
    expect(screen.getByRole("region", { name: "Nota de produto (NFC-e)" }).textContent).toContain("Informado NCM inexistente (cStat 778)");
    expect(screen.getByRole("button", { name: "Emitir NFC-e de novo" })).toBeTruthy();
  });
});
