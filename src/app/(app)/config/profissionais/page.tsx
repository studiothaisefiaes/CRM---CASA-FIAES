import { requirePerm } from "@/server/auth/session";
import { listProfessionals, listProServiceTimes } from "@/server/domain/professionals";
import { getBusinessHours } from "@/server/domain/hours";
import { suggestProfessionalServices } from "@/server/domain/agenda/who-does-what";
import { listBookableServices } from "@/server/queries/agenda";
import { ProfessionalsEditor } from "@/components/config/professionals";
import { can } from "@/lib/permissions";
import { proAccessList } from "@/server/domain/pro/access";
import { getProAppSettings } from "@/server/domain/pro/settings";
import { ProAppSettingsCard } from "@/components/config/pro-app-settings";

export const metadata = { title: "Profissionais" };

/**
 * Profissionais (6.10): lista à esquerda e a ficha da escolhida (`?id=`) à direita; `?id=nova` abre "Adicionar profissional".
 * `?aba=matriz` abre a matriz Quem faz o quê (6A). Os serviços vêm de Listas › Serviços, com a categoria.
 */
export default async function ProfissionaisPage({ searchParams }: PageProps<"/config/profissionais">) {
  const user = await requirePerm("config.diaadia");
  const sp = await searchParams;
  const tab = sp.aba === "matriz" ? "matriz" : sp.aba === "tempos" ? "tempos" : "lista";
  const times = tab === "tempos" ? await listProServiceTimes() : [];
  const [items, services, casa, who] = await Promise.all([listProfessionals({ all: true }), listBookableServices(), getBusinessHours(), suggestProfessionalServices()]);
  // Lote 7A: "Acesso ao app" só para quem gere a equipe.
  const access = can(user.perms, "equipe.gerir") ? await proAccessList() : null;
  const proApp = await getProAppSettings();
  const id = typeof sp.id === "string" ? sp.id : null;
  const selectedId = id === "nova" || items.some((p) => p.id === id) ? id : null;
  return (
    <>
      <ProAppSettingsCard value={proApp} />
      <ProfessionalsEditor tab={tab} times={times} items={items} services={services} casa={casa} suggestions={who.suggestions} selectedId={selectedId} access={access} canPayout={can(user.perms, "comissao.pagar")} />
    </>
  );
}
