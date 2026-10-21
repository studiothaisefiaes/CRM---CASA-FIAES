import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { saveAnswer, saveQuestion, setQuestionActive } from "../domain/fichas";
import { getFichaView } from "./ficha-view";

let u: string, c: string, ana: string, ana2: string, con: string, cam: string, v1: string, v2: string;
beforeEach(async () => {
  await resetDb();
  const s = await setupAgenda();
  u = s.gestora.id; c = (await cliente("Paula Souza")).contactId;
  ana = (await saveQuestion({ form: "anamnese", label: "Alergias?", kind: "texto" }, u)).id;
  ana2 = (await saveQuestion({ form: "anamnese", label: "Rotina", kind: "opcao", options: ["Corrida", "Calma"] }, u)).id;
  con = (await saveQuestion({ form: "consultoria", label: "Estilo", kind: "texto" }, u)).id;
  cam = (await saveQuestion({ form: "campos", label: "Apelido", kind: "texto" }, u)).id;
  v1 = (await db.insert(visits).values({ contactId: c, day: "2026-08-02" }).returning())[0].id;
  v2 = (await db.insert(visits).values({ contactId: c, day: "2026-10-20" }).returning())[0].id; // no futuro: "Nova" não usa
});

it("resumo da anamnese conta só as perguntas em uso; 'Nova' usa a visita de hoje ou a última passada", async () => {
  await saveAnswer({ contactId: c, questionId: ana, value: "Nenhuma" }, u);
  let v = await getFichaView(c, { photos: false, today: "2026-10-15" });
  expect(v.summary).toEqual({ answered: 1, total: 2, lastDay: null });
  expect(v.newVisitId).toBe(v1);
  expect(v.visits.map((x) => x.day)).toEqual(["2026-08-02"]); // a visita nova entra vazia
  expect(v.photos).toBeNull();
  await setQuestionActive(ana2, false, u);
  v = await getFichaView(c, { photos: true, today: "2026-10-15" });
  expect(v.summary).toMatchObject({ answered: 1, total: 1 });
  expect(v.photos).toEqual([]);
  v = await getFichaView(c, { photos: false, today: "2026-10-20" });
  expect(v.newVisitId).toBe(v2); // hoje tem visita
});

it("consultoria respondida entra na lista com a resposta e o dia; campos trazem o que ler e o que preencher", async () => {
  await saveAnswer({ contactId: c, questionId: con, visitId: v1, value: "Natural" }, u);
  await saveAnswer({ contactId: c, questionId: cam, value: "Pau" }, u);
  const v = await getFichaView(c, { photos: false, today: "2026-10-15" });
  expect(v.visits).toHaveLength(1);
  expect(v.visits[0]).toMatchObject({ visitId: v1, day: "2026-08-02", answered: [{ label: "Estilo", value: "Natural" }], fill: [{ id: con, value: "Natural" }] });
  expect(v.summary.lastDay).toBe("2026-08-02");
  expect(v.campos.items).toEqual([{ label: "Apelido", kind: "texto", value: "Pau" }]);
  expect(v.campos.fill).toMatchObject([{ id: cam, value: "Pau" }]);
});

it("cliente sem visita: Nova desligada (newVisitId nulo)", async () => {
  const d = (await cliente("Marina Lopes")).contactId;
  const v = await getFichaView(d, { photos: false, today: "2026-10-15" });
  expect(v.newVisitId).toBeNull();
  expect(v.visits).toEqual([]);
});
