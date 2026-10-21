"use client";
import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SendConfirmDialog } from "@/components/config/send-confirm";
import { AUTOMATION_TEMPLATES, sendsMessages, type AutomationTemplate } from "@/server/rules/templates";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { IconPlus, IconClose, IconClock, IconRefresh, IconCake, IconMoney, IconCalendar, IconBolt } from "@/components/icons";
import { TRIGGER_LABELS, ACTION_LABELS, MEDIA_KIND_LABEL, MAX_ACTIONS, STATUS_LABELS, delayLabel, describeConditions, describeTrigger, isEventTrigger, type AutomationInput, type Condition, type Trigger, type Action } from "@/server/rules/types";
import { saveAutomationAction, toggleAutomationAction, restoreAutomationAction, deleteAutomationAction, automationDetailsAction, previewAutomationAction } from "@/app/(app)/config/actions";
import { SPRING_UI } from "@/lib/motion";
import { RelTime } from "@/components/ui/rel-time";

type Item = { id: string; name: string; enabled: boolean; trigger: Record<string, unknown>; conditions: Record<string, unknown>[]; actions: Record<string, unknown>[]; version: number; updatedAt: string };
type StageOpt = { key: string; name: string };
/** O que as ações novas escolhem: setor ou pessoa (Passar para), arquivo da Biblioteca e o atraso máximo (Configurações › Recursos). */
type Opt = { id: string; name: string };
export type ActionOptions = { teams: Opt[]; people: Opt[]; files: Opt[]; maxDelay: number };
const NO_OPTIONS: ActionOptions = { teams: [], people: [], files: [], maxDelay: 0 };
const SEND_ACTIONS = new Set<Action["type"]>(["enviar_mensagem", "enviar_enquete_confirmacao", "enviar_arquivo", "pedir_avaliacao"]);
const nameOf = (list: Opt[], id: string, fallback: string) => list.find((x) => x.id === id)?.name ?? fallback;

const unitOf = (t: Trigger["type"]) => (isEventTrigger({ type: t }) || t === "data_cobranca" || t === "data_recontato" ? null : t === "sem_resposta_minutos" ? "minutos" : t === "agendamento_em_horas" || t === "casa_falou_por_ultimo_horas" ? "horas" : "dias");
const MEDIA_KINDS = ["image", "audio", "video", "document"] as const;
/** Gatilho por acontecimento com o valor inicial do editor. */
const eventTrigger = (type: Trigger["type"]): Trigger => (type === "cliente_escreveu" ? { type, words: ["quanto custa", "valor"] }
  : type === "midia_recebida" ? { type, kinds: [...MEDIA_KINDS] } : type === "etiqueta_colocada" ? { type, tag: "" } : { type } as Trigger);
/** Condições além da etapa ("com a Casa aberta", "com a etiqueta VIP"): entram na frase do Quando. */
const otherConds = (conds: Condition[]) => conds.filter((c) => c.type !== "etapa_em");
const EVENT_NOTE = "Vale para o que acontecer depois de ligar.";
const later = (a: { delayMinutes?: number }) => (a.delayMinutes ? ` ${delayLabel(a.delayMinutes).toLowerCase()}` : "");
const describeAction = (a: Action, stages: StageOpt[], o: ActionOptions = NO_OPTIONS): string => {
  switch (a.type) {
    case "mover_para_etapa": return `mover para ${stages.find((s) => s.key === a.stage)?.name ?? a.stage}`;
    case "mover_para_proximo_followup": case "aguardar_cliente": return "marcar como aguardando cliente";
    case "alertar_gestao": return "avisar a gestão";
    case "escalar_gestao": return "escalar o alerta para a gestão";
    case "enviar_mensagem": return `enviar mensagem à cliente${later(a)}`;
    case "enviar_enquete_confirmacao": return "enviar enquete de confirmação";
    case "alertar_responsavel": return "alertar quem é responsável";
    case "por_etiqueta": return `pôr a etiqueta ${a.tag}`;
    case "tirar_etiqueta": return `tirar a etiqueta ${a.tag}`;
    case "passar_para": return `passar para ${"team" in a.to ? `o setor ${nameOf(o.teams, a.to.team, "escolhido")}` : nameOf(o.people, a.to.user, "a pessoa escolhida")}`;
    case "escrever_nota": return "escrever uma nota";
    case "enviar_arquivo": return `enviar o arquivo ${nameOf(o.files, a.fileId, "da Biblioteca")}${later(a)}`;
    case "mudar_status": return `mudar o status para ${STATUS_LABELS[a.status]}`;
    case "pedir_avaliacao": return "mandar a Pesquisa de satisfação";
  }
};

const GROUPS: { title: string; hint: string; types: Trigger["type"][]; icon: "clock" | "flow" | "cal" }[] = [
  { title: "Atendimento", hint: "prazos de resposta e conversas paradas", types: ["sem_resposta_minutos", "parado_dias"], icon: "clock" },
  { title: "Aguardando cliente", hint: "quando a bola está com a cliente", types: ["casa_falou_por_ultimo_horas", "sem_retorno_cliente_dias"], icon: "flow" },
  { title: "Datas", hint: "agendamento, aniversário, cobrança e recontato", types: ["agendamento_em_horas", "aniversario_em_dias", "data_cobranca", "data_recontato"], icon: "cal" },
  { title: "Acontecimentos", hint: "palavra, contato novo, ligação perdida, mídia e etiqueta", types: ["cliente_escreveu", "contato_novo", "ligacao_perdida", "midia_recebida", "etiqueta_colocada"], icon: "flow" },
];

export function AutomationsList({ items, stages, runs, options = NO_OPTIONS }: { items: Item[]; stages: StageOpt[]; runs: Record<string, number>; options?: ActionOptions }) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirmOn, setConfirmOn] = useState<Item | null>(null);
  const [reach, setReach] = useState<number | null>(null);
  const askOn = (a: Item) => { setReach(null); setConfirmOn(a); if (isEventTrigger(a.trigger as Trigger)) return; void previewAutomationAction({ name: a.name, enabled: true, trigger: a.trigger as Trigger, conditions: a.conditions as AutomationInput["conditions"], actions: a.actions as Action[] }).then((r) => { if (r.ok) setReach(r.data!.sendCount); }); };
  const [pendingOn, startOn] = useTransition();
  const [, start] = useTransition(); const toast = useToast();
  const toggle = (a: Item, v: boolean) => start(async () => { const r = await toggleAutomationAction(a.id, v); toast(r.ok ? (v ? "Automação ligada" : "Automação desligada") : r.error, r.ok ? "ok" : "error"); });
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <p className="text-sm text-graphite max-w-[60ch]">Regras que o CRM roda sozinho: as de tempo a cada minuto, as de acontecimento na hora em que algo acontece. Ligue, desligue ou edite: cada mudança fica guardada e dá para voltar à versão anterior.</p>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button size="sm" variant="secondary" className="h-9 pointer-coarse:h-11" onClick={() => setPicking(true)}>Começar de um modelo</Button>
          <Button size="sm" className="h-9 pointer-coarse:h-11" onClick={() => setEditing("new")}><IconPlus size={16} />Nova automação</Button>
        </div>
      </div>
      {GROUPS.map((g) => { const list = items.filter((a) => g.types.includes((a.trigger as Trigger).type)); if (!list.length) return null; return (
      <section key={g.title} className="mb-7">
      <h3 className="flex items-baseline gap-2 mb-2.5"><span className="font-display text-lg">{g.title}</span><span className="text-sm text-muted">{g.hint}</span></h3>
      <ul className="grid gap-3 min-[1100px]:grid-cols-2">
        <AnimatePresence initial={false}>
          {list.map((a, i) => {
            const t = a.trigger as Trigger; const allConds = a.conditions as Condition[]; const conds = allConds.filter((c) => c.type === "etapa_em"); const acts = a.actions as Action[];
            return (
              <motion.li key={a.id} layout transition={SPRING_UI} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }} exit={{ opacity: 0 }}
                className={`rounded-[var(--radius-card)] border bg-paper p-4 lg:p-5 flex gap-4 items-start transition-colors ${a.enabled ? "border-line" : "border-line opacity-70"}`}>
                <span className={`size-9 shrink-0 rounded-[var(--radius-control)] grid place-items-center ${a.enabled ? "bg-gold-soft text-gold-ink" : "bg-paper-2 text-muted"}`}>
                  {isEventTrigger(t) ? <IconBolt size={17} /> : t.type === "sem_resposta_minutos" || t.type === "parado_dias" ? <IconClock size={17} /> : t.type === "sem_retorno_cliente_dias" || t.type === "casa_falou_por_ultimo_horas" ? <IconRefresh size={17} /> : t.type === "aniversario_em_dias" ? <IconCake size={17} /> : t.type === "data_cobranca" ? <IconMoney size={17} /> : <IconCalendar size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-base">{a.name}</p>
                  <p className="text-sm text-graphite mt-1 leading-relaxed">
                    <b className="text-gold-ink font-semibold">Quando</b> {describeTrigger(t)}{describeConditions(otherConds(allConds), stages)}
                    {conds[0]?.stages?.length ? <> <b className="text-gold-ink font-semibold">· Se</b> estiver em {conds[0].stages.map((k) => stages.find((s) => s.key === k)?.name ?? k).join(", ")}</> : null}
                    {" "}<b className="text-gold-ink font-semibold">· Então</b> {acts.map((x) => describeAction(x, stages, options)).join(" e ")}
                  </p>
                  <p className="text-xs text-muted mt-1.5">{runs[a.id] ? <b className="text-graphite font-semibold">Disparou {runs[a.id]}× nos últimos 7 dias · </b> : "Não disparou nos últimos 7 dias · "}versão {a.version}, alterada <RelTime at={a.updatedAt} /></p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button className="text-sm text-graphite hover:text-ink underline-offset-2 hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={() => setEditing(a)}>Editar</button>
                  <Switch checked={a.enabled} label={`${a.enabled ? "Desligar" : "Ligar"} ${a.name}`} onChange={(v) => (v && sendsMessages(a.actions as Action[]) ? askOn(a) : toggle(a, v))} />
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      </section>); })}
      <TemplatePicker open={picking} onClose={() => setPicking(false)} onCreated={(it) => { setPicking(false); setEditing(it); }} />
      <SendConfirmDialog open={!!confirmOn} pending={pendingOn} reach={reach} onClose={() => setConfirmOn(null)} what={`A automação “${confirmOn?.name ?? ""}” passa a mandar mensagem para as clientes, só no horário de atendimento e respeitando o limite por hora.${confirmOn && isEventTrigger(confirmOn.trigger as Trigger) ? ` ${EVENT_NOTE}` : ""}`}
        onConfirm={() => startOn(async () => { if (confirmOn) { const r = await toggleAutomationAction(confirmOn.id, true, { confirmouEnvio: true }); toast(r.ok ? "Automação ligada" : r.error, r.ok ? "ok" : "error"); } setConfirmOn(null); })} />
      <Editor key={editing === "new" ? "new" : editing?.id ?? "none"} item={editing} stages={stages} options={options} onClose={() => setEditing(null)} />
    </div>
  );
}

function Editor({ item, stages, options, onClose }: { item: Item | "new" | null; stages: StageOpt[]; options: ActionOptions; onClose: () => void }) {
  const isNew = item === "new";
  const init: AutomationInput = item && item !== "new"
    ? { name: item.name, enabled: item.enabled, trigger: item.trigger as Trigger, conditions: item.conditions as AutomationInput["conditions"], actions: item.actions as Action[] }
    : { name: "", enabled: false, trigger: { type: "sem_resposta_minutos", minutes: 5 }, conditions: [{ type: "etapa_em", stages: ["lead"] }], actions: [{ type: "alertar_responsavel", message: "{nome} está esperando há {minutos} min" }] };
  const [v, setV] = useState<AutomationInput>(init);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [details, setDetails] = useState<{ versions: { version: number; createdAt: string; user: string | null }[]; runs: { createdAt: string; name: string | null; phone: string | null; result: { acoes?: string[] } }[] } | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [reachSave, setReachSave] = useState<number | null>(null);
  const open = item !== null;
  // Ligada e mandando mensagem: salvar pede a confirmação de envio real (o servidor recusa sem ela). Regra nova nasce desligada.
  const needsSendConfirm = v.enabled && sendsMessages(v.actions);
  const save = (confirmouEnvio = false) => start(async () => { const r = await saveAutomationAction(isNew ? null : (item as Item).id, v, { confirmouEnvio }); setConfirmSend(false); if (r.ok) { toast(isNew && !v.enabled ? "Automação criada, desligada. Ligue quando quiser" : "Automação salva"); onClose(); } else setErr(r.error); });
  const stageCond = v.conditions.find((c) => c.type === "etapa_em");
  const stagesSel = stageCond?.type === "etapa_em" ? stageCond.stages : [];
  const casaCond = v.conditions.find((c) => c.type === "casa_aberta");
  const tagCond = v.conditions.find((c) => c.type === "tem_etiqueta");
  /** Troca (ou tira, com null) a condição deste tipo, mantendo as outras. */
  const setCond = (type: Condition["type"], c: Condition | null) => setV({ ...v, conditions: [...v.conditions.filter((x) => x.type !== type), ...(c ? [c] : [])] });
  const isEvent = isEventTrigger(v.trigger);
  const [wordsText, setWordsText] = useState(v.trigger.type === "cliente_escreveu" ? v.trigger.words.join(", ") : "quanto custa, valor");
  const unit = unitOf(v.trigger.type);
  const amount = "minutes" in v.trigger ? v.trigger.minutes : "hours" in v.trigger ? v.trigger.hours : "days" in v.trigger ? v.trigger.days : 0;
  const stageBased = (v.trigger.type === "sem_resposta_minutos" && !!v.trigger.useStageSla) || (v.trigger.type === "parado_dias" && !!v.trigger.useStageLimit);

  const setTrigger = (type: Trigger["type"], n?: number) => {
    const u = unitOf(type); const val = n ?? (u === "minutos" ? 5 : u === "horas" ? 24 : u === "dias" ? 1 : 0);
    // "Escalar para a gestão" só existe para lead sem resposta: ao trocar o gatilho vira um aviso à gestão comum.
    const actions = type === "sem_resposta_minutos" ? v.actions
      : v.actions.map((a): Action => (a.type === "escalar_gestao" ? { type: "alertar_gestao", message: "Atenção: {nome}" } : a));
    if (isEventTrigger({ type })) {
      const t = eventTrigger(type);
      if (t.type === "cliente_escreveu") setWordsText(t.words.join(", "));
      return setV({ ...v, actions, trigger: t });
    }
    setV({ ...v, actions, trigger: (u === "minutos" ? { type, minutes: val } : u === "horas" ? { type, hours: val } : u === "dias" ? { type, days: val } : { type }) as Trigger });
  };
  const setAction = (i: number, a: Action) => setV({ ...v, actions: v.actions.map((x, j) => (j === i ? a : x)) });
  const newAction = (type: Action["type"]): Action => {
    switch (type) {
      case "mover_para_etapa": return { type, stage: "atendimento" };
      case "mover_para_proximo_followup": case "escalar_gestao": case "aguardar_cliente": case "pedir_avaliacao": return { type };
      case "por_etiqueta": case "tirar_etiqueta": return { type, tag: "" };
      case "passar_para": return { type, to: options.teams[0] ? { team: options.teams[0].id } : { user: options.people[0]?.id ?? "" } };
      case "escrever_nota": return { type, text: "" };
      case "enviar_arquivo": return { type, fileId: options.files[0]?.id ?? "", caption: "" };
      case "mudar_status": return { type, status: "aguardando" };
      case "alertar_gestao": return { type, message: "Atenção: {nome}" };
      case "enviar_mensagem": return { type, message: "Oi, {nome}! " };
      case "enviar_enquete_confirmacao": return { type, message: "Oi, {nome}! Seu horário na Casa Fiaes é {data}, às {hora}. Você confirma?" };
      case "alertar_responsavel": return { type, message: "Hora de falar com {nome}" };
    }
  };
  /** Ações que dependem de algo cadastrado: sem arquivo na Biblioteca (ou sem setor e pessoa), a opção não aparece. */
  const actionAvailable = (k: Action["type"]) => (k !== "escalar_gestao" || v.trigger.type === "sem_resposta_minutos")
    && (k !== "enviar_arquivo" || options.files.length > 0) && (k !== "passar_para" || options.teams.length + options.people.length > 0);

  return (
    <>
    <Dialog open={open} onClose={onClose} title={isNew ? "Nova automação" : "Editar automação"} width={640}
      footer={<>
        {!isNew && (confirmDel
          ? <span className="mr-auto flex items-center gap-2 text-sm">Apagar de vez?<Button size="sm" variant="danger" onClick={() => start(async () => { const r = await deleteAutomationAction((item as Item).id); if (r.ok) { toast("Automação apagada"); onClose(); } else toast(r.error, "error"); })}>Apagar</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>Não</Button></span>
          : <Button variant="ghost" className="mr-auto text-alert hover:bg-alert-soft" onClick={() => setConfirmDel(true)}>Apagar</Button>)}
        <Button variant="secondary" onClick={() => start(async () => { if (isEvent) return setPreview(EVENT_NOTE); const r = await previewAutomationAction(v); setPreview(r.ok ? `Agora, ${r.data!.count} ${r.data!.count === 1 ? "conversa" : "conversas"} se encaixa${r.data!.count === 1 ? "" : "m"} nesta regra${r.data!.sample.length ? `: ${r.data!.sample.join(", ")}` : ""}.` : r.error); })}>Testar</Button>
        <Button onClick={() => { if (!needsSendConfirm) return save(); setReachSave(null); setConfirmSend(true); if (isEvent) return; void previewAutomationAction(v).then((r) => { if (r.ok) setReachSave(r.data!.sendCount); }); }} loading={pending}>Salvar</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <label className="block"><span className="text-sm font-medium text-graphite">Nome</span>
          <Input className="mt-1.5" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ex.: Cliente sem resposta em 5 minutos" /></label>
        <Block label="Quando">
          <div className="flex flex-wrap gap-2 items-center">
            <Select className="w-auto" value={v.trigger.type} onChange={(e) => setTrigger(e.target.value as Trigger["type"])}>
              {Object.entries(TRIGGER_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            {unit && !stageBased && <span className="inline-flex items-center gap-2"><Input type="number" min={unit === "dias" && v.trigger.type === "aniversario_em_dias" ? 0 : 1} className="w-20" value={amount} onChange={(e) => setTrigger(v.trigger.type, Math.max(0, Number(e.target.value)))} /><span className="text-sm text-graphite">{unit}</span></span>}
          </div>
          {(v.trigger.type === "sem_resposta_minutos" || v.trigger.type === "parado_dias") && (
            <label className="flex items-center gap-2 mt-2.5 text-sm text-graphite">
              <input type="checkbox" checked={stageBased} onChange={(e) => setV({ ...v, trigger: { ...v.trigger, ...(v.trigger.type === "sem_resposta_minutos" ? { useStageSla: e.target.checked } : { useStageLimit: e.target.checked }) } as Trigger })} />
              Usar o {v.trigger.type === "sem_resposta_minutos" ? "prazo de resposta" : "limite parado"} de cada etapa (Configurações › Etapas)
            </label>
          )}
          {v.trigger.type === "cliente_escreveu" && (
            <label className="block mt-2.5"><span className="text-sm text-graphite">Palavras ou frases, separadas por vírgula (sem diferença de acento e maiúscula; até 20)</span>
              <Input className="mt-1.5" value={wordsText} placeholder="quanto custa, valor"
                onChange={(e) => { setWordsText(e.target.value); setV({ ...v, trigger: { type: "cliente_escreveu", words: e.target.value.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 20) } }); }} /></label>
          )}
          {v.trigger.type === "midia_recebida" && (() => { const kinds = v.trigger.kinds; return (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {MEDIA_KINDS.map((k) => { const on = kinds.includes(k); return (
                <button key={k} type="button" aria-pressed={on} onClick={() => { const next = on ? kinds.filter((x) => x !== k) : [...kinds, k]; if (next.length) setV({ ...v, trigger: { type: "midia_recebida", kinds: next } }); }}
                  className={`h-8 px-3 rounded-full text-sm border transition-colors ${on ? "bg-ink text-paper border-ink" : "border-line-strong hover:bg-paper-2"}`}>{MEDIA_KIND_LABEL[k]}</button>); })}
            </div>); })()}
          {v.trigger.type === "etiqueta_colocada" && (
            <label className="block mt-2.5"><span className="text-sm text-graphite">Qual etiqueta</span>
              <Input className="mt-1.5" maxLength={30} value={v.trigger.tag} placeholder="Ex.: VIP" onChange={(e) => setV({ ...v, trigger: { type: "etiqueta_colocada", tag: e.target.value } })} /></label>
          )}
          {isEvent && <p className="text-sm text-muted mt-2">{EVENT_NOTE} Etiqueta posta por outra regra não dispara regra.</p>}
        </Block>
        <Block label="Se (opcional)">
          <p className="text-sm text-muted mb-2">Só vale para conversas nestas etapas. Nenhuma marcada = todas.</p>
          <div className="flex flex-wrap gap-1.5">
            {stages.map((s) => {
              const on = stagesSel.includes(s.key);
              return <button key={s.key} type="button" aria-pressed={on} onClick={() => { const next = on ? stagesSel.filter((k) => k !== s.key) : [...stagesSel, s.key]; setCond("etapa_em", next.length ? { type: "etapa_em", stages: next } : null); }}
                className={`h-8 px-3 rounded-full text-sm border transition-colors ${on ? "bg-ink text-paper border-ink" : "border-line-strong hover:bg-paper-2"}`}>{s.name}</button>;
            })}
          </div>
          <div className="flex flex-wrap gap-2 items-center mt-3">
            <Select className="w-auto" aria-label="Horário da Casa" value={casaCond?.type === "casa_aberta" ? (casaCond.aberta ? "aberta" : "fechada") : ""}
              onChange={(e) => setCond("casa_aberta", e.target.value ? { type: "casa_aberta", aberta: e.target.value === "aberta" } : null)}>
              <option value="">Com a Casa aberta ou fechada</option>
              <option value="aberta">Só com a Casa aberta</option>
              <option value="fechada">Só com a Casa fechada</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 items-center mt-2">
            <Select className="w-auto" aria-label="Etiqueta da cliente" value={tagCond?.type === "tem_etiqueta" ? (tagCond.tem ? "tem" : "nao") : ""}
              onChange={(e) => setCond("tem_etiqueta", e.target.value ? { type: "tem_etiqueta", tag: tagCond?.type === "tem_etiqueta" ? tagCond.tag : "", tem: e.target.value === "tem" } : null)}>
              <option value="">Com ou sem etiqueta</option>
              <option value="tem">Só se tiver a etiqueta</option>
              <option value="nao">Só se não tiver a etiqueta</option>
            </Select>
            {tagCond?.type === "tem_etiqueta" && <Input className="w-40" maxLength={30} aria-label="Nome da etiqueta" placeholder="Ex.: VIP" value={tagCond.tag} onChange={(e) => setCond("tem_etiqueta", { ...tagCond, tag: e.target.value })} />}
          </div>
          <p className="text-sm text-graphite mt-2.5">Quando {describeTrigger(v.trigger)}{describeConditions(v.conditions, stages)}.</p>
        </Block>
        <Block label="Então">
          <div className="flex flex-col gap-2">
            {v.actions.map((a, i) => (
              <div key={i} className="grid grid-cols-[88px_1fr] gap-x-3 items-start">
                {/* Linha do tempo: o que acontece na hora e o que fica para depois. */}
                <span className={`pt-2 text-xs font-medium ${"delayMinutes" in a && a.delayMinutes ? "text-gold-ink" : "text-muted"}`}>{delayLabel("delayMinutes" in a ? a.delayMinutes : 0)}</span>
                <div className="flex flex-wrap gap-2 items-center min-w-0">
                <Select className="w-auto" value={a.type} onChange={(e) => setAction(i, newAction(e.target.value as Action["type"]))}>
                  {Object.entries(ACTION_LABELS).filter(([k]) => k === a.type || actionAvailable(k as Action["type"])).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                {"message" in a && (a.type === "enviar_mensagem" || a.type === "enviar_enquete_confirmacao"
                  ? <textarea className="flex-1 min-w-[220px] rounded-[var(--radius-control)] border border-control/70 px-3 py-2 text-base min-h-20" value={a.message} onChange={(e) => setAction(i, { ...a, message: e.target.value })} aria-label={a.type === "enviar_enquete_confirmacao" ? "Pergunta da enquete" : "Texto da mensagem"} />
                  : <Input className="flex-1 min-w-[220px]" value={a.message} onChange={(e) => setAction(i, { ...a, message: e.target.value })} />)}
                {a.type === "mover_para_etapa" && <Select className="w-auto" value={a.stage} onChange={(e) => setAction(i, { ...a, stage: e.target.value })}>{stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>}
                {(a.type === "por_etiqueta" || a.type === "tirar_etiqueta") && <Input className="w-48" maxLength={30} aria-label="Nome da etiqueta" placeholder="Ex.: Quer remarcar" value={a.tag} onChange={(e) => setAction(i, { ...a, tag: e.target.value })} />}
                {a.type === "passar_para" && (
                  <Select className="w-auto" aria-label="Passar para quem" value={"team" in a.to ? `team:${a.to.team}` : `user:${a.to.user}`}
                    onChange={(e) => { const [kind, id] = e.target.value.split(":"); setAction(i, { ...a, to: kind === "team" ? { team: id } : { user: id } }); }}>
                    {options.teams.length > 0 && <optgroup label="Setor">{options.teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}</optgroup>}
                    {options.people.length > 0 && <optgroup label="Pessoa">{options.people.map((p) => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}</optgroup>}
                  </Select>)}
                {a.type === "escrever_nota" && <textarea className="flex-1 min-w-[220px] rounded-[var(--radius-control)] border border-control/70 px-3 py-2 text-base min-h-16" maxLength={500} aria-label="Texto da nota" placeholder="Ex.: Pediu para remarcar" value={a.text} onChange={(e) => setAction(i, { ...a, text: e.target.value })} />}
                {a.type === "enviar_arquivo" && <>
                  <Select className="w-auto max-w-full" aria-label="Arquivo da Biblioteca" value={a.fileId} onChange={(e) => setAction(i, { ...a, fileId: e.target.value })}>
                    {!options.files.some((f) => f.id === a.fileId) && <option value={a.fileId}>Arquivo que saiu da Biblioteca: escolha outro</option>}
                    {options.files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </Select>
                  <Input className="flex-1 min-w-[220px]" maxLength={1000} aria-label="Legenda (opcional)" placeholder="Legenda (opcional)" value={a.caption ?? ""} onChange={(e) => setAction(i, { ...a, caption: e.target.value })} />
                </>}
                {a.type === "mudar_status" && <Select className="w-auto" aria-label="Status" value={a.status} onChange={(e) => setAction(i, { ...a, status: e.target.value as typeof a.status })}>{Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}
                {(a.type === "enviar_mensagem" || a.type === "enviar_arquivo") && (
                  <label className="inline-flex items-center gap-2 text-sm text-graphite">Esperar
                    <Input type="number" min={0} max={options.maxDelay} className="w-20" aria-label="Minutos de espera antes de enviar" value={a.delayMinutes ?? 0}
                      onChange={(e) => { const n = Math.max(0, Math.floor(Number(e.target.value) || 0)); setAction(i, { ...a, delayMinutes: n || undefined }); }} />
                    min</label>)}
                {v.actions.length > 1 && <button type="button" aria-label="Remover ação" onClick={() => setV({ ...v, actions: v.actions.filter((_, j) => j !== i) })} className="size-8 grid place-items-center rounded-[8px] text-muted hover:bg-paper-2"><IconClose size={14} /></button>}
                </div>
              </div>
            ))}
            {v.actions.length < MAX_ACTIONS && <button type="button" onClick={() => setV({ ...v, actions: [...v.actions, newAction("alertar_responsavel")] })} className="self-start text-sm text-gold-ink hover:underline">+ Adicionar ação</button>}
            <p className="text-xs text-muted">Nas mensagens e legendas você pode usar {"{nome}"}, {"{etapa}"}, {"{minutos}"}, {"{dias}"} e, em agendamentos, {"{data}"} e {"{hora}"}. Mensagem e arquivo podem esperar até {options.maxDelay} min (Configurações › Recursos). Etiqueta, nota, passar para e status valem mesmo com as Automáticas pausadas.</p>
            {v.actions.some((x) => SEND_ACTIONS.has(x.type)) && <p className="text-sm bg-gold-soft text-gold-ink rounded-[var(--radius-control)] px-3 py-2">Esta automação manda mensagem de verdade para as clientes, pelo número da conversa, só no horário de atendimento e respeitando o limite de envios por hora. Revise o texto antes de ligar.{v.actions.some((x) => x.type === "enviar_enquete_confirmacao") && " A enquete tem duas opções: Confirmo (marca o horário como confirmado) e Preciso remarcar (cria uma tarefa para remarcar)."}{v.actions.some((x) => x.type === "pedir_avaliacao") && " A Pesquisa de satisfação usa a pergunta de Configurações › Depois do atendimento e só sai com ela ligada."}</p>}
          </div>
        </Block>
        <AnimatePresence>{preview && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm bg-gold-soft text-gold-ink rounded-[var(--radius-control)] px-3 py-2">{preview}</motion.p>}</AnimatePresence>
        {err && <p className="text-sm text-alert" role="alert">{err}</p>}
        {!isNew && (
          <div className="border-t border-line pt-4">
            {!details ? <button type="button" className="text-sm text-graphite hover:text-ink underline" onClick={() => start(async () => { const r = await automationDetailsAction((item as Item).id); if (r.ok) setDetails(r.data as never); })}>Ver versões e últimas execuções</button> : (
              <div className="grid sm:grid-cols-2 gap-5 text-sm">
                <div><p className="font-semibold mb-1.5">Versões</p>
                  <ul className="flex flex-col gap-1">{details.versions.map((x) => (
                    <li key={x.version} className="flex justify-between gap-2"><span>v{x.version} · <RelTime at={x.createdAt} />{x.user ? ` · ${x.user.split(" ")[0]}` : ""}</span>
                      {x.version !== (item as Item).version && <button className="text-gold-ink hover:underline" onClick={() => start(async () => { const r = await restoreAutomationAction((item as Item).id, x.version); if (r.ok) { toast(r.data?.disabled ? `Versão ${x.version} restaurada (desligada). Ligue quando quiser.` : `Voltou para a versão ${x.version}`); onClose(); } else toast(r.error, "error"); })}>Voltar a esta</button>}</li>
                  ))}{details.versions.length === 0 && <li className="text-muted">Versão original (nunca editada).</li>}</ul>
                </div>
                <div><p className="font-semibold mb-1.5">Últimas execuções</p>
                  <ul className="flex flex-col gap-1">{details.runs.map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{r.name ?? r.phone ?? "—"}</span><span className="text-muted shrink-0"><RelTime at={r.createdAt} /></span></li>)}
                    {details.runs.length === 0 && <li className="text-muted">Ainda não disparou.</li>}</ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
    <SendConfirmDialog open={confirmSend} pending={pending} reach={reachSave} onClose={() => setConfirmSend(false)} onConfirm={() => save(true)}
      what={`Salvar deixa esta automação ligada, mandando mensagem para as clientes, só no horário de atendimento e respeitando o limite por hora.${isEvent ? ` ${EVENT_NOTE}` : ""}`} />
    </>
  );
}

/** "Começar de um modelo": cria a automação já desligada e abre o editor para ajustar o texto. */
function TemplatePicker({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (it: Item) => void }) {
  const [pending, start] = useTransition(); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const pick = (t: AutomationTemplate) => start(async () => {
    setBusy(t.id); setErr(null);
    const r = await saveAutomationAction(null, { ...t.rule, enabled: false });
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    toast("Automação criada, desligada. Revise e ligue quando quiser", "ok");
    onCreated({ id: r.data as unknown as string, name: t.rule.name, enabled: false, trigger: t.rule.trigger, conditions: t.rule.conditions, actions: t.rule.actions, version: 1, updatedAt: new Date().toISOString() });
  });
  return (
    <Dialog open={open} onClose={onClose} title="Começar de um modelo" width={680} description="Escolha um ponto de partida. A automação nasce desligada e você revisa o texto antes de ligar.">
      <ul className="grid sm:grid-cols-2 gap-2.5 max-h-[58vh] overflow-y-auto overscroll-contain pr-1" data-testid="modelos">
        {AUTOMATION_TEMPLATES.map((t) => (
          <li key={t.id}>
            <button type="button" disabled={pending} onClick={() => pick(t)} data-testid={`modelo-${t.id}`}
              className="w-full h-full text-left rounded-[var(--radius-card)] border border-line bg-paper hover:bg-paper-2 hover:border-line-strong p-3.5 min-h-11 flex flex-col gap-1.5 disabled:opacity-60 transition-colors">
              <span className="flex items-start justify-between gap-2">
                <span className="font-medium text-base leading-snug">{t.name}</span>
                {sendsMessages(t.rule.actions) && <span className="shrink-0 text-xs font-medium text-gold-ink bg-gold-soft rounded-full px-2 py-0.5">Envia mensagem</span>}
              </span>
              <span className="text-sm text-graphite leading-relaxed">{busy === t.id ? "Criando…" : t.description}</span>
            </button>
          </li>
        ))}
      </ul>
      {err && <p className="text-sm text-alert mt-3" role="alert">{err}</p>}
    </Dialog>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-[72px_1fr] gap-2 sm:gap-4"><p className="font-display text-lg text-gold-ink pt-1.5">{label}</p><div>{children}</div></div>;
}
