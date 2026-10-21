"use client";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { confirmCampaignAction, createCampaignAction, previewAudienceAction, type AudienceInput } from "@/app/(app)/contatos/massa-actions";
import { dueLabel } from "@/lib/next-action";

type Preview = { found: number; eligible: number; tooMany: boolean; excluded: { reason: string; label: string; n: number }[]; sample: { id: string; name: string | null; phone: string }[] };
const GAPS = [[120, "2 min"], [180, "3 min (recomendado)"], [300, "5 min"], [600, "10 min"]] as const;

/** Três passos: quem recebe (com quem fica de fora e por quê) → a mensagem → confirmação dupla (risco + digitar o total). */
export function MassMessageSheet({ open, onClose, audience, tags, summary }: { open: boolean; onClose: () => void; audience: AudienceInput; tags: string[]; summary: string }) {
  const [step, setStep] = useState<"quem" | "mensagem" | "confirmar">("quem");
  const [tag, setTag] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState(""); const [body, setBody] = useState(""); const [gap, setGap] = useState(180);
  const [created, setCreated] = useState<{ id: string; total: number } | null>(null);
  const [risk, setRisk] = useState(false); const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const aud: AudienceInput = audience.contactIds ? { contactIds: audience.contactIds } : { ...audience, tag: tag || null };
  const check = () => start(async () => { setError(null); const r = await previewAudienceAction(aud); if (r.ok) setPreview(r.data!); else setError(r.error); });
  const create = () => start(async () => {
    setError(null);
    const r = await createCampaignAction({ name, body, audience: aud, intervalSeconds: gap });
    if (!r.ok) { setError(r.error); return; }
    setCreated(r.data!); setStep("confirmar");
  });
  const confirm = () => created && start(async () => {
    setError(null);
    const r = await confirmCampaignAction(created.id, { typedTotal: Number(typed), acceptRisk: risk });
    if (!r.ok) { setError(r.error); return; }
    toast(`Confirmada: começa ${dueLabel(Date.parse(r.data!.startAt), Date.now())}, uma a cada ${Math.round(gap / 60)} min, só com a Casa aberta.`, "ok");
    onClose();
  });
  const canConfirm = !!created && risk && Number(typed) === created.total;
  return (
    <Sheet open={open} onClose={onClose} title="Mensagem em massa"
      footer={step === "quem" ? <Button onClick={() => setStep("mensagem")} disabled={!preview || preview.eligible === 0 || preview.tooMany}>Continuar</Button>
        : step === "mensagem" ? <><Button variant="ghost" onClick={() => setStep("quem")}>Voltar</Button><Button onClick={create} loading={pending} disabled={!name.trim() || !body.trim()}>Revisar</Button></>
        : <Button onClick={confirm} loading={pending} disabled={!canConfirm}>Confirmar envio</Button>}>
      <div className="flex flex-col gap-4 text-sm">
        {step === "quem" && (
          <>
            <p className="text-graphite">Filtro: {summary}</p>
            {!audience.contactIds && tags.length > 0 && (
              <Field label="Só quem tem a etiqueta" htmlFor="massa-tag">
                <Select id="massa-tag" value={tag} onChange={(e) => { setTag(e.target.value); setPreview(null); }}>
                  <option value="">Qualquer etiqueta</option>
                  {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
            )}
            <Button variant="secondary" onClick={check} loading={pending}>Ver quem recebe</Button>
            {preview && (
              <div className="rounded-[var(--radius-card)] border border-line bg-paper-2 p-3">
                <p className="font-display text-lg">{preview.eligible} vão receber</p>
                {preview.tooMany && <p className="text-alert">No máximo 300 por vez. Filtre mais.</p>}
                {preview.excluded.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-graphite">{preview.excluded.map((e) => <li key={e.reason}>{e.n} {e.label}</li>)}</ul>
                )}
                {preview.sample.length > 0 && <p className="mt-2 text-muted">Ex.: {preview.sample.map((s) => s.name ?? s.phone).join(", ")}</p>}
              </div>
            )}
          </>
        )}
        {step === "mensagem" && (
          <>
            <Field label="Nome (só a equipe vê)" htmlFor="massa-nome"><Input id="massa-nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Retorno de outubro" /></Field>
            <Field label="Mensagem" htmlFor="massa-texto" hint="Vale {primeiro_nome} e {saudacao}. Vai sem assinatura de pessoa, como mensagem da Casa.">
              <Textarea id="massa-texto" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
            </Field>
            <Field label="Intervalo entre uma e outra" htmlFor="massa-intervalo" hint="Mais devagar protege o número contra bloqueio.">
              <Select id="massa-intervalo" value={gap} onChange={(e) => setGap(Number(e.target.value))}>
                {GAPS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
              </Select>
            </Field>
          </>
        )}
        {step === "confirmar" && created && (
          <>
            <p><b className="font-semibold">{created.total} clientes</b> vão receber “{name}”, uma a cada {Math.round(gap / 60)} min, só com a Casa aberta e no máximo 150 por dia.</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} className="mt-0.5 size-4" />
              <span>Entendo que o WhatsApp pode bloquear o número se as clientes denunciarem a mensagem.</span>
            </label>
            <Field label={`Digite ${created.total} para confirmar`} htmlFor="massa-total">
              <Input id="massa-total" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </>
        )}
        {error && <p role="alert" className="text-alert">{error}</p>}
      </div>
    </Sheet>
  );
}

/** Botão do topo de Contatos (só aparece com a chave ligada e a permissão). */
export function MassMessageButton({ audience, tags, summary }: { audience: AudienceInput; tags: string[]; summary: string }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <Button size="sm" variant="secondary" className="h-9" onClick={() => { setN((x) => x + 1); setOpen(true); }}>Mensagem em massa</Button>
      <MassMessageSheet key={n} open={open} onClose={() => setOpen(false)} audience={audience} tags={tags} summary={summary} />
    </>
  );
}
