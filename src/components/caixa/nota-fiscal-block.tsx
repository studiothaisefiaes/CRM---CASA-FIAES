"use client";
import { useState, useTransition } from "react";
import { cancelarNota, cancelarNotaProduto, emitirNota, emitirNotaProduto, resolverNotaFora } from "@/app/(app)/caixa/actions";
import { FieldError, SheetLabel } from "@/components/queue/action-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useClock } from "@/components/pipeline/timer";
import { money } from "@/lib/format";
import { formatCpf } from "@/lib/cpf";
import { FISCAL_ENV_LABEL, fiscalStatusLabel } from "@/lib/fiscal-status";
import type { NfceInfo, NotaFiscalInfo } from "@/server/domain/fiscal/draft";

const copyBtn = "inline-flex items-center min-h-11 lg:min-h-8 shrink-0 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm font-medium hover:bg-paper-2";

/**
 * Nota fiscal na comanda fechada. Chave desligada: "Dados da nota (para o nfse.gov.br)", cada campo com "Copiar" (a recepção cola no emissor web).
 * Chave em teste ou produção: a situação da nota e as ações, cada uma com a sua permissão (o servidor confere de novo):
 * "Emitir nota" e "Emitir de novo" (nota.emitir), "Cancelar nota" (nota.cancelar), "Ver nota no nfse.gov.br" e "Baixar XML" (nota.ver).
 * O PDF não sai do CRM: a API do DANFSe foi suspensa (NT 008), então a tela mostra a chave para abrir a nota no nfse.gov.br.
 * Embaixo, a "Nota de produto (NFC-e)" (Task 13), com a sua própria chave e as mesmas permissões.
 * "Resolver fora do CRM" (nota.resolver, só a Gestão) nas duas: para a nota com erro no envio, enviando já enviada ou autorizada que o
 * CRM não consegue soltar sozinho (sem certificado, NFC-e fora do prazo); registra o que foi conferido no portal, com o motivo.
 */
export function NotaFiscalBlock({ info, comandaId, onChanged }: { info: NotaFiscalInfo | null | undefined; comandaId?: string; onChanged?: () => void | Promise<void> }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [cancel, setCancel] = useState<string | null>(null);
  const [resolver, setResolver] = useState(false);
  if (!info) return null;
  const nfce = info.nfce ? <NfceLine info={info.nfce} acoes={info.acoes} comandaId={comandaId} onChanged={onChanged} /> : null;
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast("Copiado"); } catch { toast("Não deu para copiar. Selecione o texto e copie.", "error"); }
  };
  // Chave desligada: "Dados da nota (para o nfse.gov.br)" para copiar. A nota já emitida antes de desligar continua aparecendo (abaixo).
  const d = info.modo === "desligada" ? info.dados : null;
  // Parceira sem CNPJ: a cota-parte dela não entrou no texto (o servidor recusa emitir assim).
  const avisos = info.avisos?.length ? info.avisos.map((a) => <p key={a} role="alert" className="text-sm font-medium text-alert">{a}</p>) : null;
  const rascunho = d && (
    <section aria-label="Dados da nota" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-3">
      <h3 className="text-sm font-semibold">Dados da nota (para o nfse.gov.br)</h3>
      {avisos}
      {([
        { key: "cpf", label: "CPF", value: d.cpf ? formatCpf(d.cpf) : "" },
        { key: "disc", label: "Discriminação", value: d.discriminacao },
        { key: "valor", label: "Valor", value: d.valor },
        { key: "cod", label: "Código do serviço", value: d.codigoServico },
      ]).map((f) => (
        <div key={f.key} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">{f.label}</p>
            <p className="text-sm break-words">{f.value || "Sem CPF na nota"}</p>
          </div>
          {f.value && <button type="button" className={copyBtn} aria-label={`Copiar ${f.label}`} onClick={() => copy(f.key === "cpf" ? f.value.replace(/\D/g, "") : f.value)}>Copiar</button>}
        </div>
      ))}
    </section>
  );
  if (info.modo === "desligada" && !info.documento) return (rascunho || nfce) ? <>{rascunho}{nfce}</> : null;
  const doc = info.documento;
  const acoes = info.acoes ?? { emitir: false, cancelar: false, ver: false };
  const emit = () => start(async () => {
    if (!comandaId) return;
    setError(null);
    const r = await emitirNota(comandaId);
    if (!r.ok) { setError(r.error ?? "Não foi possível emitir a nota. Tente de novo."); return; }
    const status = (r as { data?: { status?: string } }).data?.status;
    toast(status === "autorizada" ? "Nota autorizada" : status === "rejeitada" ? "O governo recusou a nota" : "Nota enviada: o sistema confere a resposta do governo sozinho");
    await onChanged?.();
  });
  const confirmCancel = () => start(async () => {
    if (!doc || cancel == null) return;
    setError(null);
    const r = await cancelarNota(doc.id, { reason: cancel });
    if (!r.ok) { setError(r.error ?? "Não foi possível cancelar a nota. Tente de novo."); return; }
    setCancel(null);
    toast("Nota cancelada");
    await onChanged?.();
  });
  const on = info.modo !== "desligada";
  const canEmit = on && acoes.emitir && !!comandaId && ((!doc && !info.semServico) || doc?.status === "cancelada");
  const canEmitAgain = on && acoes.emitir && !!comandaId && (doc?.status === "rejeitada" || doc?.status === "erro_envio");
  const canSee = acoes.ver && !!doc?.accessKey && (doc.status === "autorizada" || doc.status === "cancelada");
  const canCancel = acoes.cancelar && doc?.status === "autorizada";
  const canResolve = !!acoes.resolver && resolvivel(doc);
  const reasonOk = (cancel ?? "").trim().replace(/\s+/g, " ").length >= 15;
  return (<>
    <section aria-label="Nota fiscal" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-3">
      <h3 className="text-sm font-semibold">Nota fiscal</h3>
      {doc ? (
        <p className="text-sm">{`Nota ${doc.number} · ${fiscalStatusLabel(doc.status)} · ${money(doc.amountCents)} · ${FISCAL_ENV_LABEL[doc.environment] ?? doc.environment}`}{doc.rejectReason ? ` · ${doc.rejectReason}` : ""}</p>
      ) : info.semServico ? <p className="text-sm text-muted">Essa comanda não tem serviço para nota.</p> : <p className="text-sm text-muted">Nota ainda não emitida.</p>}
      {!rascunho && avisos}
      {showKey && doc?.accessKey && (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm break-all">{`Abra a nota no nfse.gov.br com a chave ${doc.accessKey}.`}</p>
          <button type="button" className={copyBtn} onClick={() => copy(doc.accessKey!)}>Copiar a chave</button>
        </div>
      )}
      {cancel !== null && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-alert/40 p-3">
          <SheetLabel><label htmlFor={`cancelar-nota-${doc?.id}`}>Motivo do cancelamento da nota</label></SheetLabel>
          <Input id={`cancelar-nota-${doc?.id}`} value={cancel} maxLength={255} onChange={(e) => setCancel(e.target.value)} placeholder="ex.: serviço lançado na cliente errada" />
          <FieldError>{!reasonOk ? "Escreva o motivo do cancelamento (pelo menos 15 letras)." : null}</FieldError>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCancel(null)}>Voltar</Button>
            <Button variant="danger" size="sm" disabled={pending || !reasonOk} onClick={confirmCancel}>Cancelar a nota no governo</Button>
          </div>
        </div>
      )}
      {resolver && doc && <ResolverFora docId={doc.id} onCancel={() => setResolver(false)} onDone={async () => { setResolver(false); await onChanged?.(); }} />}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {(canEmit || canEmitAgain || canSee || canCancel || canResolve || (acoes.ver && doc)) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEmit && <Button size="sm" disabled={pending} onClick={emit}>Emitir nota</Button>}
          {canEmitAgain && <Button size="sm" disabled={pending} onClick={emit}>Emitir de novo</Button>}
          {canSee && !showKey && <Button variant="secondary" size="sm" onClick={() => setShowKey(true)}>Ver nota no nfse.gov.br</Button>}
          {acoes.ver && doc && <a className={copyBtn} href={`/api/notas-fiscais/${doc.id}?formato=xml`} download>Baixar XML</a>}
          {canCancel && cancel === null && <Button variant="secondary" size="sm" disabled={pending} onClick={() => setCancel("")}>Cancelar nota</Button>}
          {canResolve && !resolver && <Button variant="secondary" size="sm" disabled={pending} onClick={() => setResolver(true)}>Resolver fora do CRM</Button>}
        </div>
      )}
    </section>
    {rascunho}
    {nfce}
  </>);
}

/** "Nota de produto (NFC-e)": situação, Emitir NFC-e, Consultar pelo QR Code, Baixar XML e Cancelar NFC-e (o prazo vem de Configurações). */
function NfceLine({ info, acoes: a, comandaId, onChanged }: { info: NfceInfo; acoes?: NotaFiscalInfo["acoes"]; comandaId?: string; onChanged?: () => void | Promise<void> }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const [resolver, setResolver] = useState(false);
  const doc = info.documento;
  const acoes = a ?? { emitir: false, cancelar: false, ver: false };
  const on = info.modo !== "desligada";
  const emit = () => start(async () => {
    if (!comandaId) return;
    setError(null);
    const r = await emitirNotaProduto(comandaId);
    if (!r.ok) { setError(r.error ?? "Não foi possível emitir a NFC-e. Tente de novo."); return; }
    const status = (r as { data?: { status?: string } }).data?.status;
    toast(status === "autorizada" ? "NFC-e autorizada" : status === "rejeitada" ? "A SEFAZ recusou a NFC-e" : "NFC-e enviada: o sistema confere a resposta da SEFAZ sozinho");
    await onChanged?.();
  });
  const confirmCancel = () => start(async () => {
    if (!doc || cancel == null) return;
    setError(null);
    const r = await cancelarNotaProduto(doc.id, { reason: cancel });
    if (!r.ok) { setError(r.error ?? "Não foi possível cancelar a NFC-e. Tente de novo."); return; }
    setCancel(null);
    toast("NFC-e cancelada");
    await onChanged?.();
  });
  const canEmit = on && acoes.emitir && !!comandaId && ((!doc && !info.semProduto) || doc?.status === "cancelada");
  const canEmitAgain = on && acoes.emitir && !!comandaId && (doc?.status === "rejeitada" || doc?.status === "erro_envio");
  const canSee = acoes.ver && !!doc?.consultaUrl;
  // O prazo (Configurações › Nota fiscal) corre com o relógio da tela: passou, some o botão (o servidor recusa de qualquer jeito).
  const cancelarAteMs = doc?.cancelarAte ? Date.parse(doc.cancelarAte) : null;
  const noPrazo = useClock((now) => cancelarAteMs == null || now <= cancelarAteMs);
  const canCancel = acoes.cancelar && doc?.status === "autorizada" && noPrazo;
  const canResolve = !!acoes.resolver && resolvivel(doc);
  const reasonOk = (cancel ?? "").trim().replace(/\s+/g, " ").length >= 15;
  const ate = doc?.cancelarAte ? new Date(doc.cancelarAte).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" }) : null;
  return (
    <section aria-label="Nota de produto (NFC-e)" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-3">
      <h3 className="text-sm font-semibold">Nota de produto (NFC-e)</h3>
      {doc ? (
        <p className="text-sm">{`NFC-e ${doc.number} · ${fiscalStatusLabel(doc.status)} · ${money(doc.amountCents)} · ${FISCAL_ENV_LABEL[doc.environment] ?? doc.environment}`}{doc.rejectReason ? ` · ${doc.rejectReason}` : ""}</p>
      ) : info.semProduto ? <p className="text-sm text-muted">Essa comanda não tem produto para nota.</p> : <p className="text-sm text-muted">NFC-e ainda não emitida.</p>}
      {canCancel && ate && cancel === null && <p className="text-xs text-muted">{`Dá para cancelar na SEFAZ até as ${ate}.`}</p>}
      {doc?.status === "autorizada" && !noPrazo && <p className="text-xs text-muted">Prazo de cancelamento encerrado.</p>}
      {cancel !== null && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-alert/40 p-3">
          <SheetLabel><label htmlFor={`cancelar-nfce-${doc?.id}`}>Motivo do cancelamento da NFC-e</label></SheetLabel>
          <Input id={`cancelar-nfce-${doc?.id}`} value={cancel} maxLength={255} onChange={(e) => setCancel(e.target.value)} placeholder="ex.: produto lançado na cliente errada" />
          <FieldError>{!reasonOk ? "Escreva o motivo do cancelamento (pelo menos 15 letras)." : null}</FieldError>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCancel(null)}>Voltar</Button>
            <Button variant="danger" size="sm" disabled={pending || !reasonOk} onClick={confirmCancel}>Cancelar a NFC-e na SEFAZ</Button>
          </div>
        </div>
      )}
      {resolver && doc && <ResolverFora docId={doc.id} onCancel={() => setResolver(false)} onDone={async () => { setResolver(false); await onChanged?.(); }} />}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {(canEmit || canEmitAgain || canSee || canCancel || canResolve || (acoes.ver && doc)) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEmit && <Button size="sm" disabled={pending} onClick={emit}>Emitir NFC-e</Button>}
          {canEmitAgain && <Button size="sm" disabled={pending} onClick={emit}>Emitir NFC-e de novo</Button>}
          {canSee && <a className={copyBtn} href={doc!.consultaUrl!} target="_blank" rel="noopener noreferrer">Consultar pelo QR Code</a>}
          {acoes.ver && doc && <a className={copyBtn} href={`/api/notas-fiscais/${doc.id}?formato=xml`} download>Baixar XML</a>}
          {canCancel && cancel === null && <Button variant="secondary" size="sm" disabled={pending} onClick={() => setCancel("")}>Cancelar NFC-e</Button>}
          {canResolve && !resolver && <Button variant="secondary" size="sm" disabled={pending} onClick={() => setResolver(true)}>Resolver fora do CRM</Button>}
        </div>
      )}
    </section>
  );
}

/** A nota que a Gestão pode resolver fora do CRM: erro no envio, enviando já enviada (attempts > 0) ou autorizada. */
const resolvivel = (doc: { status: string; attempts: number } | null | undefined) =>
  !!doc && (doc.status === "erro_envio" || doc.status === "autorizada" || (doc.status === "pendente" && doc.attempts > 0));

const ESCOLHAS = [
  { value: "nao_saiu", label: "Conferi no portal: a nota NÃO saiu" },
  { value: "saiu_resolvida", label: "A nota saiu e foi resolvida fora do CRM (cancelada/estornada no portal ou na SEFAZ)" },
] as const;

/** "Resolver fora do CRM": a escolha, o motivo (15 letras) e, se a nota saiu, a chave (opcional). O servidor confere tudo de novo. */
function ResolverFora({ docId, onCancel, onDone }: { docId: string; onCancel: () => void; onDone: () => void | Promise<void> }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<(typeof ESCOLHAS)[number]["value"] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [chave, setChave] = useState("");
  const motivoOk = motivo.trim().replace(/\s+/g, " ").length >= 15;
  const confirm = () => start(async () => {
    if (!escolha) return;
    setError(null);
    const r = await resolverNotaFora(docId, { escolha, motivo, chave: escolha === "saiu_resolvida" && chave.trim() ? chave.trim() : null });
    if (!r.ok) { setError(r.error ?? "Não foi possível registrar. Tente de novo."); return; }
    toast("Nota resolvida fora do CRM");
    await onDone();
  });
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-alert/40 p-3">
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">O que você conferiu no portal do governo?</legend>
        {ESCOLHAS.map((o) => (
          <label key={o.value} className="flex items-center gap-2 min-h-9 text-sm">
            <input type="radio" name={`resolver-${docId}`} checked={escolha === o.value} onChange={() => setEscolha(o.value)} className="size-4" />{o.label}
          </label>
        ))}
      </fieldset>
      <SheetLabel><label htmlFor={`resolver-motivo-${docId}`}>Motivo</label></SheetLabel>
      <Input id={`resolver-motivo-${docId}`} value={motivo} maxLength={255} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: conferi no nfse.gov.br pela chave" />
      <FieldError>{!motivoOk ? "Escreva o motivo (pelo menos 15 letras)." : null}</FieldError>
      {escolha === "saiu_resolvida" && (<>
        <SheetLabel><label htmlFor={`resolver-chave-${docId}`}>Chave de acesso (opcional)</label></SheetLabel>
        <Input id={`resolver-chave-${docId}`} value={chave} inputMode="numeric" maxLength={60} onChange={(e) => setChave(e.target.value)} />
      </>)}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Voltar</Button>
        <Button variant="danger" size="sm" disabled={pending || !escolha || !motivoOk} onClick={confirm}>Registrar</Button>
      </div>
    </div>
  );
}
