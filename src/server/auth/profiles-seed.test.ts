import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { profiles, settings, users } from "../db/schema";
import { CONFIG_SPLIT_MARK, seed } from "../db/seed";
import { PERMS, SYSTEM_PROFILES } from "@/lib/permissions";
import { resetDb } from "../../../test/db";

const byKey = async (key: string) => (await db.select().from(profiles).where(eq(profiles.key, key)))[0];

describe("perfis de sistema no seed", () => {
  beforeEach(resetDb);

  it("existem os três, marcados como de sistema, com as permissões de SYSTEM_PROFILES", async () => {
    for (const p of SYSTEM_PROFILES) {
      const row = await byKey(p.key);
      expect(row?.isSystem).toBe(true);
      expect([...row!.permissions].sort()).toEqual([...p.permissions].sort());
    }
  });

  it("rodar o seed de novo não desfaz o que a gestão editou num perfil", async () => {
    await db.update(profiles).set({ permissions: ["atendimento.ver"] }).where(eq(profiles.key, "atendente"));
    await seed(db);
    expect((await byKey("atendente"))!.permissions).toEqual(["atendimento.ver"]);
  });

  it("o perfil Gestão volta a ter tudo, mesmo se alguém mexeu no banco (o rodízio de leads, opcional, fica como estava)", async () => {
    await db.update(profiles).set({ permissions: ["atendimento.ver"] }).where(eq(profiles.key, "gestao"));
    await seed(db);
    expect([...(await byKey("gestao"))!.permissions].sort()).toEqual(PERMS.filter((p) => !["distribuicao.receber", "mensagem.massa", "pro.app", "pro.ganhos"].includes(p)).sort()); // mensagem em massa (Lote 5) e app da profissional (Lote 7A): opcionais
    await db.update(profiles).set({ permissions: [...PERMS] }).where(eq(profiles.key, "gestao"));
    await seed(db);
    expect([...(await byKey("gestao"))!.permissions].sort()).toEqual([...PERMS].sort());
  });

  it("usuário criado só com o papel antigo (scripts, código antigo) ganha o perfil equivalente", async () => {
    const [g] = await db.insert(users).values({ name: "G", email: "g@x.local", role: "gestor" }).returning();
    const [a] = await db.insert(users).values({ name: "A", email: "a@x.local", role: "atendente" }).returning();
    expect(g.profileId).toBe((await byKey("gestao"))!.id);
    expect(a.profileId).toBe((await byKey("atendente"))!.id);
  });

  it("Lote 4: quem tinha config.editar fica com config.diaadia e config.sistema (o mesmo acesso), sem repetir", async () => {
    const [p] = await db.insert(profiles).values({ name: "Perfil antigo", permissions: ["atendimento.ver", "config.editar", "config.sistema"] }).returning();
    await seed(db);
    const [after] = await db.select().from(profiles).where(eq(profiles.id, p.id));
    expect([...after.permissions].sort()).toEqual(["atendimento.ver", "config.diaadia", "config.sistema"]);
  });

  it("Lote 4: Atendente e Recepção ganham o dia a dia uma vez só; se a gestão tirar, o próximo deploy não devolve", async () => {
    expect((await byKey("atendente"))!.permissions).toContain("config.diaadia");
    expect((await byKey("recepcao"))!.permissions).toContain("config.diaadia");
    await db.update(profiles).set({ permissions: ["atendimento.ver"] }).where(eq(profiles.key, "atendente"));
    await seed(db);
    expect((await byKey("atendente"))!.permissions).toEqual(["atendimento.ver"]);
  });

  it("Lote 4: banco de antes da troca (Atendente sem o dia a dia, sem a marca) ganha na primeira vez que o seed roda", async () => {
    await db.update(profiles).set({ permissions: ["atendimento.ver", "quadro.ver"] }).where(eq(profiles.key, "atendente"));
    await db.delete(settings).where(eq(settings.key, CONFIG_SPLIT_MARK));
    await seed(db);
    expect([...(await byKey("atendente"))!.permissions].sort()).toEqual(["atendimento.ver", "config.diaadia", "quadro.ver"]);
  });

  // Fase C (Regra do dono): a equipe ganha as permissões novas uma única vez; a Recepção ganha mais duas (os programas de fidelidade são só da Gestão).
  const EQUIPE_C = ["agenda.marcador", "agenda.repetir", "agenda.passar_dia", "fidelidade.resgatar", "contatos.uso_imagem", "fichas.ver", "fichas.responder", "fotos.adicionar", "fotos.apagar", "config.marcadores", "config.fichas", "config.aviso_cliente"];
  const RECEPCAO_C = ["servicos.por_profissional", "contatos.unir"];

  it("Lote 6A: perfil que já existia sem Marcar/Encaixar ganha uma única vez; se a gestão tirar, o seed não devolve", async () => {
    // Como estava em produção antes do 6A: Recepção sem as permissões da agenda e nenhuma concessão registrada.
    await db.update(profiles).set({ permissions: ["atendimento.ver", "quadro.ver"] }).where(eq(profiles.key, "recepcao"));
    await db.delete(settings).where(eq(settings.key, "perfis_permissoes_concedidas"));
    await seed(db);
    expect([...(await byKey("recepcao"))!.permissions].sort()).toEqual([...["agenda.encaixar", "agenda.marcar", "atendimento.pausar", "atendimento.setor", "atendimento.ver", "biblioteca.enviar", "biblioteca.gerir", "caixa.cancelar", "caixa.operar", "cliente.consentimento", "conversa.acompanhar", "conversa.nao_lida", "estoque.movimentar", "estoque.produtos", "mensagem.contato", "mensagem.editar", "mensagem.encaminhar", "mensagem.localizacao", "mensagem.reagir", "nota.emitir", "nota.ver", "quadro.ver", "servicos.editar"], ...EQUIPE_C, ...RECEPCAO_C].sort()); // caixa.operar (6C), servicos.editar (16/10) e as da Fase B (setor, pausar, consentimento, Biblioteca) e estoque.*/nota.* (Fase D): mesma concessão única
    const [given] = await db.select().from(settings).where(eq(settings.key, "perfis_permissoes_concedidas"));
    expect(given.value).toEqual(expect.arrayContaining(["atendente:agenda.marcar", "atendente:agenda.encaixar", "recepcao:agenda.marcar", "recepcao:agenda.encaixar", "atendente:caixa.operar", "recepcao:caixa.operar", "recepcao:servicos.editar", "recepcao:atendimento.pausar", "recepcao:cliente.consentimento", "recepcao:biblioteca.enviar", "recepcao:biblioteca.gerir"]));
    // A gestão tira o Encaixar da Recepção: o seed (deploy seguinte) não devolve.
    await db.update(profiles).set({ permissions: ["agenda.marcar", "atendimento.ver", "quadro.ver"] }).where(eq(profiles.key, "recepcao"));
    await seed(db);
    expect([...(await byKey("recepcao"))!.permissions].sort()).toEqual(["agenda.marcar", "atendimento.ver", "quadro.ver"]);
  });

  it("Lote 6A: a concessão vale por perfil e permissão (o que já foi dado a um não bloqueia o outro)", async () => {
    await db.update(profiles).set({ permissions: ["atendimento.ver"] }).where(eq(profiles.key, "atendente"));
    await db.insert(settings).values({ key: "perfis_permissoes_concedidas", value: ["recepcao:agenda.marcar", "recepcao:agenda.encaixar"] })
      .onConflictDoUpdate({ target: settings.key, set: { value: ["recepcao:agenda.marcar", "recepcao:agenda.encaixar"] } });
    await seed(db);
    expect([...(await byKey("atendente"))!.permissions].sort()).toEqual([...["agenda.encaixar", "agenda.marcar", "atendimento.pausar", "atendimento.setor", "atendimento.ver", "biblioteca.enviar", "caixa.cancelar", "caixa.operar", "cliente.consentimento", "conversa.acompanhar", "conversa.nao_lida", "mensagem.contato", "mensagem.editar", "mensagem.encaminhar", "mensagem.localizacao", "mensagem.reagir", "nota.emitir", "nota.ver"], ...EQUIPE_C].sort());
  });
});

describe("QA r66 (I-7): permissões novas", () => {
  beforeEach(resetDb);
  it("Gestão, Atendente e Recepção de sistema já nascem com editar clientes, trazer conversa e apagar para todos; Profissional não", async () => {
    await seed(db);
    for (const k of ["gestao", "atendente", "recepcao"]) {
      const p = (await db.select().from(profiles).where(eq(profiles.key, k)))[0];
      expect(p.permissions, k).toEqual(expect.arrayContaining(["contatos.editar", "contatos.importar", "mensagem.apagar_todos"]));
    }
    const pro = (await db.select().from(profiles).where(eq(profiles.key, "profissional")))[0];
    expect(pro.permissions).not.toContain("contatos.editar");
  });
});
