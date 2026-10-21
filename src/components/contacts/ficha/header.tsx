import type { ReactNode } from "react";
import { originLabel } from "@/lib/origin-label";
import { Badge } from "@/components/ui/badge";
import { AvatarZoom } from "@/components/ui/avatar-zoom";
import { KIND_LABEL } from "@/lib/contact-kind";
import { TagsEditor } from "@/components/queue/tags-editor";
import { BackToClient, StartConversation } from "@/components/contacts/start-conversation";
import { FichaMoreMenu, type EditableData } from "./more-menu";
import { PeopleOnNumber } from "@/components/contacts/people-on-number";
import { GoToTab } from "./tabs";
import { IconPackage, IconPhone, IconWhatsApp } from "@/components/icons";
import { formatPhoneClient, isHiddenNumber, nameFallback } from "@/lib/phone-client";
import { formatBRL } from "@/lib/money";
import { brDay } from "@/lib/client-avec";
import { displayName } from "@/lib/client-rhythm";
import { formatCpf } from "@/lib/cpf";
import { imageUseLabel } from "@/lib/client-alert";
import { answerText, type StepQuestion } from "@/lib/ficha-view";
import type { AnswerValue } from "@/lib/fichas";
import type { ContactDetail } from "@/server/queries/contact";
import type { ClientSnapshot } from "@/server/queries/client-snapshot";

const OUTLINE = "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm font-medium text-ink hover:bg-paper-2 lg:min-h-10";

/** Avisos fixos do topo: os da equipe (alergias e cuidados, uma linha cada) e Dívida/Crédito do Avec (valor só com "ver valores"). */
export function fixedWarnings(alertNotes: string | null, f: ClientSnapshot["finance"], money: boolean): string[] {
  return [
    ...(alertNotes ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    ...(f.debtCount ? [money ? `Dívida lançada no Avec: ${formatBRL(f.debtCents ?? 0)} (última em ${brDay(f.lastDebtOn)})` : "Tem dívida lançada no Avec"] : []),
    ...(f.creditCount ? [money ? `Crédito Cliente lançado no Avec: ${formatBRL(f.creditCents ?? 0)}` : "Tem crédito lançado no Avec"] : []),
  ];
}

function Row({ k, children, campo }: { k: string; children: ReactNode; campo?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2" data-campo={campo}>
      <dt className="shrink-0 text-sm text-graphite">{k}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}
const empty = <span className="font-normal text-muted">—</span>;

/**
 * A coluna da esquerda da ficha (fixa no computador): foto, nome em Título, telefone, CPF, selo do pacote, ações (Continuar conversa,
 * Ligar, WhatsApp e o "⋯"), avisos fixos em destaque e etiquetas. Os dados da cliente vêm em `FichaData`.
 */
export function FichaSidebar({ data, snap, tags, tagOptions, money, canExport = false, canTeam = false, canMerge = false, seal, edit, className }: {
  data: ContactDetail; snap: ClientSnapshot; tags: { id: string; name: string }[]; tagOptions: string[]; money: boolean; canExport?: boolean;
  /** "É da equipe" (quem pode marcar "Não é cliente"). */ canTeam?: boolean;
  /** "Unir com…" (permissão contatos.unir e função Unir cadastros ligada). */ canMerge?: boolean;
  /** "Pacote: 3 de 4" (leva à aba Pacotes); null sem pacote em uso. */ seal: string | null; edit: EditableData; className?: string;
}) {
  const c = data.contact;
  const name = displayName(c.name) || nameFallback(c.phone);
  const dial = !isHiddenNumber(c.phone);
  const warnings = fixedWarnings(c.alertNotes, snap.finance, money);
  return (
    <aside aria-label="Cliente" className={`flex min-w-0 flex-col gap-4 ${className ?? ""}`}>
      <div className="flex min-w-0 items-center gap-3.5">
        <AvatarZoom contactId={c.id} hasAvatar={c.hasAvatar} name={name} size={80} className="shrink-0" />
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold leading-[1.15] tracking-[-0.015em] text-ink">{name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-graphite">
            {dial && <span className="tabular">{formatPhoneClient(c.phone)}</span>}
            {c.sharesPhoneWith && data.people && (
              <span data-campo="numero-de">número de {displayName(data.people.holderName) || "outra cliente"}{c.phoneRelation ? ` (ela é ${c.phoneRelation})` : ""}</span>
            )}
            {c.cpf && <span className="tabular">CPF {formatCpf(c.cpf)}</span>}
          </p>
        </div>
      </div>

      {(seal || c.kind !== "cliente") && (
        <div className="flex flex-wrap items-center gap-1.5">
          {seal && (
            <GoToTab tab="pacotes" money={money} label={`${seal}. Ver pacotes`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-paper px-3 text-sm font-semibold text-ink hover:bg-paper-2 lg:min-h-8">
              <IconPackage size={15} />{seal}
            </GoToTab>
          )}
          {/* Tipo do contato (17/10): Spam é o antigo "Não é cliente". */}
          {c.kind === "spam" && <Badge tone="alert">Spam</Badge>}
          {(c.kind === "equipe" || c.kind === "fornecedor") && <Badge tone="neutral">{KIND_LABEL[c.kind]}</Badge>}
        </div>
      )}

      {/* Um só bloco de ações (r68 #21): no celular o "⋯" fica na mesma linha do botão preto (nada solto embaixo); no computador o botão
          preto ocupa a linha e Ligar, WhatsApp e o "⋯" vêm logo abaixo. */}
      <div className="flex flex-wrap gap-2">
        {!c.ignored && <div className="min-w-0 flex-1 lg:basis-full"><StartConversation contactId={c.id} hasOpenLead={!!snap.conversation} className="w-full" /></div>}
        {c.ignored && <div className="min-w-0 flex-1 lg:basis-full"><BackToClient contactId={c.id} /></div>}
        {dial && <a href={`tel:${c.phone}`} className={`${OUTLINE} max-lg:hidden`}><IconPhone size={15} />Ligar</a>}
        {dial && <a href={`https://wa.me/${c.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className={`${OUTLINE} max-lg:hidden`}><IconWhatsApp size={15} />WhatsApp</a>}
        <FichaMoreMenu phone={dial ? c.phone : null} contactId={c.id} canExport={canExport} canTeam={canTeam} canMerge={canMerge} isTeam={c.isTeam} data={edit} />
      </div>

      {warnings.length > 0 && (
        <ul aria-label="Avisos fixos" className="flex flex-col gap-1.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 rounded-[var(--radius-control)] border border-alert/40 bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
              <span aria-hidden className="font-semibold">!</span>{w}
            </li>
          ))}
        </ul>
      )}

      <TagsEditor contactId={c.id} tags={tags} options={tagOptions} />

      {data.people && <PeopleOnNumber contactId={c.id} people={data.people.people} />}
    </aside>
  );
}

/** Os dados da cliente: no computador, embaixo da coluna da esquerda; no celular, depois das abas (o essencial vem primeiro). */
export function FichaData({ data, snap, birthday, preferred, showImageUse = false, campos, className }: {
  data: ContactDetail; snap: ClientSnapshot; birthday: string | null; preferred: { name: string | null; hint: string }; className?: string;
  /** Função "Uso de imagem" ligada: mostra a linha. */ showImageUse?: boolean;
  /** Campos da ficha (item 25b): só para quem vê as fichas, com a função ligada. Uma linha por campo. */ campos?: { label: string; kind: StepQuestion["kind"]; value: AnswerValue | null }[];
}) {
  const c = data.contact;
  return (
    <section aria-labelledby="h-dados" data-bloco="dados" className={`rounded-[var(--radius-card)] bg-paper-2 px-4 py-2 ${className ?? ""}`}>
      <h2 id="h-dados" className="pt-1.5 text-sm font-semibold text-graphite">Dados da cliente</h2>
      <dl className="divide-y divide-line">
        {c.nickname && <Row k="Gosta de ser chamada">{c.nickname}</Row>}
        <Row k="Aniversário">{birthday ?? empty}</Row>
        <Row k="E-mail">{c.email ? <span className="break-all">{c.email}</span> : empty}</Row>
        <Row k="Instagram">{c.instagram ? `@${c.instagram}` : empty}</Row>
        {c.phoneAlt && <Row k="Outro telefone"><span className="tabular">{c.phoneAlt}</span></Row>}
        <Row k="Como conheceu" campo="origem">{originLabel(snap.origin) ?? <span className="font-normal text-muted">Não identificada</span>}</Row>
        <Row k="Preferida" campo="preferida">{preferred.name ?? <span className="font-normal text-muted">Ainda não tem</span>}</Row>
        <Row k="Tipo de cabelo">{c.hairType ?? empty}</Row>
        {showImageUse && (
          <Row k="Uso de imagem" campo="uso-imagem">
            {c.imageUse ? imageUseLabel(c.imageUse, c.imageUseOn) : <span className="font-normal text-muted">{imageUseLabel(null, null)}</span>}
          </Row>
        )}
        {campos?.map((f, i) => <Row key={i} k={f.label} campo="campo-ficha">{f.value != null ? <span className="whitespace-pre-line">{answerText(f.value, f.kind)}</span> : empty}</Row>)}
      </dl>
      {preferred.name && <p className="pb-1.5 text-xs text-muted">{preferred.hint}</p>}
      {snap.avecProfessionalHint && <p className="pb-1.5 text-xs text-muted">No Avec está &quot;cliente de {displayName(snap.avecProfessionalHint)}&quot;: é a profissional, não a origem.</p>}
    </section>
  );
}
