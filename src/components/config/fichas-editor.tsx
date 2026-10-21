"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { SectionTabs } from "@/components/shell/section-tabs";
import { cn } from "@/lib/cn";
import { FICHA_FORMS, FICHA_FORM_LABEL, QUESTION_KINDS, QUESTION_KIND_LABEL, QUESTION_LABEL_MAX, hasOptions, type FichaForm, type QuestionKind } from "@/lib/fichas";
import { moveQuestionAction, saveQuestionAction, setQuestionActiveAction } from "@/app/(app)/config/fichas/actions";

type Question = { id: string; label: string; kind: QuestionKind; options: string[]; active: boolean; answered?: boolean };
const OFF = "Essa função está desligada em Configurações › Recursos. As respostas que já foram dadas continuam guardadas.";
const INTRO: Record<FichaForm, string> = {
  anamnese: "As perguntas que a cliente responde uma vez, na ficha dela.",
  consultoria: "As perguntas da conversa sobre a imagem da cliente. Cada visita tem as suas respostas.",
  campos: "Os campos extras que a Casa quer anotar de cada cliente.",
};

/**
 * Configurações › Clientes › Fichas da cliente: a lista de perguntas de cada ficha, com subir, descer, editar (texto, tipo, opções uma por linha),
 * tirar de uso e "Nova pergunta". Não existe apagar: a pergunta tirada de uso some do preenchimento, mas a resposta antiga fica na ficha.
 */
export function FichasEditor({ form, questions, fichasOn }: { form: FichaForm; questions: Question[]; fichasOn: boolean }) {
  const [editing, setEditing] = useState<Question | "new" | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <SectionTabs label="Fichas" tabs={FICHA_FORMS.map((f) => ({ key: f, label: FICHA_FORM_LABEL[f], href: `/config/fichas?ficha=${f}` }))} current={form} />
      <section className="rounded-[var(--radius-card)] border border-line bg-paper" aria-labelledby="fichas-titulo">
        <div className="px-5 pt-5">
          <h2 id="fichas-titulo" className="text-lg font-semibold">{FICHA_FORM_LABEL[form]}</h2>
          <p className="mt-1 max-w-[62ch] text-sm text-graphite">{INTRO[form]} Tirar de uso esconde a pergunta do preenchimento, mas não apaga o que já foi respondido.</p>
          {!fichasOn && <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{OFF}</p>}
        </div>
        <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
          {questions.map((q, i) => <li key={q.id}><Row q={q} first={i === 0} last={i === questions.length - 1} on={fichasOn} onEdit={() => setEditing(q)} /></li>)}
          {questions.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nenhuma pergunta nesta ficha ainda.</li>}
        </ul>
        <div className="border-t border-line/70 px-5 py-4">
          <Button onClick={() => setEditing("new")} disabled={!fichasOn}>Nova pergunta</Button>
        </div>
      </section>
      {editing && <QuestionDialog key={editing === "new" ? "new" : editing.id} form={form} q={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Row({ q, first, last, on, onEdit }: { q: Question; first: boolean; last: boolean; on: boolean; onEdit: () => void }) {
  const [active, setActive] = useState(q.active);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const move = (dir: "up" | "down") => start(async () => {
    const r = await moveQuestionAction(q.id, dir);
    if (!r.ok) { toast(r.error, "error"); return; }
    router.refresh();
  });
  const toggle = (v: boolean) => { setActive(v); start(async () => {
    const r = await setQuestionActiveAction(q.id, v);
    if (!r.ok) { toast(r.error, "error"); setActive(!v); return; }
    toast(v ? "Pergunta em uso" : "Pergunta fora de uso"); router.refresh();
  }); };
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", !active && "bg-paper-2/40")}>
      <div className="min-w-[14rem] flex-1">
        <p className={cn("text-sm text-ink", !active && "text-muted")}>{q.label}</p>
        <p className="mt-0.5 text-xs text-muted">{QUESTION_KIND_LABEL[q.kind]}{q.options.length ? `: ${q.options.join(", ")}` : ""}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" aria-label={`Subir ${q.label}`} disabled={!on || pending || first} onClick={() => move("up")}>Subir</Button>
        <Button variant="ghost" size="sm" aria-label={`Descer ${q.label}`} disabled={!on || pending || last} onClick={() => move("down")}>Descer</Button>
        <Button variant="secondary" size="sm" aria-label={`Editar ${q.label}`} disabled={!on || pending} onClick={onEdit}>Editar</Button>
      </div>
      <Switch checked={active} label={`${active ? "Tirar de uso" : "Pôr em uso"}: ${q.label}`} disabled={!on || pending} onChange={toggle} />
    </div>
  );
}

function QuestionDialog({ form, q, onClose }: { form: FichaForm; q: Question | null; onClose: () => void }) {
  const [label, setLabel] = useState(q?.label ?? "");
  const [kind, setKind] = useState<QuestionKind>(q?.kind ?? "texto");
  const [options, setOptions] = useState((q?.options ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const locked = !!q?.answered;
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const submit = () => start(async () => {
    const r = await saveQuestionAction({ id: q?.id, form, label, kind, options: hasOptions(kind) ? options.split("\n") : [] });
    if (!r.ok) { setError(r.error); return; }
    toast(q ? "Pergunta salva" : "Pergunta criada"); router.refresh(); onClose();
  });
  return (
    <Dialog open onClose={onClose} title={q ? "Editar pergunta" : "Nova pergunta"} width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={pending} disabled={!label.trim()} onClick={submit}>Salvar</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Pergunta" htmlFor="fq-label"><Input id="fq-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={QUESTION_LABEL_MAX} /></Field>
        <Field label="Tipo de resposta" htmlFor="fq-kind" hint={locked ? "Essa pergunta já tem respostas. Crie uma nova e tire esta de uso." : undefined}>
          <Select id="fq-kind" value={kind} disabled={locked} onChange={(e) => setKind(e.target.value as QuestionKind)}>
            {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        {hasOptions(kind) && (
          <Field label="Opções" htmlFor="fq-options" hint="Escreva uma opção por linha.">
            <Textarea id="fq-options" value={options} onChange={(e) => setOptions(e.target.value)} rows={6} />
          </Field>
        )}
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
