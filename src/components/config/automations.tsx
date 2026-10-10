"use client";
import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { IconPlus, IconClose, IconClock, IconRefresh, IconCake, IconMoney, IconCalendar } from "@/components/icons";
import { TRIGGER_LABELS, ACTION_LABELS, type AutomationInput, type Trigger, type Action } from "@/server/rules/types";
import { saveAutomationAction, toggleAutomationAction, restoreAutomationAction, deleteAutomationAction, automationDetailsAction, previewAutomationAction } from "@/app/(app)/config/actions";
import { SPRING } from "@/lib/motion";
import { relTime } from "@/lib/format";

type Item = { id: string; name: string; enabled: boolean; trigger: Record<string, unknown>; conditions: Record<string, unknown>[]; actions: Record<string, unknown>[]; version: number; updatedAt: string };
type StageOpt = { key: string; name: string };

const unitOf = (t: Trigger["type"]) => (t === "sem_resposta_minutos" ? "minutos" : t === "agendamento_em_horas" ? "horas" : t === "data_cobranca" || t === "data_recontato" ? null : "dias");
const describeTrigger = (t: Trigger) => {
  switch (t.type) {
    case "sem_resposta_minutos": return t.useStageSla ? "lead passar do prazo de resposta da etapa" : `lead ficar sem resposta por ${t.minutes} min`;
    case "parado_dias": return t.useStageLimit ? "lead passar do limite parado da etapa" : `lead ficar parado na etapa por ${t.days} dia${t.days > 1 ? "s" : ""}`;
    case "sem_retorno_cliente_dias": return `cliente não responder por ${t.days} dia${t.days > 1 ? "s" : ""}`;
    case "aniversario_em_dias": return `faltar ${t.days} dia${t.days === 1 ? "" : "s"} para o aniversário`;
    case "data_cobranca": return "chegar a data de cobrança";
    case "data_recontato": return "chegar a data de recontato";
    case "agendamento_em_horas": return `faltar ${t.hours} h para o agendamento`;
  }
};
const describeAction = (a: Action, stages: StageOpt[]) =>
  a.type === "mover_para_etapa" ? `mover para ${stages.find((s) => s.key === a.stage)?.name ?? a.stage}` : a.type === "mover_para_proximo_followup" ? "mover para o próximo follow-up" : a.type === "alertar_gestao" ? "avisar a gestão" : a.type === "escalar_gestao" ? "escalar o alerta para a gestão" : a.type === "enviar_mensagem" ? "enviar mensagem à cliente" : "alertar quem é responsável";

const GROUPS: { title: string; hint: string; types: Trigger["type"][]; icon: "clock" | "flow" | "cal" }[] = [
  { title: "Atendimento", hint: "prazos de resposta e leads parados", types: ["sem_resposta_minutos", "parado_dias"], icon: "clock" },
  { title: "Follow-up", hint: "quando a cliente para de responder", types: ["sem_retorno_cliente_dias"], icon: "flow" },
  { title: "Datas", hint: "agendamento, aniversário, cobrança e recontato", types: ["agendamento_em_horas", "aniversario_em_dias", "data_cobranca", "data_recontato"], icon: "cal" },
];

export function AutomationsList({ items, stages, runs }: { items: Item[]; stages: StageOpt[]; runs: Record<string, number> }) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [, start] = useTransition(); const toast = useToast();
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-graphite max-w-[60ch]">Regras que o CRM roda sozinho a cada minuto. Ligue, desligue ou edite: cada mudança fica guardada e dá para voltar à versão anterior.</p>
        <Button size="sm" className="h-9 shrink-0" onClick={() => setEditing("new")}><IconPlus size={16} />Nova automação</Button>
      </div>
      {GROUPS.map((g) => { const list = items.filter((a) => g.types.includes((a.trigger as Trigger).type)); if (!list.length) return null; return (
      <section key={g.title} className="mb-7">
      <h3 className="flex items-baseline gap-2 mb-2.5"><span className="font-serif text-[20px]">{g.title}</span><span className="text-sm text-muted">{g.hint}</span></h3>
      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {list.map((a, i) => {
            const t = a.trigger as Trigger; const conds = a.conditions as { type: "etapa_em"; stages: string[] }[]; const acts = a.actions as Action[];
            return (
              <motion.li key={a.id} layout transition={SPRING} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }} exit={{ opacity: 0 }}
                className={`rounded-[var(--radius-card)] border bg-paper p-4 lg:p-5 flex gap-4 items-start transition-colors ${a.enabled ? "border-line" : "border-line opacity-70"}`}>
                <span className={`size-9 shrink-0 rounded-[var(--radius-control)] grid place-items-center ${a.enabled ? "bg-gold-soft text-gold-ink" : "bg-paper-2 text-muted"}`}>
                  {t.type === "sem_resposta_minutos" || t.type === "parado_dias" ? <IconClock size={17} /> : t.type === "sem_retorno_cliente_dias" ? <IconRefresh size={17} /> : t.type === "aniversario_em_dias" ? <IconCake size={17} /> : t.type === "data_cobranca" ? <IconMoney size={17} /> : <IconCalendar size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-base">{a.name}</p>
                  <p className="text-sm text-graphite mt-1 leading-relaxed">
                    <b className="text-gold-ink font-semibold">Quando</b> {describeTrigger(t)}
                    {conds[0]?.stages?.length ? <> <b className="text-gold-ink font-semibold">· Se</b> estiver em {conds[0].stages.map((k) => stages.find((s) => s.key === k)?.name ?? k).join(", ")}</> : null}
                    {" "}<b className="text-gold-ink font-semibold">· Então</b> {acts.map((x) => describeAction(x, stages)).join(" e ")}
                  </p>
                  <p className="text-xs text-muted mt-1.5">{runs[a.id] ? <b className="text-graphite font-semibold">Disparou {runs[a.id]}× nos últimos 7 dias · </b> : "Não disparou nos últimos 7 dias · "}versão {a.version}, alterada {relTime(a.updatedAt)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button className="text-sm text-graphite hover:text-ink underline-offset-2 hover:underline" onClick={() => setEditing(a)}>Editar</button>
                  <Switch checked={a.enabled} label={`${a.enabled ? "Desligar" : "Ligar"} ${a.name}`} onChange={(v) => start(async () => { const r = await toggleAutomationAction(a.id, v); toast(r.ok ? (v ? "Automação ligada" : "Automação desligada") : r.error, r.ok ? "ok" : "error"); })} />
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      </section>); })}
      <Editor key={editing === "new" ? "new" : editing?.id ?? "none"} item={editing} stages={stages} onClose={() => setEditing(null)} />
    </div>
  );
}

function Editor({ item, stages, onClose }: { item: Item | "new" | null; stages: StageOpt[]; onClose: () => void }) {
  const isNew = item === "new";
  const init: AutomationInput = item && item !== "new"
    ? { name: item.name, enabled: item.enabled, trigger: item.trigger as Trigger, conditions: item.conditions as AutomationInput["conditions"], actions: item.actions as Action[] }
    : { name: "", enabled: true, trigger: { type: "sem_resposta_minutos", minutes: 5 }, conditions: [{ type: "etapa_em", stages: ["lead"] }], actions: [{ type: "alertar_responsavel", message: "{nome} está esperando há {minutos} min" }] };
  const [v, setV] = useState<AutomationInput>(init);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [details, setDetails] = useState<{ versions: { version: number; createdAt: string; user: string | null }[]; runs: { createdAt: string; name: string | null; phone: string | null; result: { acoes?: string[] } }[] } | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const [confirmDel, setConfirmDel] = useState(false);
  const open = item !== null;
  const stagesSel = v.conditions[0]?.stages ?? [];
  const unit = unitOf(v.trigger.type);
  const amount = "minutes" in v.trigger ? v.trigger.minutes : "hours" in v.trigger ? v.trigger.hours : "days" in v.trigger ? v.trigger.days : 0;
  const stageBased = (v.trigger.type === "sem_resposta_minutos" && !!v.trigger.useStageSla) || (v.trigger.type === "parado_dias" && !!v.trigger.useStageLimit);

  const setTrigger = (type: Trigger["type"], n?: number) => {
    const u = unitOf(type); const val = n ?? (u === "minutos" ? 5 : u === "horas" ? 24 : u === "dias" ? 1 : 0);
    // "Escalar para a gestão" só existe para lead sem resposta: ao trocar o gatilho vira um aviso à gestão comum.
    const actions = type === "sem_resposta_minutos" ? v.actions
      : v.actions.map((a): Action => (a.type === "escalar_gestao" ? { type: "alertar_gestao", message: "Atenção: {nome}" } : a));
    setV({ ...v, actions, trigger: (u === "minutos" ? { type, minutes: val } : u === "horas" ? { type, hours: val } : u === "dias" ? { type, days: val } : { type }) as Trigger });
  };
  const setAction = (i: number, a: Action) => setV({ ...v, actions: v.actions.map((x, j) => (j === i ? a : x)) });
  const newAction = (type: Action["type"]): Action => type === "mover_para_etapa" ? { type, stage: "atendimento" } : type === "mover_para_proximo_followup" || type === "escalar_gestao" ? { type }
    : { type, message: type === "alertar_gestao" ? "Atenção: {nome}" : type === "enviar_mensagem" ? "Oi, {nome}! " : "Hora de falar com {nome}" };

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? "Nova automação" : "Editar automação"} width={640}
      footer={<>
        {!isNew && (confirmDel
          ? <span className="mr-auto flex items-center gap-2 text-sm">Apagar de vez?<Button size="sm" variant="danger" onClick={() => start(async () => { const r = await deleteAutomationAction((item as Item).id); if (r.ok) { toast("Automação apagada"); onClose(); } else toast(r.error, "error"); })}>Apagar</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>Não</Button></span>
          : <Button variant="ghost" className="mr-auto text-alert hover:bg-alert-soft" onClick={() => setConfirmDel(true)}>Apagar</Button>)}
        <Button variant="secondary" onClick={() => start(async () => { const r = await previewAutomationAction(v); setPreview(r.ok ? `Agora, ${r.data!.count} lead${r.data!.count === 1 ? "" : "s"} se encaixa${r.data!.count === 1 ? "" : "m"} nesta regra${r.data!.sample.length ? `: ${r.data!.sample.join(", ")}` : ""}.` : r.error); })}>Testar</Button>
        <Button onClick={() => start(async () => { const r = await saveAutomationAction(isNew ? null : (item as Item).id, v); if (r.ok) { toast("Automação salva"); onClose(); } else setErr(r.error); })} loading={pending}>Salvar</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <label className="block"><span className="text-sm font-medium text-graphite">Nome</span>
          <Input className="mt-1.5" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ex.: Lead sem resposta em 5 minutos" /></label>
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
        </Block>
        <Block label="Se (opcional)">
          <p className="text-sm text-muted mb-2">Só vale para leads nestas etapas. Nenhuma marcada = todas.</p>
          <div className="flex flex-wrap gap-1.5">
            {stages.map((s) => {
              const on = stagesSel.includes(s.key);
              return <button key={s.key} type="button" aria-pressed={on} onClick={() => { const next = on ? stagesSel.filter((k) => k !== s.key) : [...stagesSel, s.key]; setV({ ...v, conditions: next.length ? [{ type: "etapa_em", stages: next }] : [] }); }}
                className={`h-8 px-3 rounded-full text-sm border transition-colors ${on ? "bg-ink text-paper border-ink" : "border-line-strong hover:bg-paper-2"}`}>{s.name}</button>;
            })}
          </div>
        </Block>
        <Block label="Então">
          <div className="flex flex-col gap-2">
            {v.actions.map((a, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center">
                <Select className="w-auto" value={a.type} onChange={(e) => setAction(i, newAction(e.target.value as Action["type"]))}>
                  {Object.entries(ACTION_LABELS).filter(([k]) => k !== "escalar_gestao" || v.trigger.type === "sem_resposta_minutos").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                {"message" in a && (a.type === "enviar_mensagem"
                  ? <textarea className="flex-1 min-w-[220px] rounded-[var(--radius-control)] border border-control/70 px-3 py-2 text-base min-h-20" value={a.message} onChange={(e) => setAction(i, { ...a, message: e.target.value })} aria-label="Texto da mensagem" />
                  : <Input className="flex-1 min-w-[220px]" value={a.message} onChange={(e) => setAction(i, { ...a, message: e.target.value })} />)}
                {a.type === "mover_para_etapa" && <Select className="w-auto" value={a.stage} onChange={(e) => setAction(i, { ...a, stage: e.target.value })}>{stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>}
                {v.actions.length > 1 && <button type="button" aria-label="Remover ação" onClick={() => setV({ ...v, actions: v.actions.filter((_, j) => j !== i) })} className="size-8 grid place-items-center rounded-[8px] text-muted hover:bg-paper-2"><IconClose size={14} /></button>}
              </div>
            ))}
            {v.actions.length < 4 && <button type="button" onClick={() => setV({ ...v, actions: [...v.actions, newAction("alertar_responsavel")] })} className="self-start text-sm text-gold-ink hover:underline">+ Adicionar ação</button>}
            <p className="text-xs text-muted">Nas mensagens você pode usar {"{nome}"}, {"{etapa}"}, {"{minutos}"}, {"{dias}"} e, em agendamentos, {"{data}"} e {"{hora}"}.</p>
            {v.actions.some((x) => x.type === "enviar_mensagem") && <p className="text-sm bg-gold-soft text-gold-ink rounded-[var(--radius-control)] px-3 py-2">Esta automação manda mensagem de verdade para as clientes, pelo número da conversa, só no horário de atendimento. Revise o texto antes de ligar.</p>}
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
                    <li key={x.version} className="flex justify-between gap-2"><span>v{x.version} · {relTime(x.createdAt)}{x.user ? ` · ${x.user.split(" ")[0]}` : ""}</span>
                      {x.version !== (item as Item).version && <button className="text-gold-ink hover:underline" onClick={() => start(async () => { const r = await restoreAutomationAction((item as Item).id, x.version); if (r.ok) { toast(`Voltou para a versão ${x.version}`); onClose(); } else toast(r.error, "error"); })}>Voltar a esta</button>}</li>
                  ))}{details.versions.length === 0 && <li className="text-muted">Versão original (nunca editada).</li>}</ul>
                </div>
                <div><p className="font-semibold mb-1.5">Últimas execuções</p>
                  <ul className="flex flex-col gap-1">{details.runs.map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{r.name ?? r.phone ?? "—"}</span><span className="text-muted shrink-0">{relTime(r.createdAt)}</span></li>)}
                    {details.runs.length === 0 && <li className="text-muted">Ainda não disparou.</li>}</ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid sm:grid-cols-[72px_1fr] gap-2 sm:gap-4"><p className="font-serif text-[18px] text-gold-ink pt-1.5">{label}</p><div>{children}</div></div>;
}
