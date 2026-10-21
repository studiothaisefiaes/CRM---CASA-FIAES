"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addClientPhotoAction, removeClientPhotoAction, saveFichaAnswerAction } from "@/app/(app)/contatos/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { Card } from "./blocks";
import { AnswerInput } from "./answer-input";
import { brDay } from "@/lib/client-avec";
import { PHOTO_KIND_LABEL, type ClientPhotoItem, type PhotoKind } from "@/lib/client-photos";
import { answerText, blankAnswer, progress, sameAnswer, type ConsultoriaVisit, type StepQuestion } from "@/lib/ficha-view";
import type { AnswerValue } from "@/lib/fichas";

export type ConsultoriaProps = {
  contactId: string;
  /** As perguntas da anamnese em uso, com a resposta da cliente. */ anamnese: StepQuestion[];
  /** As consultorias por visita, a mais nova primeiro. */ visits: ConsultoriaVisit[];
  /** A visita que "Nova" abre (a de hoje ou a última); null se a cliente ainda não tem visita. */ newVisitId: string | null;
  /** Fotos de antes e depois; null com a função "fotos" desligada. */ photos: ClientPhotoItem[] | null;
  can: { answer: boolean; addPhoto: boolean; removePhoto: boolean };
  /** Tamanho máximo da foto em MB (Configurações): conferido na tela antes de enviar; o servidor confere de novo. */ maxMb?: number;
};

const NOTE = "text-sm text-graphite";

/**
 * A aba Consultoria da ficha: a Anamnese (resumo e preenchimento em passos), a Consultoria de imagem por visita (‹ › entre as visitas,
 * "Ver a última", "Nova") e as Fotos de antes e depois. Dado da cliente: só chega aqui para quem tem fichas.ver.
 */
export function ConsultoriaTab({ contactId, anamnese, visits, newVisitId, photos, can, maxMb = 5 }: ConsultoriaProps) {
  const [steps, setSteps] = useState<{ title: string; questions: StepQuestion[]; visitId?: string } | null>(null);
  const [idx, setIdx] = useState(0);
  const { answered, total } = progress(anamnese);
  const first = (qs: StepQuestion[]) => Math.max(0, qs.findIndex((q) => blankAnswer(q.value)));
  const visit = visits[idx] ?? null;
  const fresh = visits.find((v) => v.visitId === newVisitId) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Card id="anamnese" title="Anamnese">
        {total === 0 ? <p className={NOTE}>Nenhuma pergunta de anamnese em uso. Elas ficam em Configurações › Fichas da cliente.</p> : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="tabular text-base font-semibold text-ink">{`${answered} de ${total} respondidas`}</p>
            {can.answer && <Button size="sm" onClick={() => setSteps({ title: "Anamnese", questions: anamnese })}>{answered > 0 ? "Continuar" : "Preencher"}</Button>}
          </div>
        )}
        {steps?.title === "Anamnese" && <AnswerSteps key="anamnese" contactId={contactId} title="Anamnese" questions={anamnese} startAt={answered > 0 ? first(anamnese) : 0} onClose={() => setSteps(null)} />}
      </Card>

      <Card id="consultoria-visita" title="Consultoria de imagem" extra={(visits.length > 1 || can.answer) ? (
        <span className="flex gap-2">
          {visits.length > 1 && <Button size="sm" variant="ghost" onClick={() => setIdx(0)}>Ver a última</Button>}
          {can.answer && <Button size="sm" disabled={!fresh} onClick={() => { if (fresh) { setIdx(visits.indexOf(fresh)); setSteps({ title: "Consultoria de imagem", questions: fresh.fill, visitId: fresh.visitId }); } }}>Nova</Button>}
        </span>
      ) : undefined}>
        {!newVisitId && <p className={NOTE}>A cliente ainda não tem visita: a consultoria é feita em uma visita.</p>}
        {visit ? (
          <div className="mt-1 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="secondary" aria-label="Visita anterior" disabled={idx >= visits.length - 1} onClick={() => setIdx(idx + 1)}>‹</Button>
              <p className="text-center text-sm font-semibold text-ink"><span className="tabular">Visita de {brDay(visit.day)}</span><span className="ml-2 font-normal text-muted tabular">{idx + 1} de {visits.length}</span></p>
              <Button size="sm" variant="secondary" aria-label="Visita seguinte" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>›</Button>
            </div>
            {visit.answered.length === 0 ? <p className={NOTE}>Nada respondido nesta visita ainda.</p> : (
              <dl className="flex flex-col divide-y divide-line/70">
                {visit.answered.map((a) => (
                  <div key={a.label} className="py-2"><dt className="text-sm text-graphite">{a.label}</dt><dd className="mt-0.5 whitespace-pre-line break-words text-sm font-medium text-ink">{answerText(a.value, a.kind)}</dd></div>
                ))}
              </dl>
            )}
            {can.answer && visit.fill.length > 0 && (
              <div><Button size="sm" variant="secondary" onClick={() => setSteps({ title: "Consultoria de imagem", questions: visit.fill, visitId: visit.visitId })}>Editar esta visita</Button></div>
            )}
          </div>
        ) : <p className={`${NOTE} mt-1`}>Nenhuma consultoria de imagem ainda.</p>}
        {steps?.title === "Consultoria de imagem" && (
          <AnswerSteps key={`c-${steps.visitId}`} contactId={contactId} title="Consultoria de imagem" visitId={steps.visitId} questions={steps.questions} startAt={first(steps.questions)} onClose={() => setSteps(null)} />
        )}
      </Card>

      {photos && <PhotosSection contactId={contactId} photos={photos} visits={visits} defaultVisitId={newVisitId} can={can} maxMb={maxMb} />}
    </div>
  );
}

/**
 * O preenchimento em passos: UMA pergunta por tela, com Anterior, Pular e Próxima. A resposta é salva ao avançar (só se mudou);
 * se o servidor recusar, a tela fica na pergunta e mostra o motivo.
 */
export function AnswerSteps({ contactId, title, questions, visitId, startAt, onClose }: {
  contactId: string; title: string; questions: StepQuestion[]; visitId?: string; startAt: number; onClose: () => void;
}) {
  const router = useRouter();
  const [i, setI] = useState(Math.min(startAt, Math.max(0, questions.length - 1)));
  const [values, setValues] = useState<Record<string, AnswerValue | null>>(() => Object.fromEntries(questions.map((q) => [q.id, q.value])));
  const saved = useRef<Record<string, AnswerValue | null>>(Object.fromEntries(questions.map((q) => [q.id, q.value])));
  const touched = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const q = questions[i];
  const last = i === questions.length - 1;
  const close = () => { if (touched.current) router.refresh(); onClose(); };
  if (!q) return null;
  const go = (to: number) => { setError(null); if (to >= questions.length) close(); else setI(Math.max(0, to)); };
  const next = () => start(async () => {
    const v = values[q.id] ?? null;
    if (!sameAnswer(v, saved.current[q.id])) {
      const r = await saveFichaAnswerAction({ contactId, questionId: q.id, ...(visitId ? { visitId } : {}), value: blankAnswer(v) ? null : v });
      if (!r.ok) { setError(r.error); return; }
      saved.current[q.id] = v; touched.current = true;
    }
    go(i + 1);
  });
  return (
    <Dialog open onClose={close} title={title} width={520} description={<span>{`Pergunta ${i + 1} de ${questions.length}`}</span>}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" disabled={pending || i === 0} onClick={() => go(i - 1)}>Anterior</Button>
          <span className="flex gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => { setValues((v) => ({ ...v, [q.id]: saved.current[q.id] ?? null })); go(i + 1); }}>Pular</Button>
            <Button loading={pending} onClick={next}>{last ? "Concluir" : "Próxima"}</Button>
          </span>
        </div>
      }>
      <div key={q.id} className="flex flex-col gap-3">
        <AnswerInput q={q} value={values[q.id] ?? null} onChange={(v) => { setValues((s) => ({ ...s, [q.id]: v })); setError(null); }} disabled={pending} />
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}

const dayOf = (v: { day: string | null }) => (v.day ? `Visita de ${brDay(v.day)}` : "Sem visita");
const PHOTO_KINDS_OPTIONS = (["antes", "depois"] as const).map((k) => ({ value: k, label: PHOTO_KIND_LABEL[k] }));

/** Fotos de antes e depois, agrupadas por visita. Foto real (câmera ou arquivo), guardada como veio: sem recorte, filtro ou edição. */
function PhotosSection({ contactId, photos, visits, defaultVisitId, can, maxMb }: {
  contactId: string; photos: ClientPhotoItem[]; visits: ConsultoriaVisit[]; defaultVisitId: string | null; can: ConsultoriaProps["can"]; maxMb: number;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ClientPhotoItem | null>(null);
  const groups = [...new Set(photos.map((p) => p.visitId))]
    .map((vid) => ({ vid, day: photos.find((p) => p.visitId === vid)!.day, items: photos.filter((p) => p.visitId === vid) }))
    .sort((a, b) => (a.day && b.day ? (a.day < b.day ? 1 : -1) : a.day ? -1 : b.day ? 1 : 0));
  return (
    <Card id="fotos" title="Fotos de antes e depois" extra={can.addPhoto ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Adicionar foto</Button> : undefined}>
      {groups.length === 0 ? <p className={NOTE}>Nenhuma foto ainda.</p> : (
        <div className="mt-1 flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.vid ?? "sem"} aria-label={dayOf(g)}>
              <h3 className="text-sm font-semibold text-graphite">{dayOf(g)}</h3>
              <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {g.items.map((p) => (
                  <li key={p.id} className="flex min-w-0 flex-col gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- foto protegida (sessão + fichas.ver), sem otimização de imagem */}
                    <img src={p.url} alt={`${PHOTO_KIND_LABEL[p.kind]}, ${p.day ? `visita de ${brDay(p.day)}` : "sem visita"}`} loading="lazy"
                      className="aspect-[3/4] w-full rounded-[var(--radius-control)] border border-line bg-paper-2 object-cover" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{PHOTO_KIND_LABEL[p.kind]}</span>
                      {can.removePhoto && <Button size="sm" variant="ghost" aria-label={`Apagar foto de ${p.kind}${p.day ? ` de ${brDay(p.day)}` : ""}`} onClick={() => setRemoving(p)}>Apagar</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {adding && <AddPhotoDialog contactId={contactId} visits={visits} defaultVisitId={defaultVisitId} maxMb={maxMb} onClose={() => setAdding(false)} />}
      {removing && <RemovePhotoDialog photo={removing} onClose={() => setRemoving(null)} />}
    </Card>
  );
}

function AddPhotoDialog({ contactId, visits, defaultVisitId, maxMb, onClose }: { contactId: string; visits: ConsultoriaVisit[]; defaultVisitId: string | null; maxMb: number; onClose: () => void }) {
  const toast = useToast(); const router = useRouter();
  const [kind, setKind] = useState<PhotoKind>("antes");
  const [visitId, setVisitId] = useState(defaultVisitId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    if (!file) { setError("Escolha uma foto."); return; }
    if (file.size > maxMb * 1024 * 1024) { setError(`A foto passa de ${maxMb} MB. Escolha uma menor.`); return; }
    const fd = new FormData();
    fd.set("contactId", contactId); fd.set("kind", kind); fd.set("visitId", visitId); fd.set("photo", file);
    try {
      const r = await addClientPhotoAction(fd);
      if (!r.ok) { setError(r.error); return; }
      toast("Foto guardada na ficha"); router.refresh(); onClose();
    } catch { setError("Não foi possível enviar a foto. Confira a conexão e o tamanho do arquivo e tente de novo."); }
  });
  return (
    <Dialog open onClose={onClose} title="Adicionar foto" width={460} description="Tire a foto agora ou escolha um arquivo. Ela é guardada como veio, sem recorte nem filtro."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={pending} disabled={!file} onClick={send}>Enviar</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="foto-tipo" className="text-sm font-medium text-graphite">Tipo da foto</span>
          <Segmented options={PHOTO_KINDS_OPTIONS} value={kind} onChange={setKind} labelledBy="foto-tipo" />
        </div>
        <Field label="Visita" htmlFor="foto-visita">
          <Select id="foto-visita" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
            <option value="">Sem visita</option>
            {visits.map((v) => <option key={v.visitId} value={v.visitId}>{brDay(v.day)}</option>)}
          </Select>
        </Field>
        <Field label="Tirar foto" htmlFor="foto-camera" hint="Abre a câmera do aparelho.">
          <input id="foto-camera" type="file" accept="image/*" capture="environment" className="min-h-11 text-sm"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
        </Field>
        <Field label="Escolher arquivo" htmlFor="foto-arquivo" hint={file ? `Escolhida: ${file.name}` : "Uma foto que já está no aparelho."}>
          <input id="foto-arquivo" type="file" accept="image/*" className="min-h-11 text-sm"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
        </Field>
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}

function RemovePhotoDialog({ photo, onClose }: { photo: ClientPhotoItem; onClose: () => void }) {
  const toast = useToast(); const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const remove = () => start(async () => {
    const r = await removeClientPhotoAction(photo.id);
    if (!r.ok) { setError(r.error); return; }
    toast("Foto apagada da ficha"); router.refresh(); onClose();
  });
  return (
    <Dialog open onClose={onClose} title="Apagar esta foto?" width={420} description="Ela some da ficha da cliente."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={pending} onClick={remove}>Apagar</Button></>}>
      {error ? <p role="alert" className="text-sm text-alert">{error}</p> : null}
    </Dialog>
  );
}
