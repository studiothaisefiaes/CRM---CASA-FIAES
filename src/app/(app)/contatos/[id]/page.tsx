import { formatPhoneClient, isHiddenNumber } from "@/lib/phone-client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { getContact } from "@/server/queries/contact";
import { getContactAvecData } from "@/server/queries/avec";
import { getClientSnapshot } from "@/server/queries/client-snapshot";
import { getContactVisits } from "@/server/queries/contact-visits";
import { listTags, tagsOf } from "@/server/domain/tags";
import { listProfessionals } from "@/server/domain/professionals";
import { getFuncoes } from "@/server/domain/funcoes";
import { getFichaView } from "@/server/queries/ficha-view";
import { getLoyaltyView } from "@/server/queries/loyalty-view";
import { LiveRefresh } from "@/components/shell/live";
import { ClientPackages, UpcomingAppointments } from "@/components/contacts/contact-avec";
import { ContactTimeline } from "@/components/contacts/contact-timeline";
import { isFuncaoOn } from "@/server/domain/funcoes";
import { FichaData, FichaSidebar } from "@/components/contacts/ficha/header";
import { FichaTabs } from "@/components/contacts/ficha/tabs";
import { ConversationBlock, FinanceBlock, LeadsBlock, NotesBlock, SituationBlock, SummaryGrid } from "@/components/contacts/ficha/blocks";
import { ConsentBlock } from "@/components/contacts/ficha/consent-block";
import { funcaoLigada } from "@/server/domain/funcoes";
import { VisitsBlock } from "@/components/contacts/ficha/visits";
import { ConsultoriaTab } from "@/components/contacts/ficha/consultoria";
import { IconArrowRight } from "@/components/icons";
import { buildTimeline } from "@/lib/contact-timeline";
import { bahiaDay, displayName } from "@/lib/client-rhythm";
import { birthdayLabel } from "@/lib/birthday";
import { fichaTabs, orderPackages, packageSeal, packageSessions } from "@/lib/ficha";
import { isUuid } from "@/lib/uuid";
import { NOT_IDENTIFIED } from "@/lib/source-kinds";

export const metadata = { title: "Ficha da cliente" };
const day = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });

/**
 * A ficha da cliente (refeita 16/10: "parecia tela de celular colada no computador"). No computador (a partir de 1100 px), duas colunas:
 * à esquerda, fixa, quem é a cliente (foto, nome, ações, avisos, etiquetas, dados); à direita, as abas Resumo · Horários · Pacotes · Consultoria
 * (só com fichas.ver) · Pagamentos (só com "ver valores") · Conversas · Notas. No celular, uma coluna só, com as abas roláveis.
 */
export default async function ContatoPage({ params }: PageProps<"/contatos/[id]">) {
  const user = await requirePerm("contatos.ver");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const money = can(user.perms, "valores.ver");
  const funcoes = await getFuncoes();
  // Respostas das fichas e fotos são dado da cliente: sem fichas.ver (ou com a função desligada) nem são lidas do banco.
  const fichasOn = funcoes.fichas && can(user.perms, "fichas.ver");
  const [data, avec, snap0, visits, tagMap, tagOptions, pros, ficha, fidelidade] = await Promise.all([
    getContact(id, { withValues: money }), getContactAvecData(id, { withValues: money }), getClientSnapshot(id, { money }),
    getContactVisits(id, { withValues: money }), tagsOf([id]), listTags(), listProfessionals(),
    fichasOn ? getFichaView(id, { photos: funcoes.fotos }) : Promise.resolve(null),
    funcoes.fidelidade ? getLoyaltyView(id, new Date()) : Promise.resolve(null),
  ]);
  const consentOn = await funcaoLigada("consentimento");
  if (!data || !snap0) notFound();
  const canAnswer = can(user.perms, "fichas.responder");
  // A visão por contato é refeita à noite e depois de cada importação do Avec: enquanto isso, valem a origem do primeiro lead
  // e o total das vendas fechadas no CRM (a mesma regra do painel da conversa: com venda no Avec, vale o Avec).
  const snap = {
    ...snap0,
    origin: snap0.origin ?? (data.origin === NOT_IDENTIFIED ? null : data.origin),
    stats: { ...snap0.stats, totalCents: money ? ((snap0.stats.totalCents ?? 0) > 0 ? snap0.stats.totalCents : data.values?.totalCents ?? 0) : null },
  };
  const now = data.asOf;
  const today = bahiaDay(now);
  const c = data.contact;
  const days = buildTimeline({
    now, messages: data.messages, events: data.events, lookup: data.lookup,
    deals: data.deals.map((x) => ({ id: x.id, createdAt: x.createdAt, stageName: x.stageName })),
  });

  const p = snap.preferred;
  const preferredName = p ? displayName(p.name) : null;
  const preferredHint = !p ? "Preferida: nenhuma ainda (menos de 3 serviços ou nenhuma profissional com 60% ou mais)."
    : p.source === "ficha" ? "Preferida escolhida aqui na ficha."
    : p.source === "calculada" ? `Preferida calculada: ${Math.round((p.share ?? 0) * 100)}% dos serviços com ${preferredName}.`
    : `Preferida anotada no Avec como "cliente de ${preferredName}".`;
  const birthday = birthdayLabel(c.birthDay, c.birthMonth, c.birthYear);
  const sessions = packageSessions(avec.pacotes, avec.historico);
  const { open: openPkgs } = orderPackages(avec.pacotes);
  const tabs = fichaTabs(money, !!ficha).map((t) => ({ ...t, count: t.value === "pacotes" ? openPkgs.length : t.value === "horarios" ? avec.proximos.length : undefined }));

  return (
    <main className="pb-12 min-[1100px]:pb-6">
      <LiveRefresh scopes={["queue"]} />
      <div className="mx-auto w-full max-w-[1480px] px-5 lg:px-8">
        <div className="pt-4 lg:pt-6">
          <Link href="/contatos" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-graphite hover:text-ink lg:min-h-0"><IconArrowRight size={14} className="rotate-180" />Clientes</Link>
        </div>
        {/* Celular: cliente, abas, dados. Computador: cliente e dados na coluna da esquerda, abas à direita. */}
        <div className="mt-3 flex flex-col gap-6 min-[1100px]:grid min-[1100px]:grid-cols-[340px_minmax(0,1fr)] min-[1100px]:grid-rows-[auto_1fr] min-[1100px]:items-start min-[1100px]:gap-x-8 min-[1100px]:gap-y-4">
          <FichaSidebar data={data} snap={snap} tags={tagMap.get(id) ?? []} tagOptions={tagOptions.map((t) => t.name)} money={money}
            canExport={can(user.perms, "relatorios.exportar")} canTeam={can(user.perms, "atendimento.fechar")} canMerge={can(user.perms, "contatos.unir") && (await isFuncaoOn("unir"))}
            seal={packageSeal(avec.pacotes)} className="min-[1100px]:col-start-1 min-[1100px]:row-start-1"
            edit={{
              name: c.name ?? "", nickname: c.nickname ?? "", email: c.email ?? "", instagram: c.instagram ? `@${c.instagram}` : "", phone: c.phone.startsWith("+") ? formatPhoneClient(c.phone) : "", phoneHidden: isHiddenNumber(c.phone), phoneAlt: c.phoneAlt ?? "",
              birthday: birthday ?? "", hairType: c.hairType ?? "", cpf: c.cpf ?? null,
              preferredId: c.preferredProfessionalId ?? "", preferredHint, preferredAuto: p && p.source !== "ficha" ? `Automática (${preferredName})` : "Automática",
              professionals: pros.map((x) => ({ id: x.id, name: displayName(x.name) ?? x.name })),
              imageUse: c.imageUse ?? "", imageUseOn: c.imageUseOn ?? "",
              imageUseMode: !funcoes.uso_imagem ? "off" : can(user.perms, "contatos.uso_imagem") ? "edit" : "read",
              campos: ficha && canAnswer ? ficha.campos.fill : undefined,
            }} />
          <div className="flex min-w-0 flex-col gap-4 min-[1100px]:col-start-2 min-[1100px]:row-span-2 min-[1100px]:row-start-1">
            <SituationBlock situation={snap.situation} />
            <FichaTabs money={money} tabs={tabs} panels={{
              resumo: (
                <div className="flex flex-col gap-4">
                  <SummaryGrid contactId={id} snap={snap} avec={avec} now={now} today={today} money={money} canSchedule={!c.ignored} consultoria={ficha?.summary} fidelidade={fidelidade ?? undefined} />
                  {consentOn && <ConsentBlock contactId={id} value={{ whatsapp: c.consentWhatsapp, ai: c.consentAi, cpfNota: c.consentCpfNota }} canEdit={can(user.perms, "cliente.consentimento")} />}
                </div>
              ),
              horarios: (
                <div className="grid gap-4 2xl:grid-cols-2 2xl:items-start">
                  <div data-bloco="proximos"><UpcomingAppointments items={avec.proximos} now={now} /></div>
                  <VisitsBlock days={visits} money={money} />
                </div>
              ),
              pacotes: <div data-bloco="pacotes"><ClientPackages items={avec.pacotes} sessions={sessions} today={today} money={money} /></div>,
              ...(ficha ? {
                consultoria: (
                  <ConsultoriaTab contactId={id} anamnese={ficha.anamnese} visits={ficha.visits} newVisitId={ficha.newVisitId} photos={ficha.photos} maxMb={ficha.photoMaxMb}
                    can={{ answer: canAnswer, addPhoto: can(user.perms, "fotos.adicionar"), removePhoto: can(user.perms, "fotos.apagar") }} />
                ),
              } : {}),
              ...(money ? { pagamentos: <FinanceBlock snap={snap} payments={avec.pagamentos} /> } : {}),
              conversas: (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] 2xl:items-start">
                  <ConversationBlock data={data} now={now}>
                    <ContactTimeline days={days} messageTotal={data.messageTotal} messageShown={data.messages.length} eventsTruncated={data.eventsTruncated} />
                  </ConversationBlock>
                  <LeadsBlock deals={data.deals} day={day} />
                </div>
              ),
              notas: <NotesBlock contactId={id} notes={c.notes} alertNotes={c.alertNotes} />,
            }} />
          </div>
          <FichaData data={data} snap={snap} birthday={birthday} preferred={{ name: preferredName, hint: preferredHint }} showImageUse={funcoes.uso_imagem} campos={ficha?.campos.items} className="min-[1100px]:col-start-1 min-[1100px]:row-start-2" />
        </div>
      </div>
    </main>
  );
}
