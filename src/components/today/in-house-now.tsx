"use client";
import Link from "next/link";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconContacts } from "@/components/icons";
import { contactHref, leadHref } from "@/lib/lead-href";
import { displayName } from "@/lib/display-name";
import type { TodayInHouse } from "@/server/queries/today";
import { cn } from "@/lib/cn";
import { HojeBlock } from "./hoje-block";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "numeric", minute: "2-digit", timeZone: "America/Bahia" });

const PREVIA = 3;

/** Serviço e profissional vêm do Avec muitas vezes em MAIÚSCULAS: na tela, em Título (o mesmo helper do nome). */
const servico = (x: TodayInHouse) => (x.professional ? `${displayName(x.service)} · com ${displayName(x.professional)}` : displayName(x.service));

function Row({ x, small }: { x: TodayInHouse; small?: boolean }) {
  const name = displayName(x.name);
  const href = x.dealId ? leadHref(x.dealId) : x.contactId ? contactHref(x.contactId) : null;
  const size = small ? 32 : 36;
  const who = (
    <>
      <ContactAvatar contactId={x.contactId ?? ""} hasAvatar={!!x.contactId && x.hasAvatar} name={name} size={size} />
      <span className="min-w-0 break-words text-sm font-medium">{name}</span>
    </>
  );
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", small ? "px-3 py-1" : "py-2")}>
      {href
        ? <Link href={href} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 hover:text-gold-ink">{who}</Link>
        : <span className="flex min-h-11 min-w-0 flex-1 items-center gap-3">{who}</span>}
      <span className={cn("flex flex-col text-sm", small ? "w-full pl-11 -mt-2" : "sm:items-end")}>
        <span className="text-graphite">{servico(x)}</span>
        <span className="text-muted tabular">{x.started ? "em atendimento" : "chegou"} · desde {HORA.format(new Date(x.since))}</span>
      </span>
    </li>
  );
}

/**
 * "Na Casa agora" (pedido do dono, 15/10; bloco do Hoje desde 16/10): quem está no salão, com foto, nome, serviço, profissional e desde quando.
 * A prévia mostra 3; "Ver todos" abre o painel grande com todas. O nome abre a conversa (ou a ficha); quem não tem cadastro aparece sem link.
 * Ninguém na Casa: o bloco fica no lugar, apagado.
 */
export function InHouseNow({ items }: { items: TodayInHouse[] }) {
  const waiting = items.filter((x) => !x.started).length;
  return (
    <HojeBlock id="na-casa" title="Na Casa agora" icon={<IconContacts size={16} />} count={items.length}
      context={!items.length ? "Ninguém na Casa agora." : waiting ? `${waiting} esperando começar` : "Todas em atendimento"}
      hidden={Math.max(0, items.length - PREVIA)}
      panel={items.length > PREVIA ? <ul className="divide-y divide-line/70">{items.map((x) => <Row key={x.key} x={x} />)}</ul> : undefined}
      panelPhrase="Quem está no salão agora, com o serviço, a profissional e desde quando.">
      {items.length > 0 && <ul className="pb-1">{items.slice(0, PREVIA).map((x) => <Row key={x.key} x={x} small />)}</ul>}
    </HojeBlock>
  );
}
