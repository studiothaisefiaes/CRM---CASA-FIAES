import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { ap, bahia, NOW, setupAgenda } from "../../../test/agenda-fixtures";
import { permsFor } from "../../../test/perms";
import { agendaPendingSummary } from "./agenda-pending";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const recepcao = () => ({ id: s.cati.id, perms: permsFor("atendente") });

describe("agendaPendingSummary: as pendências da Agenda à vista no Hoje › Recepção (dono 24/10: fora do sino)", () => {
  it("sem desfecho da semana e lista de espera, com o link de cada aba da Agenda; só o que tem alguma coisa", async () => {
    await ap({ clientName: "Lia", startsAt: bahia(14, 10), professionalId: s.ana.id }); // ontem, ninguém deu baixa
    await ap({ clientName: "Rita", startsAt: bahia(15, 8), professionalId: s.ana.id }); // hoje 8h, já passou
    await ap({ clientName: "Mais tarde", startsAt: bahia(15, 14), professionalId: s.ana.id }); // ainda vai chegar
    await ap({ clientName: "Espera", startsAt: bahia(16, 0), status: "espera", origin: "crm" });
    expect(await agendaPendingSummary(recepcao(), NOW)).toEqual([
      { key: "semBaixa", label: "Sem desfecho", n: 2, href: "/agenda?aba=semBaixa" },
      { key: "espera", label: "Lista de espera", n: 1, href: "/agenda?aba=espera" },
    ]);
  });

  it("nada pendente: lista vazia", async () => {
    await ap({ clientName: "Veio", startsAt: bahia(15, 8), status: "compareceu", professionalId: s.ana.id });
    expect(await agendaPendingSummary(recepcao(), NOW)).toEqual([]);
  });
});
