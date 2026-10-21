import { describe, expect, it } from "vitest";
import formatos from "../../../../docs/avec-formatos.json";
import { detectFormat, signatureOf, type AvecRole } from "./formats";

const F = formatos as Record<string, { colunas: string[] }>;
const roles = (sig: string) => detectFormat(F[sig].colunas).roles;

describe("formatos do Avec", () => {
  it("a assinatura é a mesma do catálogo (md5 dos cabeçalhos com |)", () => {
    for (const [sig, f] of Object.entries(F)) expect(signatureOf(f.colunas)).toBe(sig);
  });

  it("cada formato da especificação vai para o destino certo", () => {
    const expected: [string[], AvecRole][] = [
      [["dc841e71", "7737c39e", "4cad067e", "fb0490d0", "4c9ce320", "0d541ef1", "fb8e34ba", "9bec623d", "5d0fefc2", "ae14ff16", "cc013749", "862b213d", "9897d129", "63d414a7", "f18900ac", "e8aa4978", "fbd442b2", "0c96c703"], "contatos"],
      [["f18900ac", "1903eedc", "e51ff131"], "agendamentos"],
      [["e8aa4978"], "cancelamentos"],
      // QA r58 (gap Avec, A1): fbd442b2 é o 0248 "Agendamentos por status" com o filtro "Agendado", não lista de espera (o Avec não tem).
      [["fbd442b2"], "sem_baixa"],
      [["61a7a9b6"], "bloqueios"],
      [["e7894755"], "pacotes"],
      [["40ca3312", "10599ac5"], "usos_pacote"],
      [["63d414a7"], "itens"],
      [["d1e9f12d"], "pagamentos"],
      [["cdc646d8", "1b77f624"], "profissionais"],
      [["f7b4435f", "b507142e"], "servicos"],
    ];
    for (const [sigs, role] of expected) for (const s of sigs) expect(roles(s), `${s} → ${role}`).toContain(role);
  });

  it("fichas: 0115/2115 e 0116 (Campo, Slug, Valor) vão para as fichas; outros relatórios não", () => {
    expect(roles("0b4f0953")).toEqual(["fichas"]);
    expect(roles("522e78d2")).toEqual(["fichas"]);
    for (const [sig, f] of Object.entries(F)) if (!["0b4f0953", "522e78d2"].includes(sig)) expect(detectFormat(f.colunas).roles, sig).not.toContain("fichas");
  });

  it("o 0248 (Agendamentos por status › Agendado) não é mais lista de espera", () => {
    expect(roles("fbd442b2")).not.toContain("espera" as AvecRole);
    expect(detectFormat(F.fbd442b2.colunas).title).toBe("Agendados sem desfecho no Avec");
  });

  it("cliente excluída no Avec não volta como contato (o relatório fica guardado, mas não cria ninguém)", () => {
    expect(roles("4cc2d3b0")).toEqual([]);
  });

  it("vendas só do relatório completo de itens de comanda; serviços só do cadastro com preço (dados reais: os outros duplicavam)", () => {
    // o Avec repete as mesmas vendas em vários relatórios, cada um escrevendo o item de um jeito ("X", "X - 3474…", "X - null")
    for (const s of ["e5b22c06", "f06dac67", "8ffa26d4", "6f695f67", "56cf76ed", "85fbddc5", "b7376899", "0c96c703"]) expect(roles(s), s).not.toContain("itens");
    // "Serviços: comissão e tempo" (413 mil linhas) e faturamento/valor médio não são o catálogo
    for (const s of ["fbf8d8d4", "5d3b6c5d", "e637232f"]) expect(roles(s), s).not.toContain("servicos");
  });

  it("profissionais não viram contato; definição de pacotes e relatórios de pagamento não viram itens", () => {
    expect(roles("cdc646d8")).toEqual(["profissionais"]);
    expect(roles("1b77f624")).toEqual(["profissionais"]);
    expect(roles("e98b5a6c")).toEqual([]);
    expect(roles("fec3819b")).not.toContain("itens");
    expect(roles("d1e9f12d")).not.toContain("itens");
  });

  it("todo formato do catálogo tem título em português; os principais com nome certo", () => {
    for (const f of Object.values(F)) expect(detectFormat(f.colunas).title.length).toBeGreaterThan(3);
    expect(detectFormat(F.f18900ac.colunas).title).toBe("Reservas");
    expect(detectFormat(F["63d414a7"].colunas).title).toBe("Itens de comanda");
    expect(detectFormat(F.d1e9f12d.colunas).title).toBe("Pagamentos de comanda");
    const generic = Object.values(F).filter((f) => detectFormat(f.colunas).title.startsWith("Relatório:"));
    expect(generic.length).toBeLessThan(10);
  });

  it("reconhece pelo conjunto de cabeçalhos: outra ordem e coluna a mais continuam valendo", () => {
    const h = ["Hora", "Cliente", "Data Reserva", "Serviço", "Status", "Coluna Nova"];
    expect(detectFormat(h).roles).toEqual(["agendamentos"]);
    expect(detectFormat(h).title).toBe("Reservas");
  });
});

describe("Posição de Estoque (0149, Task 7)", () => {
  const H0149 = ["Produto", "Categoria", "Custo", "Valor", "Custo Médio Ponderado", "Medida", "Qtd. Estoque", "Qtd. Estoque Absoluto", "Marca", "Linha", "NCM", "Cód. Barras", "Cód. Interno", "Local de estoque", "Custo Total", "Preço Venda Total"];
  it("reconhece o cabeçalho do 0149 como produtos", () => {
    expect(detectFormat(H0149).roles).toEqual(["produtos"]);
  });
  it("não reconhece o 0043 (Código Interno, sem NCM) nem outros relatórios de estoque", () => {
    for (const sig of ["a328342d", "a11266b7", "b2da8a31", "c306bec9", "2903b510"]) expect(roles(sig), sig).not.toContain("produtos");
  });
});
