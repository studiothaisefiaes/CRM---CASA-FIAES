"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { ActionSheet, FieldError, SheetLabel } from "@/components/queue/action-sheet";
import { auxPreviewAction, createRecurringVisitsAction, createVisitAction, freeSlotsAction, rescheduleAction, resolveWaitlistAction } from "@/app/(app)/agenda/actions";
import type { FreeSlotsResult } from "@/server/domain/agenda/slots";
import type { CreateVisitInput } from "@/server/domain/agenda/visits";
import type { AuxPreview } from "@/server/domain/agenda/appointment-assistants";
import { DUPLA_NOTE } from "@/lib/agenda-text";
import { slotMs } from "@/lib/schedule";
import { firstName } from "@/lib/authorship";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { type Preference } from "@/lib/appointment-preference";
import { ClientPicker, type PickedClient } from "./client-picker";
import { MarkerFields, type MarkerLabel, type MarkerType } from "./marker-fields";
import { AuxiliariesField } from "./auxiliaries-field";
import type { VisitType } from "@/lib/visit-type";
import { REPETIR_MIN_VEZES, repeatResultText, type RepetirConfig } from "@/lib/repetir";

import type { AgendaMode } from "@/lib/agenda-settings";
/** `priceCents`: preço do catálogo, só para quem vê valores (vazio = não mostra). */
export type BookingService = { id: string; label: string; durationMin: number | null; priceCents?: number | null };
/**
 * `assistantOf`: assistente fixa de quem (as fixas da principal são sugeridas primeiro como auxiliares). `terms`: o preço e o tempo
 * próprios dela por serviço (0084, só com a função ligada; preço só para quem vê valores).
 */
export type BookingPro = { id: string; name: string; active: boolean; serviceIds: string[]; assistantOf?: string | null;
  terms?: Record<string, { durationMin: number | null; priceCents: number | null }> };
export type BookingInitial = {
  day: string; time: string; professionalId?: string | null; serviceId?: string | null;
  client?: { contactId: string; name: string } | null; dealId?: string | null; walkIn?: boolean; waitlistId?: string | null;
  /** Aberta pela coluna de uma profissional na Agenda: "Ela quer a …" já vem marcado (dá para trocar). */ preference?: Preference | null;
};
export type RescheduleTarget = { appointmentId: string; serviceId: string | null; serviceLabel: string; professionalId: string | null; durationMin: number | null; clientName: string; contactId: string | null;
  /** 6.11 */ preference?: Preference | null; professionalName?: string | null;
  /** 0089: as auxiliares do horário (vão junto; dá para trocar). */ assistantIds?: string[] };

type Item = { serviceId: string; professionalId: string; durationText: string; saveDuration: boolean; linkService: boolean; mode: "depois" | "junto"; preference: Preference | ""; prefManual: boolean; assistantIds: string[] };
/** Psico r68 #12: escolher a profissional já vale como "Ela quer a X"; "Qualquer uma" vale "Tanto faz". A atendente só mexe se for diferente. */
const autoPreference = (professionalId: string): Preference => (professionalId ? "escolhida" : "sem_preferencia");
const newItem = (serviceId = "", professionalId = "", preference: Preference | "" = "", assistantIds: string[] = []): Item => ({ serviceId, professionalId, durationText: "", saveDuration: false, linkService: false, mode: "depois", preference: preference || autoPreference(professionalId), prefManual: !!preference, assistantIds });
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
const SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Bahia" });
const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
const MAX_ITEMS = 4;
const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}` : names[0] ?? "");

/**
 * Marcar e Remarcar (6.1), em blocos (20/10): Cliente · Serviços (o serviço, quem atende, as auxiliares, a duração e o preço) · Quando
 * (dia e hora com os próximos livres e, na hora, "Livre" ou o conflito exato) · Mais opções, recolhidas (observação, marcador e tipo,
 * repetir). O rodapé resume antes do "Marcar": "Corte com Jackson + auxiliar Sidney · qui 22/10 14:00–15:00 · R$ 280". A prévia só
 * ajuda: quem decide é o servidor. "Encaixar mesmo assim" aparece só para quem tem `agenda.encaixar`. Nasce nova a cada abertura (a
 * request key é dela). "Repetir" (item 23a): a mesma visita a cada X semanas; o que não coube aparece na folha antes de fechar.
 */
export function BookingSheet({ open, onClose, services, professionals, initial, reschedule = null, canFitIn, canEditConfig, agendaMode, labels = [], visitTypes = [], repeat = null, perProTerms = false, comandaAssistantsMax = null, onDone }: {
  /** Marcador e tipo (opcionais): só os que a pessoa pode pôr; vazio = a linha some. */ labels?: MarkerLabel[]; visitTypes?: MarkerType[];
  /** Repetir: os limites da Casa, só com `agenda.repetir` e a função ligada; null = a chave some. */ repeat?: RepetirConfig | null;
  /** A função "Preço e tempo por profissional" está ligada: "Guardar como padrão" vai para a profissional. */ perProTerms?: boolean;
  /** Quantas assistentes a comanda aceita por serviço (caixa no CRM com o recurso ligado); null = não avisa. */ comandaAssistantsMax?: number | null;
  open: boolean; onClose: () => void; services: BookingService[]; professionals: BookingPro[]; initial: BookingInitial; reschedule?: RescheduleTarget | null;
  canFitIn: boolean; canEditConfig: boolean; agendaMode: AgendaMode;
  /** `confirm`: o texto de confirmação para a cliente ("Marcado: qua 21/10 às 15:00, Corte com a Bia."), só em marcação nova; quem usa decide se oferece na caixa de mensagem (nada é enviado). */
  onDone: (r: { day: string; message: string; confirm?: string }) => void;
}) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [client, setClient] = useState<PickedClient | null>(() =>
    initial.client ? { kind: "contato", contactId: initial.client.contactId, name: initial.client.name }
      : reschedule?.contactId ? { kind: "contato", contactId: reschedule.contactId, name: reschedule.clientName } : null);
  const [items, setItems] = useState<Item[]>(() => [newItem(reschedule?.serviceId ?? initial.serviceId ?? "", reschedule?.professionalId ?? initial.professionalId ?? "",
    !reschedule && initial.professionalId && initial.preference ? initial.preference : "", reschedule?.assistantIds ?? [])]);
  const [day, setDay] = useState(initial.day);
  const [time, setTime] = useState(initial.time);
  const [notes, setNotes] = useState("");
  const [labelId, setLabelId] = useState("");
  const [visitType, setVisitType] = useState<VisitType | "">("");
  const [fetched, setPreview] = useState<FreeSlotsResult | null>(null);
  const [auxFetched, setAuxPreview] = useState<{ key: string; list: AuxPreview[][] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; day: string } | null>(null);
  const [pending, start] = useTransition();
  const [confirmChange, setConfirmChange] = useState(false);
  const [fitOpen, setFitOpen] = useState(false);
  const [fitReason, setFitReason] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);
  const [everyWeeks, setEveryWeeks] = useState(1);
  const [times, setTimes] = useState(() => Math.min(4, repeat?.maxVezes ?? 4));
  const [repeatDone, setRepeatDone] = useState<{ text: string; short: string; day: string } | null>(null);
  const canRepeat = !!repeat && !reschedule && !initial.waitlistId && !initial.walkIn;

  const active = professionals.filter((p) => p.active);
  const svcOf = (id: string) => services.find((s) => s.id === id) ?? null;
  const proOf = (id: string) => professionals.find((p) => p.id === id) ?? null;
  const prosFor = (serviceId: string) => (serviceId ? active.filter((p) => p.serviceIds.includes(serviceId)) : active);
  const needsLink = (it: Item) => !!it.professionalId && !!it.serviceId && !active.find((p) => p.id === it.professionalId)?.serviceIds.includes(it.serviceId);
  /** O tempo padrão do serviço com quem atende: o próprio dela (0084), senão o do serviço; no Remarcar, o do horário enquanto for a mesma. */
  const defaultDuration = (it: Item, k: number): number | null => {
    if (reschedule && k === 0 && it.professionalId === (reschedule.professionalId ?? "") && reschedule.durationMin != null) return reschedule.durationMin;
    const own = it.professionalId ? proOf(it.professionalId)?.terms?.[it.serviceId]?.durationMin : null;
    return own ?? svcOf(it.serviceId)?.durationMin ?? null;
  };
  const priceOf = (it: Item): number | null => {
    const own = it.professionalId ? proOf(it.professionalId)?.terms?.[it.serviceId]?.priceCents : null;
    return own ?? svcOf(it.serviceId)?.priceCents ?? null;
  };
  /** A duração digitada, quando muda alguma coisa: vazia ou igual à padrão = null (o servidor usa a padrão). */
  const typed = (it: Item, k: number): number | null => {
    const n = Number(it.durationText) || null;
    return n != null && n !== defaultDuration(it, k) ? n : null;
  };
  const effectiveDuration = (it: Item, k: number) => typed(it, k) ?? defaultDuration(it, k);
  const first = items[0];
  const firstDuration = typed(first, 0);
  const clientId = client?.kind === "contato" ? client.contactId : null;
  const ms = slotMs(day, time);
  /** O início de cada serviço ("logo depois" no fim do anterior; "ao mesmo tempo", junto). null = sem hora ou sem duração antes. */
  const startsOf: (number | null)[] = [];
  items.forEach((it, k) => {
    if (k === 0) { startsOf.push(Number.isFinite(ms) ? ms : null); return; }
    const prev = startsOf[k - 1], d = effectiveDuration(items[k - 1], k - 1);
    startsOf.push(prev == null ? null : it.mode === "junto" ? prev : d == null ? null : prev + d * 60_000);
  });

  const setItem = (k: number, patch: Partial<Item>) => { setItems((l) => l.map((it, j) => (j === k ? { ...it, ...patch } : it))); setError(null); };
  const pickService = (k: number, serviceId: string) => {
    const pro = items[k].professionalId;
    const keep = !pro || !serviceId || canEditConfig || !!active.find((p) => p.id === pro)?.serviceIds.includes(serviceId);
    setItem(k, { serviceId, professionalId: keep ? pro : "", durationText: "", saveDuration: false, linkService: false });
  };
  const pickPro = (k: number, professionalId: string) => setItem(k, {
    professionalId, linkService: false, durationText: "", saveDuration: false, assistantIds: items[k].assistantIds.filter((id) => id !== professionalId),
    ...(items[k].prefManual && professionalId ? {} : { preference: autoPreference(professionalId) }),
  });

  // Prévia do servidor para o 1º serviço (livre, conflito, próximos livres); espera parar de digitar.
  const canPreview = open && !!first.serviceId && /^\d{4}-\d{2}-\d{2}$/.test(day);
  const preview = canPreview ? fetched : null;
  useEffect(() => {
    if (!canPreview) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await freeSlotsAction({ serviceId: first.serviceId, professionalId: first.professionalId || null, day, time: /^\d{2}:\d{2}$/.test(time) ? time : null,
        durationMin: firstDuration, clientId, ignoreAppointmentId: reschedule?.appointmentId ?? null, linkService: first.linkService });
      if (alive) setPreview(r.ok ? r.data ?? null : null);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [canPreview, first.serviceId, first.professionalId, first.linkService, day, time, firstDuration, clientId, reschedule?.appointmentId]);

  // A agenda das auxiliares no período de cada serviço (só ajuda: o Marcar confere de novo).
  const auxQuery = items.map((it, k) => ({ assistantIds: it.assistantIds, startsAt: startsOf[k], durationMin: effectiveDuration(it, k), serviceId: it.serviceId || null }));
  const auxKey = open ? JSON.stringify(auxQuery) : "";
  const wantsAux = open && auxQuery.some((q) => q.assistantIds.length && q.startsAt != null && q.durationMin);
  useEffect(() => {
    if (!wantsAux) return;
    let alive = true;
    const t = setTimeout(async () => {
      const list = await Promise.all((JSON.parse(auxKey) as typeof auxQuery).map(async (q) => {
        if (!q.assistantIds.length || q.startsAt == null || !q.durationMin) return [];
        const r = await auxPreviewAction({ assistantIds: q.assistantIds, startsAt: new Date(q.startsAt).toISOString(), durationMin: q.durationMin, serviceId: q.serviceId, ignoreAppointmentId: reschedule?.appointmentId ?? null });
        return r.ok ? r.data ?? [] : [];
      }));
      if (alive) setAuxPreview({ key: auxKey, list });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [wantsAux, auxKey, reschedule?.appointmentId]);
  const auxPreview = wantsAux && auxFetched?.key === auxKey ? auxFetched.list : [];

  const state = preview?.preview?.state;
  // A auxiliar ocupada (ou fora do horário dela) também pede "Encaixar mesmo assim" — ou tirar a auxiliar.
  const needsFit = state === "encaixe" || state === "fora_do_horario" || auxPreview.some((l) => l.some((x) => x.state === "encaixe" || x.state === "fora_do_horario"));
  const anyPro = !first.professionalId;

  // O resumo do rodapé: "Corte com Jackson + auxiliar Sidney · qui 22/10 14:00–15:00 · R$ 280".
  const summary = (() => {
    if (!items.some((it) => it.serviceId)) return null;
    const what = items.filter((it) => it.serviceId).map((it) => {
      const pro = it.professionalId ? proOf(it.professionalId)?.name : null;
      const aux = it.assistantIds.map((id) => firstName(proOf(id)?.name) ?? "auxiliar");
      return `${svcOf(it.serviceId)?.label ?? "Serviço"} com ${pro ? firstName(pro) ?? pro : "qualquer uma"}${aux.length ? ` + ${aux.length === 1 ? "auxiliar" : "auxiliares"} ${listNames(aux)}` : ""}`;
    }).join(", ");
    let when = "";
    if (Number.isFinite(ms)) {
      const ends = items.map((it, k) => { const s = startsOf[k], d = effectiveDuration(it, k); return s != null && d ? s + d * 60_000 : null; });
      const end = ends.every((e) => e != null) ? Math.max(...(ends as number[])) : null;
      when = `${SEMANA.format(new Date(ms)).replace(".", "")} ${DM.format(new Date(ms))} ${HORA.format(new Date(ms))}${end ? `–${HORA.format(new Date(end))}` : ""}`;
    }
    const prices = items.filter((it) => it.serviceId).map(priceOf);
    // O total só com todos os preços conhecidos (sem valores.ver, nenhum vem).
    const total = prices.length && prices.every((p) => p != null) ? money(prices.reduce<number>((a, p) => a + (p ?? 0), 0)) : null;
    return [what, when, total].filter(Boolean).join(" · ");
  })();

  const submit = (fitIn: boolean) => {
    setError(null); setExisting(null);
    if (fitIn && fitReason.trim().length < 3) { setError("Conte o motivo do encaixe."); return; }
    if (!Number.isFinite(ms)) { setError(time ? "Escolha o dia e a hora." : "Escolha a hora: toque num dos próximos livres ou digite."); return; }
    if (!client) { setError("Escolha a cliente."); return; }
    if (items.some((i) => !i.serviceId)) { setError("Escolha o serviço."); return; }
    if (!reschedule && items.some((i) => !i.preference)) { setError("Diga se ela quer uma profissional ou tanto faz."); return; }
    if (!reschedule && items.some((i) => i.preference === "escolhida" && !i.professionalId)) { setError("Escolha a profissional que ela pediu."); return; }
    const changesChosen = reschedule?.preference === "escolhida" && !!first.professionalId && first.professionalId !== reschedule.professionalId;
    if (changesChosen && !confirmChange) { setError(`Ela pediu a ${reschedule!.professionalName ?? "outra profissional"}. Marque "Trocar mesmo assim" para trocar.`); return; }
    if (items.some((i) => needsLink(i) && !i.linkService)) { setError("Essa profissional não faz esse serviço. Marque \"Ela faz esse serviço\" ou escolha outra."); return; }
    const startsAt = new Date(ms).toISOString();
    const when = `${DIA.format(new Date(ms)).replace(".", "")} às ${HORA.format(new Date(ms))}`;
    start(async () => {
      if (reschedule) {
        const auxChanged = first.assistantIds.join() !== (reschedule.assistantIds ?? []).join();
        const r = await rescheduleAction(reschedule.appointmentId, { startsAt, professionalId: first.professionalId || undefined, durationMin: firstDuration ?? undefined, fitIn, confirmProChange: changesChosen ? true : undefined,
          ...(auxChanged ? { assistantIds: first.assistantIds } : {}) });
        if (!r.ok) { setError(r.error); return; }
        onDone({ day: r.data!.day, message: `Remarcado: ${firstName(reschedule.clientName) ?? "cliente"}, ${when}` });
        return;
      }
      const booking: Omit<CreateVisitInput, "client"> = {
        requestKey, startsAt, dealId: initial.dealId ?? null, notes: [fitIn && fitReason.trim() ? `Encaixe: ${fitReason.trim()}` : "", notes.trim()].filter(Boolean).join("\n") || null, fitIn, walkIn: !!initial.walkIn, labelId: labelId || null, visitType: visitType || null,
        items: items.map((it, k) => ({ serviceId: it.serviceId, professionalId: it.professionalId || null, durationMin: typed(it, k), saveDuration: it.saveDuration, linkService: it.linkService, mode: k ? it.mode : undefined, preference: it.preference || null,
          ...(it.assistantIds.length ? { assistantIds: it.assistantIds } : {}) })),
      };
      const who = firstName(client.name) ?? "cliente";
      if (canRepeat && repeatOn) {
        const rr = await createRecurringVisitsAction({ ...booking, client: client.kind === "contato" ? { contactId: client.contactId } : { name: client.name, phone: client.phone }, repeat: { everyWeeks, times } });
        if (!rr.ok) { setError(rr.error); setExisting(rr.openAppointment ?? null); return; }
        const { created, skipped } = rr.data;
        if (!skipped.length) { onDone({ day, message: `${repeatResultText(created.length, []).replace(/\.$/, "")}: ${who}, ${everyWeeks === 1 ? "toda semana" : `a cada ${everyWeeks} semanas`}` }); return; }
        setRepeatDone({ text: repeatResultText(created.length, skipped), short: `${repeatResultText(created.length, [])} ${skipped.length} ${skipped.length === 1 ? "não coube" : "não couberam"}.`, day });
        return;
      }
      const r = initial.waitlistId
        ? await resolveWaitlistAction(initial.waitlistId, { result: "encaixada", booking })
        : await createVisitAction({ ...booking, client: client.kind === "contato" ? { contactId: client.contactId } : { name: client.name, phone: client.phone } });
      if (!r.ok) { setError(r.error); setExisting(r.openAppointment ?? null); return; }
      const what = items.map((it) => {
        const pro = active.find((p) => p.id === it.professionalId)?.name;
        return `${svcOf(it.serviceId)?.label ?? "Horário"}${pro ? ` com ${firstName(pro) ?? pro}` : ""}`;
      }).join(" e ");
      // Mãe e filha no mesmo número (21/10): marcado da conversa da mãe para a filha, a confirmação diz para quem é (a mensagem vai para o número das duas).
      const forOther = client.kind === "contato" && !!initial.client && client.contactId !== initial.client.contactId;
      onDone({ day, message: `Horário marcado: ${who}, ${when}`, confirm: `Marcado${forOther ? ` para ${who}` : ""}: ${when}, ${what}.` });
    });
  };

  const title = reschedule ? "Remarcar horário" : initial.waitlistId ? "Encaixar da lista de espera" : initial.walkIn ? "Encaixe agora" : "Marcar horário";
  const hasMore = !reschedule;
  const moreFilled = [notes.trim() && "Observação", labelId && "Marcador", visitType && "Tipo", repeatOn && "Repetir"].filter(Boolean) as string[];
  return (
    <ActionSheet open={open} onClose={onClose} title={title}
      footer={repeatDone ? <Button size="lg" onClick={() => onDone({ day: repeatDone.day, message: repeatDone.short })}>Pronto</Button> : (
        <div className="flex w-full flex-col gap-2.5">
          {summary && <p data-testid="booking-summary" className="text-sm leading-snug text-ink-2 tabular">{summary}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Voltar</Button>
            {needsFit
              ? <Button size="lg" variant="gold" disabled={pending} onClick={() => { setFitOpen(false); document.getElementById("marcar-hora")?.focus(); document.getElementById("marcar-livres")?.scrollIntoView?.({ block: "nearest" }); }}>Escolher outro horário</Button>
              : <Button size="lg" loading={pending} onClick={() => submit(false)}>{reschedule ? "Remarcar" : "Marcar"}</Button>}
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-6">
        {agendaMode === "dupla" && <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{DUPLA_NOTE}</p>}
        <section aria-label="Cliente">
          <SheetLabel>Cliente</SheetLabel>
          <ClientPicker value={client} onChange={(c) => { setClient(c); setError(null); }} locked={!!reschedule || !!initial.client} peopleChoice={!reschedule} />
        </section>

        <section aria-label="Serviços" className="flex flex-col gap-3">
          <SheetLabel>{items.length > 1 ? "Serviços" : "Serviço"}</SheetLabel>
          {items.map((it, k) => {
            const svc = svcOf(it.serviceId);
            const def = defaultDuration(it, k);
            const price = it.serviceId ? priceOf(it) : null;
            const durationValue = it.durationText || (def != null ? String(def) : "");
            const changed = typed(it, k) != null;
            const proName = it.professionalId ? proOf(it.professionalId)?.name ?? null : null;
            const toPro = !!it.professionalId && perProTerms && svc?.durationMin != null;
            const saveLabel = toPro ? `Guardar como padrão da ${firstName(proName) ?? "profissional"}` : "Salvar como duração do serviço";
            return (
              <fieldset key={k} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line p-3">
                <legend className="sr-only">Serviço {k + 1}</legend>
                <div className="flex items-baseline justify-between gap-3">
                  <span aria-hidden className="text-sm font-medium text-graphite">{items.length > 1 ? `${k + 1}º serviço` : "Serviço e quem atende"}</span>
                  {price != null && <span aria-label={`Preço do serviço ${k + 1}`} className="text-sm font-medium text-ink-2 tabular" title="Preço do catálogo">{money(price)}</span>}
                </div>
                {k > 0 && <Segmented label={`Quando é o serviço ${k + 1}`} value={it.mode} onChange={(v) => setItem(k, { mode: v })}
                  options={[{ value: "depois", label: "Logo depois" }, { value: "junto", label: "Ao mesmo tempo, com outra profissional" }]} />}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select aria-label={`Serviço ${k + 1}`} value={it.serviceId} disabled={!!reschedule} onChange={(e) => pickService(k, e.target.value)} className="h-12">
                    <option value="">Escolher serviço</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                  <Select aria-label={`Profissional ${k + 1}`} value={it.professionalId} onChange={(e) => pickPro(k, e.target.value)} className="h-12">
                    <option value="">{prosFor(it.serviceId).length ? "Qualquer uma" : "Ninguém faz esse serviço"}</option>
                    {(canEditConfig ? active : prosFor(it.serviceId)).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{it.serviceId && !p.serviceIds.includes(it.serviceId) ? " (não faz)" : ""}</option>
                    ))}
                  </Select>
                </div>
                {!reschedule && (
                  <Segmented label={`Preferência pela profissional no ${k + 1}º serviço`} value={it.preference || undefined} onChange={(v) => setItem(k, { preference: v as Preference, prefManual: true })}
                    options={[
                      { value: "escolhida", label: `Ela quer a ${proName ?? "profissional escolhida"}` },
                      { value: "sem_preferencia", label: "Tanto faz quem atende" },
                    ]} />
                )}
                {canEditConfig && needsLink(it) && (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={it.linkService} onChange={(e) => setItem(k, { linkService: e.target.checked })} />Ela faz esse serviço (gravar no cadastro)</label>
                )}
                <AuxiliariesField index={k} mainId={it.professionalId} mainName={proName} options={active} value={it.assistantIds}
                  onChange={(ids) => setItem(k, { assistantIds: ids })} preview={auxPreview[k]} comandaMax={comandaAssistantsMax} />
                {svc && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <label className="text-sm text-graphite" htmlFor={`marcar-duracao-${k}`}>{svc.durationMin == null && def == null ? "Quanto tempo leva desta vez? (min)" : "Duração (min)"}</label>
                      <Input id={`marcar-duracao-${k}`} inputMode="numeric" value={durationValue} className="h-11 w-24 tabular"
                        onChange={(e) => setItem(k, { durationText: e.target.value.replace(/\D/g, "").slice(0, 3), saveDuration: false })} />
                      {changed && def != null && <span className="text-xs text-muted">{`padrão ${def} min`}</span>}
                    </div>
                    {canEditConfig && !reschedule && (svc.durationMin == null || changed) && (
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={it.saveDuration} onChange={(e) => setItem(k, { saveDuration: e.target.checked })} />{saveLabel}</label>
                    )}
                  </div>
                )}
                {k > 0 && <button type="button" className="self-start text-sm text-alert hover:underline" onClick={() => setItems((l) => l.filter((_, j) => j !== k))}>Tirar este serviço</button>}
              </fieldset>
            );
          })}
          {reschedule?.preference === "escolhida" && first.professionalId && first.professionalId !== reschedule.professionalId && (
            <label className="flex items-center gap-2 rounded-[var(--radius-control)] bg-gold-soft/60 px-3 py-2 text-sm text-gold-ink">
              <input type="checkbox" checked={confirmChange} onChange={(e) => setConfirmChange(e.target.checked)} />
              {`Ela pediu a ${reschedule.professionalName ?? "outra profissional"}. Trocar mesmo assim`}
            </label>
          )}
          {!reschedule && items.length < MAX_ITEMS && (
            <button type="button" className="self-start text-sm font-medium text-gold-ink hover:underline" onClick={() => setItems((l) => [...l, newItem()])}>+ Outro serviço na mesma visita</button>
          )}
        </section>

        <section aria-label="Quando" className="flex flex-col gap-3">
          <SheetLabel>Quando</SheetLabel>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="marcar-dia" className="mb-1.5 block text-sm text-graphite">Dia</label>
              <Input id="marcar-dia" type="date" value={day} className="h-12" onChange={(e) => { setDay(e.target.value); setError(null); }} />
            </div>
            <div>
              <label htmlFor="marcar-hora" className="mb-1.5 block text-sm text-graphite">Hora</label>
              <Input id="marcar-hora" type="time" step={300} value={time} aria-describedby="marcar-livres" className="h-12" onChange={(e) => { setTime(e.target.value); setError(null); }} />
            </div>
          </div>
          {preview && (
            <div className="flex flex-col gap-2">
              {preview.needsDuration && firstDuration == null && <p className="text-sm text-graphite">{preview.serviceLabel} não tem duração cadastrada. Diga quanto tempo leva desta vez para ver os horários livres.</p>}
              {preview.preview && (
                <p role="status" data-testid="booking-preview" className={cn("rounded-[var(--radius-control)] px-3 py-2 text-sm", state === "livre" ? "bg-ok-soft text-ok" : "bg-alert-soft text-alert")}>{preview.preview.text}</p>
              )}
              {preview.preview?.warnings.map((w) => <p key={w} className="text-sm text-gold-ink">{w}</p>)}
              {preview.suggestions.length > 0 && (
                <div id="marcar-livres">
                  <p className="mb-1.5 text-xs text-muted">{time ? "Próximos livres" : "Sugestões de horário (toque para escolher)"}</p>
                  <div className="flex flex-wrap gap-2">
                    {preview.suggestions.flatMap((sug) => sug.startsAt.map((iso) => (
                      <button key={`${sug.professionalId}${iso}`} type="button" className="inline-flex h-10 items-center rounded-full border border-line-strong px-3 text-sm tabular hover:bg-paper-2"
                        onClick={() => { setTime(HORA.format(new Date(iso))); if (anyPro) setItem(0, { professionalId: sug.professionalId }); }}>
                        {HORA.format(new Date(iso))}{anyPro ? ` · ${sug.name}` : ""}
                      </button>
                    )))}
                  </div>
                </div>
              )}
            </div>
          )}
          {needsFit && canFitIn && (
            <div className="flex flex-col gap-2">
              {!fitOpen
                ? <button type="button" className="self-start text-sm text-graphite underline-offset-4 hover:underline" onClick={() => setFitOpen(true)}>Encaixar mesmo assim</button>
                : (
                  <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-3">
                    <label className="text-sm text-graphite" htmlFor="marcar-encaixe-motivo">Por que vai encaixar por cima de outra cliente?</label>
                    <Input id="marcar-encaixe-motivo" value={fitReason} maxLength={200} className="h-11" onChange={(e) => { setFitReason(e.target.value); setError(null); }} />
                    <Button size="md" variant="secondary" loading={pending} disabled={fitReason.trim().length < 3} onClick={() => submit(true)}>Encaixar mesmo assim</Button>
                  </div>
                )}
            </div>
          )}
        </section>

        {hasMore && (
          <section aria-label="Mais opções" className="flex flex-col gap-4">
            <button type="button" aria-expanded={moreOpen} aria-controls="marcar-mais" onClick={() => setMoreOpen((v) => !v)}
              className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 text-left text-sm hover:bg-paper-2">
              <span className="font-medium text-graphite">Mais opções</span>
              <span className="truncate text-xs text-muted">{moreFilled.length ? moreFilled.join(" · ") : canRepeat ? "Observação, marcador, repetir" : "Observação, marcador"}<span aria-hidden className="ml-2">{moreOpen ? "▴" : "▾"}</span></span>
            </button>
            {moreOpen && (
              <div id="marcar-mais" className="flex flex-col gap-5">
                <div>
                  <SheetLabel><label htmlFor="marcar-obs">Observação deste horário</label></SheetLabel>
                  <Textarea id="marcar-obs" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <MarkerFields labels={labels} types={visitTypes} labelId={labelId} visitType={visitType} onLabel={setLabelId} onType={setVisitType} />
                {canRepeat && (
                  <div aria-label="Repetir" role="group" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-graphite">Repetir</span>
                      <Switch label="Repetir" checked={repeatOn} disabled={!!repeatDone} onChange={(v) => { setRepeatOn(v); setError(null); }} />
                    </div>
                    {repeatOn && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                        <span className="inline-flex items-center gap-2">A cada
                          <Select aria-label="A cada quantas semanas" value={String(everyWeeks)} disabled={!!repeatDone} onChange={(e) => setEveryWeeks(Number(e.target.value))} className="h-11 w-20">
                            {Array.from({ length: repeat!.maxSemanas }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                          </Select>
                          {everyWeeks === 1 ? "semana" : "semanas"}</span>
                        <span className="inline-flex items-center gap-2">
                          <Select aria-label="Quantas vezes" value={String(times)} disabled={!!repeatDone} onChange={(e) => setTimes(Number(e.target.value))} className="h-11 w-20">
                            {Array.from({ length: repeat!.maxVezes - REPETIR_MIN_VEZES + 1 }, (_, k) => k + REPETIR_MIN_VEZES).map((n) => <option key={n} value={n}>{n}</option>)}
                          </Select>
                          vezes</span>
                      </div>
                    )}
                    {repeatOn && !repeatDone && <p className="text-xs text-muted">Cada vez passa pelas mesmas regras do Marcar. A que não couber fica de fora e aparece aqui, sem virar encaixe.</p>}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        {repeatDone && <p role="status" data-testid="repeat-result" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{repeatDone.text}</p>}
        <FieldError>{error}</FieldError>
        {existing && <Link href={`/agenda?d=${existing.day}&destaque=${existing.id}`} className="self-start text-sm font-medium text-gold-ink underline-offset-4 hover:underline">Abrir o horário</Link>}
      </div>
    </ActionSheet>
  );
}
