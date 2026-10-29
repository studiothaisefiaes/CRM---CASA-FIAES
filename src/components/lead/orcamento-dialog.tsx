"use client";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { orcamentoDadosAction, orcamentoEnviarAction, orcamentoVerAction } from "@/app/(app)/conversa/orcamento-actions";
import { brl, MAX_ITENS, totalCents } from "@/lib/orcamento";
import { cn } from "@/lib/cn";

type Foto = { id: string; deCliente: boolean; at: string };
type Opcao = { nome: string; valorCents: number; tipo: "pacote" | "servico" };
type Item = { nome: string; valor: string };
const toCents = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
const toText = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/**
 * Orçamento do Método em PDF (Cati 27/10): foto de antes e de depois (da conversa), os itens com o preço (pacotes e serviços cadastrados, o valor
 * pode mudar), validade e observação. "Ver PDF" abre o arquivo para conferir; "Enviar" manda como documento na conversa. Nada sai sozinho.
 */
export function OrcamentoDialog({ dealId, open, onClose, onSent }: { dealId: string; open: boolean; onClose: () => void; onSent?: () => void }) {
  const [fotos, setFotos] = useState<Foto[] | null>(null);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [antes, setAntes] = useState<string | null>(null);
  const [depois, setDepois] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [busca, setBusca] = useState("");
  const [validade, setValidade] = useState("7");
  const [obs, setObs] = useState("");
  const [legenda, setLegenda] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void orcamentoDadosAction(dealId).then((r) => {
      if (!alive) return;
      if (!r.ok) { toast(r.error, "error"); return; }
      setFotos(r.data.fotos); setOpcoes(r.data.opcoes);
      const cli = r.data.fotos.filter((f) => f.deCliente);
      setAntes((a) => a ?? cli[0]?.id ?? null);
    });
    return () => { alive = false; };
  }, [open, dealId, toast]);

  const valid = itens.filter((i) => i.nome.trim() && Number.isFinite(toCents(i.valor)));
  const input = () => ({ dealId, antesId: antes, depoisId: depois, itens: valid.map((i) => ({ nome: i.nome.trim(), valorCents: toCents(i.valor) })), validadeDias: Math.min(90, Math.max(1, Number(validade) || 7)), obs: obs.trim() || null });
  const pronto = valid.length > 0;
  const ver = () => start(async () => {
    const r = await orcamentoVerAction(input());
    if (!r.ok) { toast(r.error, "error"); return; }
    const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank", "noopener");
  });
  const enviar = () => start(async () => {
    const r = await orcamentoEnviarAction(input(), legenda.trim() || null);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Orçamento enviado em PDF", "ok"); onSent?.(); onClose();
  });
  const sugestoes = busca.trim().length >= 2 ? opcoes.filter((o) => o.nome.toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR"))).slice(0, 8) : [];
  const total = totalCents({ itens: valid.map((i) => ({ nome: i.nome, valorCents: toCents(i.valor) })) });

  const pick = (label: string, value: string | null, set: (v: string | null) => void) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-graphite">{label}</span>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => set(null)} aria-pressed={value === null}
          className={cn("grid size-20 shrink-0 place-items-center rounded-[var(--radius-control)] border text-xs text-muted", value === null ? "border-ink" : "border-line")}>Sem foto</button>
        {(fotos ?? []).map((f) => (
          <button key={f.id} type="button" onClick={() => set(f.id)} aria-pressed={value === f.id} aria-label={`${label}: foto ${f.deCliente ? "da cliente" : "da Casa"}`}
            className={cn("size-20 shrink-0 overflow-hidden rounded-[var(--radius-control)] border-2", value === f.id ? "border-ink" : "border-transparent")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/${f.id}?thumb=1`} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onClose={() => !pending && onClose()} width={560} title="Orçamento do Método (PDF)"
      description="Fotos de antes e depois da conversa, os itens com o valor e a validade. Confira em Ver PDF; só sai quando você toca em Enviar."
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button variant="secondary" onClick={ver} disabled={!pronto} loading={pending}>Ver PDF</Button><Button onClick={enviar} disabled={!pronto} loading={pending}>Enviar</Button></>}>
      <div className="flex max-h-[min(64vh,560px)] flex-col gap-4 overflow-y-auto pr-1">
        {fotos === null ? <p className="text-sm text-muted">Carregando as fotos…</p> : fotos.length === 0 ? <p className="text-sm text-muted">Esta conversa não tem fotos: o PDF sai só com o orçamento.</p> : <>
          {pick("Antes", antes, setAntes)}
          {pick("Depois", depois, setDepois)}
        </>}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="orc-busca" className="text-xs font-semibold text-graphite">Itens</label>
          <Input id="orc-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pacote ou serviço (ex.: Método, hidratação)" className="h-10" autoComplete="off" />
          {sugestoes.length > 0 && (
            <ul className="flex flex-col rounded-[var(--radius-control)] border border-line">
              {sugestoes.map((o) => (
                <li key={`${o.tipo}:${o.nome}`}>
                  <button type="button" disabled={itens.length >= MAX_ITENS} onClick={() => { setItens((xs) => [...xs, { nome: o.nome, valor: toText(o.valorCents) }]); setBusca(""); }}
                    className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-paper-2">
                    <span>{o.nome}{o.tipo === "pacote" ? <span className="text-muted"> · pacote</span> : null}</span><span className="tabular-nums text-graphite">{o.valorCents ? brl(o.valorCents) : "sem preço"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {itens.map((i, k) => (
            <div key={k} className="flex items-center gap-2">
              <Input aria-label="Item" value={i.nome} maxLength={120} onChange={(e) => setItens((xs) => xs.map((x, j) => j === k ? { ...x, nome: e.target.value } : x))} className="h-10 min-w-0 flex-1" />
              <Input aria-label="Valor (R$)" value={i.valor} inputMode="decimal" onChange={(e) => setItens((xs) => xs.map((x, j) => j === k ? { ...x, valor: e.target.value } : x))} className="h-10 w-28 text-right tabular-nums" />
              <Button size="sm" variant="ghost" aria-label={`Tirar ${i.nome}`} onClick={() => setItens((xs) => xs.filter((_, j) => j !== k))}>Tirar</Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" className="-ml-2" disabled={itens.length >= MAX_ITENS} onClick={() => setItens((xs) => [...xs, { nome: "", valor: "" }])}>+ Item escrito à mão</Button>
            {valid.length > 0 && <span className="text-sm font-semibold tabular-nums text-ink">Total {brl(total)}</span>}
          </div>
        </div>
        <div className="grid grid-cols-[8rem_1fr] items-start gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-graphite">Validade (dias)
            <Input value={validade} inputMode="numeric" onChange={(e) => setValidade(e.target.value.replace(/\D/g, "").slice(0, 2))} className="h-10" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-graphite">Observação (opcional)
            <textarea value={obs} rows={2} maxLength={600} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: inclui a avaliação e as manutenções do primeiro mês"
              className="w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-sm font-normal text-ink" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-graphite">Mensagem junto (opcional)
          <Input value={legenda} maxLength={900} onChange={(e) => setLegenda(e.target.value)} placeholder="Ex.: Segue o seu orçamento, qualquer dúvida estou aqui 💛" className="h-10" />
        </label>
      </div>
    </Dialog>
  );
}
