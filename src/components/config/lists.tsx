"use client";
import { useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { addListItemAction, setKeywordBoostAction, updateListItemAction } from "@/app/(app)/config/actions";
import { attachQuickReplyFileAction, detachQuickReplyFileAction, setQuickReplyFolderAction } from "@/app/(app)/config/respostas/actions";
import { createQuickReplyAction, makeQuickReplyUniversalAction } from "@/app/(app)/conversa/actions";
import { VarButtons } from "@/components/lead/var-buttons";
import { renderReply, type ReplyVars } from "@/lib/quick-reply";
import { SPRING_UI } from "@/lib/motion";

type Item = { id: string; kind: "objection" | "lost_reason" | "quick_reply" | "origin" | "service" | "keyword"; label: string; body: string | null; active: boolean; cycleDays: number | null; boost?: boolean;
  /** Serviços: preço (centavos), duração e folga depois (min) e categoria; null = não informado. */ priceCents?: number | null; durationMin?: number | null; category?: string | null; bufferMin?: number | null;
  /** Respostas prontas: anexo (Lote 5); a pasta usa `category`. */ attachment?: { name: string; kind: string } | null;
  /** Resposta pronta pessoal: nome de quem criou (só ela vê). null/ausente = universal. */ ownerName?: string | null };
/** Dados de exemplo da prévia em Configurações (na conversa, a prévia usa os dados da cliente). */
const EXEMPLO: ReplyVars = { primeiroNome: "Ana", dataHorario: "qui 22/10 às 15:00", profissional: "Paula", servico: "Corte", meuNome: "Joana" };
const TABS = [["quick_reply", "Respostas prontas", "Aparecem ao digitar / na conversa. Universais: todas usam. Pessoais: só quem criou vê (a equipe cria as suas pela conversa). Variáveis pelos botões; data, profissional e serviço vêm do próximo horário: sem horário, o campo pede para preencher antes de enviar."], ["objection", "Objeções", "O que a cliente diz quando hesita. Viram relatório."], ["lost_reason", "Motivos de perda", "Pedidos ao marcar uma conversa como perdida."], ["keyword", "Palavras-chave", "Palavras ou frases que a cliente escreve e viram etiqueta na Fila (uma por linha). Ex.: etiqueta “Mega hair” para “mega hair” e “aplique”. Sem acento, maiúscula ou pontuação: tanto faz."]] as const;

/**
 * `initialTab`: aba aberta ao chegar (ex.: `?aba=keyword`). Serviços saiu daqui (16/10): é a aba Serviços do menu (/servicos).
 * `single`: cada lista é um item de Configurações (F5): sem a fileira de abas, só a lista pedida.
 */
export function ListsEditor({ items, initialTab = "quick_reply", single = false }: { items: Item[]; initialTab?: Item["kind"]; single?: boolean }) {
  const [tab, setTab] = useState<Item["kind"]>(initialTab);
  const [label, setLabel] = useState(""); const [body, setBody] = useState("");
  const [scope, setScope] = useState<"universal" | "minha">("universal");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const current = items.filter((i) => i.kind === tab)
    .sort((a, b) => (tab === "quick_reply" ? (a.category ?? "").localeCompare(b.category ?? "", "pt-BR") : 0));
  const meta = TABS.find((t) => t[0] === tab)!;
  const shown = current;
  return (
    <div>
      {!single && <div className="flex flex-wrap gap-1 bg-paper-2 border border-line rounded-[var(--radius-control)] p-1 w-fit" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`relative h-8 px-3 text-sm rounded-[9px] ${tab === k ? "text-ink font-medium" : "text-graphite"}`}>
            {tab === k && <motion.span layoutId="list-tab" transition={SPRING_UI} className="absolute inset-0 bg-paper rounded-[9px] shadow-[var(--shadow-card)]" />}<span className="relative">{l}</span>
          </button>
        ))}
      </div>}
      <p className={`text-sm text-graphite mb-4 ${single ? "" : "mt-3"}`}>{meta[2]}</p>
      {tab === "quick_reply" && (
        <datalist id="pastas-respostas">{[...new Set(current.map((i) => i.category).filter((c): c is string => !!c))].sort().map((c) => <option key={c} value={c} />)}</datalist>
      )}
      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <ul className="rounded-[var(--radius-card)] border border-line bg-paper divide-y divide-line/70">
          <AnimatePresence initial={false}>{shown.map((i, idx) => (
            <motion.li key={i.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {tab === "quick_reply" && (idx === 0 || (shown[idx - 1].category ?? "") !== (i.category ?? "")) && (
                <p className="px-4 pt-3 text-xs font-semibold text-gold-ink">{i.category ?? "Sem pasta"}</p>
              )}
              <Row i={i} />
            </motion.li>
          ))}</AnimatePresence>
          {shown.length === 0 && <li className="px-4 py-8 text-center text-muted text-sm">Nada aqui ainda.</li>}
        </ul>
        <form className="rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4 flex flex-col gap-3" aria-label="Adicionar" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = tab === "quick_reply" ? await createQuickReplyAction({ label, body, scope, folder: null }) : await addListItemAction(tab, label, tab === "keyword" ? body : null); if (r.ok) { setLabel(""); setBody(""); toast("Adicionado"); } else toast(r.error, "error"); }); }}>
          <p className="font-medium text-base">Adicionar</p>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tab === "quick_reply" ? "Atalho, ex.: promocao" : tab === "keyword" ? "Etiqueta, ex.: Mega hair" : "Texto"} aria-label={tab === "keyword" ? "Etiqueta" : "Nome"} />
          {tab === "quick_reply" && (
            <>
              <VarButtons target={bodyRef} value={body} onChange={setBody} />
              <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder="{saudacao}, {primeiro_nome}! …" aria-label="Texto da resposta" />
              {body.trim() && (
                <div className="rounded-[var(--radius-control)] bg-paper px-3 py-2">
                  <p className="text-xs font-semibold text-gold-ink">Prévia (exemplo)</p>
                  <p data-testid="previa-resposta" className="mt-1 whitespace-pre-wrap text-sm text-ink">{renderReply(body, EXEMPLO).text}</p>
                </div>
              )}
              <fieldset className="flex flex-col gap-1 text-sm">
                <legend className="sr-only">Quem usa</legend>
                <label className="flex items-center gap-2 min-h-9"><input type="radio" name="escopo-nova" checked={scope === "universal"} onChange={() => setScope("universal")} className="size-4" />Universal <span className="text-muted">(todas usam)</span></label>
                <label className="flex items-center gap-2 min-h-9"><input type="radio" name="escopo-nova" checked={scope === "minha"} onChange={() => setScope("minha")} className="size-4" />Só minha</label>
              </fieldset>
            </>
          )}
          {tab === "keyword" && <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={"mega hair\naplique"} aria-label="Palavras ou frases (uma por linha)" />}
          <Button type="submit" loading={pending} disabled={!label.trim() || (tab === "keyword" && !body.trim())}>Adicionar</Button>
        </form>
      </div>
    </div>
  );
}

function Row({ i }: { i: Item }) {
  const [label, setLabel] = useState(i.label); const [body, setBody] = useState(i.body ?? "");
  const [editingBody, setEditingBody] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const save = (active = i.active) => start(async () => { const r = await updateListItemAction(i.id, label, i.kind === "quick_reply" || i.kind === "keyword" ? body : null, active); if (!r.ok) toast(r.error, "error"); });
  return (
    <div className={`px-4 py-3 flex gap-3 items-start ${i.active ? "" : "opacity-50"}`}>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== i.label && save()} className="w-full min-w-0 font-medium text-base bg-transparent outline-none rounded px-1 -mx-1 focus:bg-paper-2" aria-label="Nome" />
        {i.kind === "quick_reply" && <ReplyScope i={i} />}
        {i.kind === "quick_reply" && editingBody && <VarButtons target={bodyRef} value={body} onChange={setBody} />}
        {i.kind === "quick_reply" && <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} onFocus={() => setEditingBody(true)} onBlur={() => { setEditingBody(false); if (body !== (i.body ?? "")) save(); }} rows={2} className="text-sm text-graphite bg-transparent outline-none resize-none rounded px-1 -mx-1 focus:bg-paper-2" aria-label="Texto" />}
        {i.kind === "quick_reply" && <QuickReplyExtras i={i} />}
        {i.kind === "keyword" && <textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => body !== (i.body ?? "") && save()} rows={2} className="text-sm text-graphite bg-transparent outline-none resize-none rounded px-1 -mx-1 focus:bg-paper-2" aria-label={`Frases de ${i.label}`} />}
        {i.kind === "keyword" && <Boost i={i} />}
      </div>
      <Switch checked={i.active} label={i.active ? "Desativar" : "Ativar"} disabled={pending} onChange={(v) => save(v)} />
    </div>
  );
}

/** Palavra-chave: "Subir na Fila" põe a conversa na frente dentro da sua seção (nunca acima dos atrasados). */
function Boost({ i }: { i: Item }) {
  const [on, setOn] = useState(!!i.boost);
  const [pending, start] = useTransition(); const toast = useToast();
  return (
    <label className="inline-flex items-center gap-2 min-h-11 text-sm text-graphite w-fit">
      <input type="checkbox" className="size-5 accent-[var(--color-ink)]" checked={on} disabled={pending}
        onChange={(e) => { const v = e.target.checked; setOn(v); start(async () => { const r = await setKeywordBoostAction(i.id, v); if (!r.ok) { setOn(!v); toast(r.error, "error"); } }); }} />
      Subir na Fila
    </label>
  );
}

/** Resposta pronta: pasta (agrupa no "/") e um anexo opcional (foto, PDF, vídeo ou áudio que vai junto, depois do texto). */
function QuickReplyExtras({ i }: { i: Item }) {
  const [folder, setFolder] = useState(i.category ?? "");
  const [pending, start] = useTransition(); const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const saveFolder = () => {
    if (folder.trim() === (i.category ?? "")) return;
    start(async () => { const r = await setQuickReplyFolderAction(i.id, folder.trim() || null); if (!r.ok) toast(r.error, "error"); });
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    start(async () => { const fd = new FormData(); fd.set("id", i.id); fd.set("file", f); const r = await attachQuickReplyFileAction(fd); toast(r.ok ? "Anexo salvo" : r.error, r.ok ? "ok" : "error"); });
  };
  const remove = () => start(async () => { const r = await detachQuickReplyFileAction(i.id); toast(r.ok ? "Anexo tirado" : r.error, r.ok ? "ok" : "error"); });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <input value={folder} onChange={(e) => setFolder(e.target.value)} onBlur={saveFolder} list="pastas-respostas" placeholder="Pasta (opcional)" aria-label={`Pasta de /${i.label}`}
        className="h-8 w-44 rounded-[var(--radius-control)] border border-line bg-paper px-2" />
      {i.attachment ? (
        <>
          <a href={`/api/respostas/${i.id}/arquivo`} target="_blank" rel="noreferrer" className="underline underline-offset-2">📎 {i.attachment.name}</a>
          <button type="button" disabled={pending} onClick={() => file.current?.click()} className="font-medium text-gold-ink">Trocar</button>
          <button type="button" disabled={pending} onClick={remove} className="font-medium text-alert">Tirar anexo</button>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={() => file.current?.click()} className="font-medium text-gold-ink">Anexar arquivo</button>
      )}
      <input ref={file} type="file" hidden accept="image/*,application/pdf,audio/*,video/mp4" aria-label={`Arquivo de /${i.label}`}
        onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

/** Universal (todas usam) ou pessoal de alguém; a gestão transforma a pessoal em universal. */
function ReplyScope({ i }: { i: Item }) {
  const [pending, start] = useTransition(); const toast = useToast();
  if (!i.ownerName) return <span className="text-xs text-muted">Universal: todas usam</span>;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-gold-soft px-2 py-0.5 font-semibold text-gold-ink">Só de {i.ownerName}</span>
      <button type="button" disabled={pending} aria-label={`Tornar universal /${i.label}`} className="font-medium text-gold-ink"
        onClick={() => start(async () => { const r = await makeQuickReplyUniversalAction(i.id); toast(r.ok ? "Agora todas usam essa resposta" : r.error, r.ok ? "ok" : "error"); })}>
        Tornar universal
      </button>
    </span>
  );
}
