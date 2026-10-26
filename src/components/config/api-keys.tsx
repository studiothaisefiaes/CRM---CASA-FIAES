"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { RelTime } from "@/components/ui/rel-time";
import { useToast } from "@/components/ui/toast";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/(app)/config/api/actions";

type Escopo = "ler" | "escrever" | "enviar";
export type ChaveRow = {
  id: string; nome: string; prefixo: string; escopos: Escopo[]; pessoa: string;
  criadaEm: string; ultimoUso: string | null; expiraEm: string | null; situacao: "ativa" | "revogada" | "vencida";
};

const ESCOPOS: { k: Escopo; label: string; help: string }[] = [
  { k: "ler", label: "Ler", help: "Ver conversas, clientes, agenda, tarefas e relatórios." },
  { k: "escrever", label: "Escrever", help: "Cadastrar e mudar: clientes, etapa, agenda, tarefas, notas." },
  { k: "enviar", label: "Enviar WhatsApp", help: "Mandar mensagem para a cliente. Não tem volta." },
];
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });

type Pessoa = { id: string; nome: string };

/**
 * Configurações › API: criar chave (nome, o que pode fazer, validade opcional), mostrar a chave UMA vez com Copiar, listar (nome, começo
 * da chave, o que pode, último uso) e revogar. A chave é de quem cria e age com as permissões do perfil dela. `pessoas` só vem para a
 * Gestão, que pode criar em nome de outra pessoa (que não tenha permissão que ela não tem).
 */
export function ApiKeys({ chaves, eu, pessoas }: { chaves: ChaveRow[]; eu: Pessoa; pessoas: Pessoa[] | null }) {
  const [criada, setCriada] = useState<{ chave: string; nome: string } | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <NovaChave eu={eu} pessoas={pessoas} onCriada={setCriada} />
      <Lista chaves={chaves} />
      <p className="max-w-[62ch] text-sm text-graphite">
        Para quem vai programar: a documentação fica em <a className="text-gold-ink underline underline-offset-2" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a>.
        Cada pedido leva o cabeçalho <code className="rounded bg-paper-2 px-1">Authorization: Bearer cf_…</code>.
      </p>
      <ChaveCriada criada={criada} onClose={() => setCriada(null)} />
    </div>
  );
}

function NovaChave({ eu, pessoas, onCriada }: { eu: Pessoa; pessoas: Pessoa[] | null; onCriada: (c: { chave: string; nome: string }) => void }) {
  const [nome, setNome] = useState("");
  const [userId, setUserId] = useState(eu.id);
  const outra = userId !== eu.id;
  const [escopos, setEscopos] = useState<Escopo[]>(["ler"]);
  const [validade, setValidade] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const toggle = (k: Escopo) => setEscopos((e) => (e.includes(k) ? e.filter((x) => x !== k) : [...e, k]));
  const criar = () => start(async () => {
    const r = await createApiKeyAction({ nome, userId: outra ? userId : null, escopos, validade: validade || null });
    if (!r.ok) { toast(r.error, "error"); return; }
    onCriada({ chave: r.data!.chave, nome });
    setNome(""); setValidade(""); setEscopos(["ler"]); setUserId(eu.id);
    router.refresh();
  });
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper" aria-labelledby="nova-chave-t">
      <form className="flex flex-col gap-4 p-5" onSubmit={(e) => { e.preventDefault(); criar(); }}>
        <div>
          <h2 id="nova-chave-t" className="text-lg font-semibold">Nova chave</h2>
          <p className="mt-1 max-w-[62ch] text-sm text-graphite">Para planilhas, scripts e outros sistemas lerem e escreverem no CRM. A chave é sua: age em seu nome, faz só o que o seu perfil pode fazer e só o que você marcar aqui.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Nome
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Ex.: Planilha da gestão" className="h-10 w-72 max-w-full" required />
          </label>
          {pessoas ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Em nome de
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-10 w-64 max-w-full" required>
                <option value={eu.id}>Você ({eu.nome})</option>
                {pessoas.filter((p) => p.id !== eu.id).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </Select>
            </label>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Em nome de
              <p className="flex h-10 items-center text-sm font-normal text-ink">Você ({eu.nome})</p>
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Vale até (opcional)
            <Input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className="h-10 w-44" />
          </label>
        </div>
        <p className="max-w-[62ch] text-sm text-graphite">
          {pessoas
            ? outra
              ? "Em nome de outra pessoa: a chave age com o perfil dela, que não pode ter permissão que você não tem. Fica registrado que foi você quem criou."
              : "Você pode criar em nome de outra pessoa da equipe (só a Gestão pode), desde que ela não tenha permissão que você não tem."
            : "Só a Gestão cria chave em nome de outra pessoa. Para a chave de outra pessoa, peça para a Gestão ou para ela mesma criar."}
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-graphite">O que a chave pode fazer</legend>
          {ESCOPOS.map((s) => (
            <label key={s.k} className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-ink)]" checked={escopos.includes(s.k)} onChange={() => toggle(s.k)} />
              <span><span className="font-medium text-ink">{s.label}</span> <span className="text-graphite">· {s.help}</span></span>
            </label>
          ))}
        </fieldset>
        <div><Button type="submit" loading={pending} disabled={!nome.trim() || !escopos.length}>Criar chave</Button></div>
      </form>
    </section>
  );
}

function ChaveCriada({ criada, onClose }: { criada: { chave: string; nome: string } | null; onClose: () => void }) {
  const [copiada, setCopiada] = useState(false);
  const toast = useToast();
  const copiar = async () => {
    if (!criada) return;
    try { await navigator.clipboard.writeText(criada.chave); setCopiada(true); setTimeout(() => setCopiada(false), 1800); } catch { toast("Não foi possível copiar. Selecione a chave e copie à mão.", "error"); }
  };
  return (
    <Dialog open={!!criada} onClose={onClose} title={`Chave "${criada?.nome ?? ""}" criada`} width={520}
      description="Copie e guarde agora: ela não aparece de novo. Se perder, revogue e crie outra."
      footer={<><Button variant="secondary" onClick={copiar}>{copiada ? "Copiada" : "Copiar"}</Button><Button onClick={onClose}>Já guardei</Button></>}>
      <code className="block select-all break-all rounded-[var(--radius-control)] border border-line bg-paper-2 px-3 py-2.5 font-mono text-sm" data-testid="chave-api">{criada?.chave}</code>
    </Dialog>
  );
}

function Lista({ chaves }: { chaves: ChaveRow[] }) {
  const [revogar, setRevogar] = useState<ChaveRow | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const confirmar = () => start(async () => {
    if (!revogar) return;
    const r = await revokeApiKeyAction(revogar.id);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Chave revogada"); setRevogar(null); router.refresh();
  });
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper" aria-labelledby="chaves-t">
      <h2 id="chaves-t" className="px-5 pt-5 text-lg font-semibold">Chaves</h2>
      {!chaves.length ? <p className="px-5 pb-5 pt-1 text-sm text-graphite">Nenhuma chave ainda.</p> : (
        <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
          {chaves.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 ${c.situacao === "ativa" ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.nome} <span className="ml-1 font-mono text-sm text-graphite">{c.prefixo}…</span></p>
                <p className="text-sm text-graphite">
                  Em nome de {c.pessoa} · {c.ultimoUso ? <>usada <RelTime at={c.ultimoUso} /></> : "nunca usada"}{c.expiraEm ? ` · vale até ${dia(new Date(new Date(c.expiraEm).getTime() - 1).toISOString())}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {c.escopos.map((e) => <Badge key={e} tone={e === "enviar" ? "gold" : "neutral"}>{ESCOPOS.find((x) => x.k === e)?.label ?? e}</Badge>)}
                {c.situacao === "revogada" && <Badge tone="alert">Revogada</Badge>}
                {c.situacao === "vencida" && <Badge tone="alert">Vencida</Badge>}
              </div>
              {c.situacao === "ativa" && <Button variant="secondary" size="sm" onClick={() => setRevogar(c)}>Revogar</Button>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!revogar} onClose={() => setRevogar(null)} title="Revogar a chave?"
        description={`"${revogar?.nome ?? ""}" para de funcionar na hora. Quem usa precisa de uma chave nova.`}
        footer={<><Button variant="secondary" onClick={() => setRevogar(null)}>Cancelar</Button><Button variant="danger" loading={pending} onClick={confirmar}>Revogar</Button></>} />
    </section>
  );
}
