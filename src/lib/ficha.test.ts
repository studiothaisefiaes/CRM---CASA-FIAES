import { describe, expect, it } from "vitest";
import { conversationFacts, fichaTabs, lastVisit, orderPackages, packageSessions, packageSeal } from "./ficha";

const pkg = (o: Partial<Parameters<typeof packageSessions>[0][number]> & { id: string }) => ({
  packageName: "Pacote 4 Hidratações", serviceLabel: "Hidratação", purchasedOn: "2026-08-01", validUntil: "2026-12-01",
  situation: "ativo" as const, usedSessions: 0, totalSessions: 4, ...o,
});
const item = (o: { id: string; soldOn: string; item: string; fromPackage?: boolean; professionalName?: string | null }) =>
  ({ fromPackage: true, professionalName: "THAISE", ...o });

describe("packageSessions: as sessões usadas de cada pacote (itens 'do pacote' das comandas)", () => {
  it("liga pelo serviço do pacote (sem acento/caixa), dentro da compra e da validade, mais novas primeiro", () => {
    const m = packageSessions([pkg({ id: "p1" })], [
      item({ id: "a", soldOn: "2026-09-10", item: "HIDRATACAO" }),
      item({ id: "b", soldOn: "2026-08-20", item: "Hidratação", professionalName: null }),
      item({ id: "c", soldOn: "2026-07-20", item: "Hidratação" }), // antes da compra
      item({ id: "d", soldOn: "2026-09-12", item: "Hidratação", fromPackage: false }), // pago à parte
      item({ id: "e", soldOn: "2026-09-12", item: "Escova" }), // outro serviço
    ]);
    expect(m.get("p1")).toEqual([
      { id: "a", day: "2026-09-10", service: "HIDRATACAO", professional: "Thaise" },
      { id: "b", day: "2026-08-20", service: "Hidratação", professional: null },
    ]);
  });

  it("cada sessão conta para um pacote só: o comprado mais perto antes dela", () => {
    const m = packageSessions([pkg({ id: "velho", purchasedOn: "2026-01-01" }), pkg({ id: "novo", purchasedOn: "2026-09-01" })], [
      item({ id: "x", soldOn: "2026-09-05", item: "Hidratação" }), item({ id: "y", soldOn: "2026-05-05", item: "Hidratação" }),
    ]);
    expect(m.get("novo")?.map((s) => s.id)).toEqual(["x"]);
    expect(m.get("velho")?.map((s) => s.id)).toEqual(["y"]);
  });

  it("sem serviço no pacote, liga pelo nome do pacote; nada combina = lista vazia", () => {
    const m = packageSessions([pkg({ id: "p", serviceLabel: null, packageName: "Botox capilar" }), pkg({ id: "q", serviceLabel: "Corte" })],
      [item({ id: "a", soldOn: "2026-09-01", item: "Botox Capilar" })]);
    expect(m.get("p")?.map((s) => s.id)).toEqual(["a"]);
    expect(m.get("q")).toEqual([]);
  });

  it("compra agrupada (uma linha por serviço no Avec): as sessões de qualquer serviço da compra contam para ela", () => {
    const m = packageSessions([pkg({ id: "combo", packageName: "Combo Manutenção Método Fiaes", serviceLabel: null,
      services: [{ label: "Finalização Método Fiaes" }, { label: "Sessão de Pacote Método" }] })], [
      item({ id: "a", soldOn: "2026-09-10", item: "FINALIZACAO METODO FIAES" }), item({ id: "b", soldOn: "2026-09-10", item: "Sessão de pacote metodo" }),
      item({ id: "c", soldOn: "2026-09-10", item: "Escova" }),
    ]);
    expect(m.get("combo")?.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("selo e ordem usam a compra: 'Pacote: X de Y' com as sessões da compra", () => {
    expect(packageSeal([pkg({ id: "combo", usedSessions: 3, totalSessions: 4, services: [{ label: "A" }, { label: "B" }] })])).toBe("Pacote: 3 de 4");
  });
});

describe("orderPackages", () => {
  it("ativos primeiro (na ordem que vieram), encerrados no fim", () => {
    const r = orderPackages([pkg({ id: "1", situation: "vencido" }), pkg({ id: "2" }), pkg({ id: "3", situation: "esgotado" }), pkg({ id: "4", situation: "acabando" })]);
    expect(r.open.map((p) => p.id)).toEqual(["2", "4"]);
    expect(r.closed.map((p) => p.id)).toEqual(["1", "3"]);
  });
});

describe("packageSeal: o selo do topo", () => {
  it("só com pacote em uso: 'Pacote: 3 de 4' (o primeiro em uso)", () => {
    expect(packageSeal([pkg({ id: "1", situation: "esgotado", usedSessions: 4 }), pkg({ id: "2", usedSessions: 3 })])).toBe("Pacote: 3 de 4");
    expect(packageSeal([pkg({ id: "1", situation: "vencido" })])).toBeNull();
    expect(packageSeal([])).toBeNull();
  });
});

describe("fichaTabs", () => {
  it("Pagamentos só para quem vê valores", () => {
    expect(fichaTabs(true).map((t) => t.label)).toEqual(["Resumo", "Horários", "Comandas", "Pacotes", "Pagamentos", "Conversas", "Notas"]);
    expect(fichaTabs(false).map((t) => t.value)).toEqual(["resumo", "horarios", "comandas", "pacotes", "conversas", "notas"]); // 22/10: Comandas para todas (sem valor sem valores.ver)
  });
});

describe("conversationFacts: a situação da conversa com os termos novos", () => {
  const base = { stageName: "Agendado", ownerName: "SARA LIMA", awaitingSince: null, late: false, closedConversation: false, nextAction: null };
  const NOW = Date.parse("2026-10-15T15:00:00Z");
  it("etapa, status (Aguardando), 'Com: Sara Lima' em Título, sem retomada", () => {
    expect(conversationFacts(base, NOW)).toEqual({ stage: "Agendado", status: "Aguardando", late: false, color: "#0a6166", with: "Com: Sara Lima", retomada: null });
  });
  it("esperando a Casa = Aberto (atrasado quando passou do prazo); sem ninguém; retomada com quando", () => {
    const f = conversationFacts({ ...base, ownerName: null, awaitingSince: "2026-10-15T14:00:00Z", late: true, nextAction: { title: "Mandar fotos", dueAt: "2026-10-15T13:00:00Z" } }, NOW);
    expect(f).toMatchObject({ status: "Atrasado", late: true, color: "#b3261e", with: "Com: ninguém ainda" });
    expect(f.retomada).toMatch(/^Mandar fotos · atrasada, /);
  });
  it("resolvida", () => {
    expect(conversationFacts({ ...base, closedConversation: true }, NOW).status).toBe("Resolvido");
  });
});

describe("lastVisit: a última visita pelas comandas", () => {
  it("o dia mais recente, os serviços (sem repetir) e as profissionais em Título", () => {
    expect(lastVisit([
      { soldOn: "2026-10-01", item: "Escova", kind: "servico", professionalName: "THAISE" },
      { soldOn: "2026-10-01", item: "Escova", kind: "servico", professionalName: "THAISE" },
      { soldOn: "2026-10-01", item: "Shampoo", kind: "produto", professionalName: null },
      { soldOn: "2026-09-01", item: "Corte", kind: "servico", professionalName: "MAIARA" },
    ])).toEqual({ day: "2026-10-01", services: ["Escova"], professionals: ["Thaise"] });
    expect(lastVisit([])).toBeNull();
  });
});
