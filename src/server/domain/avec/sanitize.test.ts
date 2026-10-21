import { describe, expect, it } from "vitest";
import formatos from "../../../../docs/avec-formatos.json";
import { forbiddenColumns, sanitizeTable } from "./sanitize";

describe("sanitize (Avec)", () => {
  it("tira CPF, RG, CEP, endereço completo e banco, e o Número só quando é do endereço", () => {
    const header = ["Data", "Número", "Cliente", "CPF", "RG", "CEP", "Endereço", "Número", "Complemento", "Bairro", "Cidade", "Estado", "E-mail", "Banco", "Agência", "Conta"];
    const row = ["01/10/2026", "123", "Rita", "000.000.000-00", "11", "40000-000", "Rua X", "45", "ap 1", "Centro", "Salvador", "BA", "r@x.com", "Itaú", "0001", "12345-6"];
    const out = sanitizeTable(header, [row]);
    expect(out.columns).toEqual(["Data", "Número", "Cliente", "E-mail"]);
    expect(out.rows).toEqual([["01/10/2026", "123", "Rita", "r@x.com"]]);
    expect(out.removed).toEqual(["CPF", "RG", "CEP", "Endereço", "Número", "Complemento", "Bairro", "Cidade", "Estado", "Banco", "Agência", "Conta"]);
  });
  it("variações de nome das colunas proibidas também saem (export novo do Avec)", () => {
    const header = ["Cliente", "CPF/CNPJ", "RG / Órgão", "Número de endereço", "Nº do endereço", "Logradouro", "UF", "Município", "Chave Pix", "Conta Corrente", "Nº da Conta", "Banco do Cliente", "Agência/Conta", "Telefone"];
    const out = sanitizeTable(header, [header.map((_, i) => String(i))]);
    expect(out.columns).toEqual(["Cliente", "Telefone"]);
    expect(out.rows).toEqual([["0", "13"]]);
  });
  it("não tira colunas parecidas que não são dado pessoal", () => {
    const header = ["Data", "Número Comanda", "Contato", "Comandas", "Situação", "Estado da Comanda", "Total", "Encontro"];
    expect(sanitizeTable(header, []).columns).toEqual(header);
  });
  it("Número de comanda (sem endereço ao lado) fica", () => {
    const out = sanitizeTable(["Data", "Número", "Cliente"], [["01/10/2026", "77", "Rita"]]);
    expect(out.columns).toEqual(["Data", "Número", "Cliente"]);
  });
  it("nenhum formato conhecido do Avec sai com coluna proibida", () => {
    const bad = /^(cpf|rg|cep|endereco|complemento|bairro|cidade|estado|banco|agencia|conta)$/;
    for (const [sig, f] of Object.entries(formatos as Record<string, { colunas: string[] }>)) {
      const { columns } = sanitizeTable(f.colunas, []);
      const norm = columns.map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
      expect(norm.filter((c) => bad.test(c)), sig).toEqual([]);
      const ix = f.colunas.map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).indexOf("endereco");
      if (ix >= 0 && f.colunas[ix + 1] === "Número") expect(forbiddenColumns(f.colunas)).toContain(ix + 1);
    }
  });
});
