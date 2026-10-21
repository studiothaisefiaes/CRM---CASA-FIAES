"use client";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  menuLevel, menuStep, menuTrail, welcomeText, WELCOME_MAX_OPTIONS, WELCOME_SUGGESTED_INTRO, WELCOME_SUGGESTED_SUBMENU_INTRO,
  type MenuOption, type WelcomeConfig,
} from "@/lib/welcome-menu-flow";
import { SendConfirmDialog } from "./send-confirm";
import { saveWelcomeMenuAction } from "@/app/(app)/config/menu/actions";

type Ref = { id: string; name: string };
/** Rascunho de uma opção na tela: cada escolha tem o seu "liga" e os seus campos (desmarcar não apaga o que foi escrito). */
type Draft = {
  label: string;
  useTag: boolean; tag: string;
  useReply: boolean; replyText: string; fileId: string;
  usePass: boolean; pass: string; // "team:<id>" | "user:<id>"
  useSub: boolean; subIntro: string; sub: Draft[];
};

const blank = (): Draft => ({ label: "", useTag: false, tag: "", useReply: false, replyText: "", fileId: "", usePass: false, pass: "", useSub: false, subIntro: "", sub: [] });
const toDraft = (o: MenuOption): Draft => ({
  label: o.label ?? "",
  useTag: !!o.tag?.trim(), tag: o.tag ?? "",
  useReply: !!(o.reply?.text || o.reply?.fileId), replyText: o.reply?.text ?? "", fileId: o.reply?.fileId ?? "",
  usePass: !!o.passTo, pass: o.passTo ? ("team" in o.passTo ? `team:${o.passTo.team}` : `user:${o.passTo.user}`) : "",
  useSub: !!o.submenu, subIntro: o.submenu?.intro ?? "", sub: (o.submenu?.options ?? []).map(toDraft),
});
const toOption = (d: Draft, deep: boolean): MenuOption => {
  const text = d.replyText.trim() || null, fileId = d.fileId || null;
  const [kind, id] = d.pass.split(":");
  return {
    label: d.label.trim(),
    tag: d.useTag ? d.tag.trim() || null : null,
    reply: d.useReply ? { text, fileId } : null,
    passTo: d.usePass && id ? (kind === "team" ? { team: id } : { user: id }) : null,
    submenu: deep && d.useSub ? { intro: d.subIntro.trim(), options: d.sub.filter((s) => s.label.trim()).map((s) => toOption(s, false)) } : null,
  };
};

/**
 * Menu de boas-vindas: nasce desligado; ligar pede a confirmação "isto envia mensagens reais".
 * Cada opção, uma por vez: "O que acontece quando ela escolhe …?" (pôr etiqueta, responder, passar para, abrir outro menu).
 * "Testar como cliente" roda o menu da tela (mesmo sem salvar) e nunca envia nada.
 */
export function WelcomeMenuEditor({ initial, teams = [], people = [], files = [], setoresLigada = true }: {
  initial: WelcomeConfig; teams?: Ref[]; people?: Ref[]; files?: Ref[]; setoresLigada?: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [intro, setIntro] = useState(initial.intro);
  const [drafts, setDrafts] = useState<Draft[]>(initial.options.length ? initial.options.map(toDraft) : [blank(), blank()]);
  const [sel, setSel] = useState<number[]>([0]);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const cfg: WelcomeConfig = { enabled, intro: intro.trim(), options: drafts.filter((d) => d.label.trim()).map((d) => toOption(d, true)) };
  const save = (on: boolean) => start(async () => {
    const r = await saveWelcomeMenuAction({ ...cfg, enabled: on });
    if (!r.ok) { toast(r.error, "error"); return; }
    setEnabled(on); setAsking(false); toast(on === enabled ? "Salvo" : on ? "Menu de boas-vindas ligado" : "Menu de boas-vindas desligado", "ok");
  });
  /** Muda a opção no caminho [i] ou [i, j]. */
  const patch = (path: number[], p: Partial<Draft>) => setDrafts((l) => l.map((d, i) => {
    if (i !== path[0]) return d;
    if (path.length === 1) return { ...d, ...p };
    return { ...d, sub: d.sub.map((s, j) => (j === path[1] ? { ...s, ...p } : s)) };
  }));
  const current = sel.length === 1 ? drafts[sel[0]] : drafts[sel[0]]?.sub[sel[1]];

  return (
    <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[1100px]:gap-6">
      <div className="flex flex-col gap-5">
        <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="sr-only">Menu de boas-vindas</h2>{/* r68 #8: o título da página (h1) já diz isto; o h2 fica só para o leitor de tela */}
              <p className="mt-1 text-sm text-graphite">Quem escreve para a Casa pela primeira vez, com a Casa aberta, recebe a saudação com as opções. Cada opção pode pôr etiqueta, responder com um texto ou arquivo da Biblioteca, passar a conversa para um setor ou pessoa, ou abrir outro menu. Frase que não é escolha (“tenho 2 filhas”) fica para a equipe.</p>
            </div>
            <Switch checked={enabled} label={enabled ? "Desligar o menu" : "Ligar o menu"} disabled={pending} onChange={(v) => (v ? setAsking(true) : save(false))} />
          </div>
        </section>
        <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-5">
          <Field label="Saudação" htmlFor="menu-intro">
            <Textarea id="menu-intro" value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} placeholder={WELCOME_SUGGESTED_INTRO} />
          </Field>
          {intro.trim() !== WELCOME_SUGGESTED_INTRO && <div><Button variant="ghost" size="sm" onClick={() => setIntro(WELCOME_SUGGESTED_INTRO)}>Usar o texto sugerido</Button></div>}
          <OptionList items={drafts} prefix="" selected={sel[0]} label={(i) => `Opção ${i + 1}`}
            onLabel={(i, label) => patch([i], { label })} onPick={(i) => setSel([i])} onAdd={() => setDrafts((l) => [...l, blank()])} />
          <div><Button onClick={() => save(enabled)} loading={pending}>Salvar</Button></div>
        </section>
      </div>
      <div className="flex flex-col gap-5">
        {current && (
          <OptionPanel key={sel.join(".")} d={current} path={sel} parentLabel={sel.length === 2 ? drafts[sel[0]]?.label : undefined}
            teams={teams} people={people} files={files} setoresLigada={setoresLigada}
            onChange={(p) => patch(sel, p)} onPick={setSel} />
        )}
        <Tester cfg={cfg} teams={teams} people={people} files={files} />
      </div>
      <SendConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={() => save(true)} pending={pending}
        what="Toda pessoa que escrever pela primeira vez, com a Casa aberta, recebe o menu automaticamente, e as opções que respondem mandam a resposta sozinhas." />
    </div>
  );
}

/** Lista numerada das opções (do menu ou do submenu): o nome e o botão que abre a pergunta daquela opção. */
function OptionList({ items, prefix, selected, label, onLabel, onPick, onAdd }: {
  items: Draft[]; prefix: string; selected: number | null; label: (i: number) => string;
  onLabel: (i: number, v: string) => void; onPick: (i: number) => void; onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((o, i) => (
        <div key={i} className={cn("grid grid-cols-[2rem_1fr_auto] items-center gap-2 rounded-[var(--radius-control)] p-1", selected === i && "bg-paper-2")}>
          <span className="text-sm font-semibold text-gold-ink">{i + 1}.</span>
          <Input value={o.label} onChange={(e) => onLabel(i, e.target.value)} aria-label={label(i)} placeholder="Ex.: Agendar horário" maxLength={40} />
          <Button variant="ghost" size="sm" aria-label={`Configurar a opção ${prefix}${i + 1}`} aria-pressed={selected === i} onClick={() => onPick(i)}>{summary(o)}</Button>
        </div>
      ))}
      {items.length < WELCOME_MAX_OPTIONS && <div><Button variant="ghost" size="sm" onClick={onAdd}>Acrescentar opção</Button></div>}
    </div>
  );
}

const summary = (o: Draft) => {
  const s = [o.useTag && "etiqueta", o.useReply && "responde", o.usePass && "passa", o.useSub && "outro menu"].filter(Boolean);
  return s.length ? s.join(" · ") : "Só nota";
};

/** A pergunta de uma opção, sozinha na tela: as quatro escolhas (três dentro do submenu, que não abre outro menu). */
function OptionPanel({ d, path, parentLabel, teams, people, files, setoresLigada, onChange, onPick }: {
  d: Draft; path: number[]; parentLabel?: string; teams: Ref[]; people: Ref[]; files: Ref[]; setoresLigada: boolean;
  onChange: (p: Partial<Draft>) => void; onPick: (path: number[]) => void;
}) {
  const hid = useId();
  const name = d.label.trim() || `a opção ${path.map((n) => n + 1).join(".")}`;
  const deep = path.length === 1;
  const firstTarget = teams[0] ? `team:${teams[0].id}` : people[0] ? `user:${people[0].id}` : "";
  return (
    <section role="group" aria-labelledby={hid} className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-paper p-5">
      {!deep && <div><Button variant="ghost" size="sm" onClick={() => onPick([path[0]])}>Voltar para {parentLabel?.trim() || `a opção ${path[0] + 1}`}</Button></div>}
      <h3 id={hid} className="font-display text-lg">O que acontece quando ela escolhe {name}?</h3>
      <p className="text-sm text-muted">Sempre fica uma nota na conversa para quem atender. Marque o que mais deve acontecer.</p>

      <Choice label="Pôr etiqueta" checked={d.useTag} onChange={(v) => onChange({ useTag: v })}>
        <Input value={d.tag} onChange={(e) => onChange({ tag: e.target.value })} aria-label="Etiqueta" placeholder="Ex.: Quer agendar" />
      </Choice>

      <Choice label="Responder" checked={d.useReply} onChange={(v) => onChange({ useReply: v })}>
        <Textarea value={d.replyText} onChange={(e) => onChange({ replyText: e.target.value })} aria-label="Texto da resposta" rows={3} maxLength={1000}
          placeholder="Ex.: Segue a nossa tabela de preços 💛" />
        <Select value={d.fileId} onChange={(e) => onChange({ fileId: e.target.value })} aria-label="Arquivo da Biblioteca">
          <option value="">Sem arquivo</option>
          {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <p className="text-sm text-muted">Sai pela fila, aparece na conversa e respeita as Automáticas pausadas.</p>
      </Choice>

      <Choice label="Passar para" checked={d.usePass} onChange={(v) => onChange({ usePass: v, ...(v && !d.pass ? { pass: firstTarget } : {}) })}>
        <Select value={d.pass} onChange={(e) => onChange({ pass: e.target.value })} aria-label="Para quem passa">
          <option value="">Escolha…</option>
          {teams.length > 0 && <optgroup label="Setor">{teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}</optgroup>}
          {people.length > 0 && <optgroup label="Pessoa">{people.map((p) => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}</optgroup>}
        </Select>
        {!setoresLigada && <p className="text-sm text-muted">A função Setores está desligada: passar para setor só deixa a nota.</p>}
      </Choice>

      {deep && (
        <Choice label="Abrir outro menu" checked={d.useSub} onChange={(v) => onChange({ useSub: v, ...(v && d.sub.length === 0 ? { sub: [blank(), blank()] } : {}) })}>
          <Field label="Saudação do submenu" htmlFor={`${hid}-sub`}>
            <Textarea id={`${hid}-sub`} value={d.subIntro} onChange={(e) => onChange({ subIntro: e.target.value })} rows={2} placeholder={WELCOME_SUGGESTED_SUBMENU_INTRO} />
          </Field>
          {d.subIntro.trim() !== WELCOME_SUGGESTED_SUBMENU_INTRO && (
            <div><Button variant="ghost" size="sm" aria-label="Usar o texto sugerido no submenu" onClick={() => onChange({ subIntro: WELCOME_SUGGESTED_SUBMENU_INTRO })}>Usar o texto sugerido</Button></div>
          )}
          <OptionList items={d.sub} prefix={`${path[0] + 1}.`} selected={null} label={(j) => `Opção ${j + 1} do submenu`}
            onLabel={(j, label) => onChange({ sub: d.sub.map((s, k) => (k === j ? { ...s, label } : s)) })}
            onPick={(j) => onPick([path[0], j])} onAdd={() => onChange({ sub: [...d.sub, blank()] })} />
        </Choice>
      )}
    </section>
  );
}

function Choice({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-base font-medium text-ink">
        <input type="checkbox" className="size-4 accent-[var(--color-gold,currentColor)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {checked && <div className="ml-6 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

/** Simulação ao lado: a gestão escreve como a cliente e vê o que aconteceria. Usa `menuStep` (puro); nada é enviado nem salvo. */
function Tester({ cfg, teams, people, files }: { cfg: WelcomeConfig; teams: Ref[]; people: Ref[]; files: Ref[] }) {
  const [path, setPath] = useState<number[]>([]);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ title: string; lines: string[] } | null>(null);
  const level = menuLevel(cfg, path) ?? cfg;
  const nameOf = (list: Ref[], id: string | null | undefined) => list.find((x) => x.id === id)?.name ?? "—";
  const run = () => {
    const step = menuStep(cfg, path, input);
    setInput("");
    if (step.kind === "nao_entendi") { setResult({ title: "Não é uma escolha: a equipe atende.", lines: [] }); return; }
    const o = step.kind === "escolheu" ? step.option : cfg.options[step.path[0]];
    const lines = [
      o.tag ? `Etiqueta “${o.tag}”` : null,
      o.reply?.text ? `Responde: ${o.reply.text}` : null,
      o.reply?.fileId ? `Manda o arquivo ${nameOf(files, o.reply.fileId)}` : null,
      o.passTo ? ("team" in o.passTo ? `Passa para o setor ${nameOf(teams, o.passTo.team)}` : `Passa para ${nameOf(people, o.passTo.user)}`) : null,
      step.kind === "submenu" ? "Manda o submenu" : null,
    ].filter((x): x is string => !!x);
    setResult({ title: `Escolheu: ${menuTrail(cfg, step.path).map((t) => t.label).join(" › ")}`, lines: lines.length ? lines : ["Só a nota para quem atender."] });
    setPath(step.kind === "submenu" ? step.path : []);
  };
  return (
    <section aria-label="Testar como cliente" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg">Testar como cliente</h3>
        <Button variant="ghost" size="sm" onClick={() => { setPath([]); setResult(null); }}>Recomeçar</Button>
      </div>
      <p className="text-sm text-muted">Escreva como se fosse ela. Nada é enviado.</p>
      <pre className="whitespace-pre-wrap rounded-[var(--radius-control)] bg-paper-2 p-3 text-sm">{welcomeText(level)}</pre>
      {result && (
        <div className="rounded-[var(--radius-control)] border border-line p-3 text-sm" aria-live="polite">
          <p className="font-medium text-ink">{result.title}</p>
          {result.lines.length > 0 && <ul className="mt-1 list-disc pl-5 text-graphite">{result.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <Input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Ela escreve" placeholder="Ex.: 2" />
        <Button type="submit" variant="ghost">Testar</Button>
      </form>
    </section>
  );
}
