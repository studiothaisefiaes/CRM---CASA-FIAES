import { requirePerm } from "@/server/auth/session";
import { db } from "@/server/db";
import { getLembreteD1 } from "@/server/domain/client-link/settings";
import { getAfterVisit } from "@/server/domain/after-visit";
import { getVirada, horasValidadeTeste, testeRecente, viradaPreview } from "@/server/domain/virada";
import { ViradaSettings } from "@/components/config/virada";

export const metadata = { title: "Troca do ChatGuru para o CRM" };

/** Virada (Fase B, Task 10): só com `virada.fazer` (Gestão). `?alvo=depois` abre no Depois do atendimento. */
export default async function ViradaPage({ searchParams }: PageProps<"/config/virada">) {
  const user = await requirePerm("virada.fazer");
  const alvo = (await searchParams).alvo === "depois" ? "depois" : "lembrete";
  const now = new Date();
  const nome = user.name;
  const [lembrete, depois, vl, vd, horas, pl, pa, pp, tl, ta, tp] = await Promise.all([
    getLembreteD1(), getAfterVisit(), getVirada("lembrete"), getVirada("depois"), horasValidadeTeste(),
    viradaPreview("lembrete", { nome, now }), viradaPreview("depois", { nome, now, modo: "agradecimento" }), viradaPreview("depois", { nome, now, modo: "pesquisa" }),
    testeRecente(db, "lembrete", now), testeRecente(db, "depois", now, "agradecimento"), testeRecente(db, "depois", now, "pesquisa"),
  ]);
  return (
    <ViradaSettings alvo={alvo} horasTeste={horas} estado={{
      lembrete: { ligado: lembrete.enabled, marcados: vl?.marcados ?? [], previews: { lembrete: pl }, testeRecente: { lembrete: tl }, editarEm: "/config/automacoes?parte=lembrete" },
      depois: {
        ligado: depois.mode !== "desligado", marcados: vd?.marcados ?? [], previews: { agradecimento: pa, pesquisa: pp }, testeRecente: { agradecimento: ta, pesquisa: tp },
        editarEm: "/config/depois-atendimento", modo: depois.mode === "desligado" ? undefined : depois.mode,
      },
    }} />
  );
}
