"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { mudarNfceModo, mudarNfseModo, salvarFiscalEmpresa, salvarFiscalRegras } from "@/app/(app)/config/nota-fiscal/actions";
import { formatCnpj } from "@/lib/cnpj";
import { cn } from "@/lib/cn";
import {
  ALIQUOTA_ISS_BP, DEFAULT_FISCAL_TEXTOS, FISCAL_REGRAS_LIMITES, FISCAL_TEXT_VARS, NAO_CONFIRMADO, NBS_SUGERIDO, type FiscalEmpresa, type FiscalModo, type FiscalRegras, type FiscalTextKey,
} from "@/lib/fiscal-settings";

const MODOS: { value: FiscalModo; label: string; help: string }[] = [
  { value: "desligada", label: "Desligada", help: "Desligada: a Casa emite à mão no nfse.gov.br." },
  { value: "teste", label: "Teste", help: "Teste: emite no ambiente de teste do governo (sem valor fiscal)." },
  { value: "producao", label: "Produção", help: "Produção: emite de verdade." },
];
const MODOS_NFCE: { value: FiscalModo; label: string; help: string }[] = [
  { value: "desligada", label: "Desligada", help: "Desligada: o CRM não emite NFC-e." },
  { value: "teste", label: "Teste", help: "Teste: emite na homologação da SEFAZ (sem valor fiscal)." },
  { value: "producao", label: "Produção", help: "Produção: emite a NFC-e de verdade na SEFAZ-BA." },
];
const TEXTOS: { key: FiscalTextKey; label: string; help: string }[] = [
  { key: "servicos", label: "Texto dos serviços", help: "A frase da nota com os serviços feitos." },
  { key: "parceria", label: "Texto da parceria", help: "Acrescentado quando a comanda tem profissional parceira (salão-parceiro)." },
  { key: "cotaParceira", label: "Texto da cota de cada parceira", help: "Uma vez por parceira; as cotas ficam unidas por “; ”." },
];
const bpText = (bp: number | null) => (bp == null ? "" : (bp / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const bpOf = (t: string, min = 0, max = 10000): number | null | "erro" => {
  if (!t.trim()) return null;
  const n = Number(t.trim().replace("%", "").replace(",", "."));
  const bp = Math.round(n * 100);
  return Number.isFinite(n) && bp >= min && bp <= max ? bp : "erro";
};
const onlyDigits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h3 id={id} className="mb-3 text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}
const row = "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3";

/**
 * Configurações › Nota fiscal: "Como a Casa emite nota fiscal?" Quatro blocos: Situação (a chave e o que falta), Dados da Casa, Padrão dos serviços
 * e Regras e textos. Certificado, senha e CSC não aparecem aqui: ficam no .env do servidor.
 */
export function FiscalSettingsForm({ empresa, regras, nfse, nfce, missing, missingNfce = [] }: {
  empresa: FiscalEmpresa; regras: FiscalRegras; nfse: FiscalModo; nfce: FiscalModo; missing: string[]; missingNfce?: string[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Dados da Casa + Padrão dos serviços (um objeto só, dois botões Salvar).
  const [e, setE] = useState(() => ({
    cnpj: formatCnpj(empresa.cnpj), razaoSocial: empresa.razaoSocial ?? "", inscricaoMunicipal: empresa.inscricaoMunicipal ?? "", inscricaoEstadual: empresa.inscricaoEstadual ?? "",
    regime: empresa.regime ?? "", aliquota: bpText(empresa.aliquotaSimplesBp), aliquotaIss: bpText(empresa.aliquotaIssBp), logradouro: empresa.endereco?.logradouro ?? "", numero: empresa.endereco?.numero ?? "",
    bairro: empresa.endereco?.bairro ?? "", cep: empresa.endereco?.cep ?? "", cTribNac: empresa.cTribNacPadrao, nbs: empresa.nbsPadrao ?? "",
    serieDps: String(empresa.serieDps), serieNfce: String(empresa.serieNfce), emitirAoFechar: empresa.emitirAoFechar,
  }));
  const set = <K extends keyof typeof e>(k: K, v: (typeof e)[K]) => setE((x) => ({ ...x, [k]: v }));
  const empresaOut = (): FiscalEmpresa | string => {
    const aliquota = bpOf(e.aliquota);
    if (aliquota === "erro") return "A alíquota do Simples fica entre 0% e 100%.";
    const aliquotaIss = bpOf(e.aliquotaIss, ALIQUOTA_ISS_BP.min, ALIQUOTA_ISS_BP.max);
    if (aliquotaIss === "erro") return "A alíquota do ISS fica entre 2% e 5%.";
    const parts = [e.logradouro, e.numero, e.bairro, e.cep].map((x) => x.trim());
    if (parts.some(Boolean) && !parts.every(Boolean)) return "Preencha o endereço inteiro (rua, número, bairro e CEP) ou deixe tudo vazio.";
    return {
      cnpj: e.cnpj.trim() || null, razaoSocial: e.razaoSocial.trim() || null, inscricaoMunicipal: e.inscricaoMunicipal.trim() || null, inscricaoEstadual: e.inscricaoEstadual.trim() || null,
      regime: e.regime === "simples" || e.regime === "presumido" ? e.regime : null, aliquotaSimplesBp: aliquota, aliquotaIssBp: aliquotaIss, codigoMunicipio: "2927408",
      endereco: parts.every(Boolean) ? { logradouro: parts[0], numero: parts[1], bairro: parts[2], cep: parts[3] } : null,
      cTribNacPadrao: e.cTribNac.trim(), nbsPadrao: e.nbs.trim() || null, serieDps: Number(e.serieDps), serieNfce: Number(e.serieNfce), emitirAoFechar: e.emitirAoFechar,
    };
  };
  const saveEmpresa = () => start(async () => {
    const out = empresaOut();
    if (typeof out === "string") { setError(out); return; }
    const r = await salvarFiscalEmpresa(out);
    setError(r.ok ? null : r.error);
    toast(r.ok ? "Nota fiscal salva" : r.error, r.ok ? "ok" : "error");
    if (r.ok) router.refresh();
  });

  // Regras e textos.
  const fromRegras = (r: FiscalRegras) => ({
    rascunhoNaComanda: r.rascunhoNaComanda, tentativasMax: String(r.tentativasMax), esperaMaxMin: String(r.esperaMaxMin), certAvisoDias: String(r.certAvisoDias),
    nfceCancelarAteMin: String(r.nfceCancelarAteMin), assinaturaNfse: r.assinaturaNfse, informarAliquotaNaDps: r.informarAliquotaNaDps, textos: r.textos,
  });
  const [g, setG] = useState(() => fromRegras(regras));
  const dirtyRegras = JSON.stringify(g) !== JSON.stringify(fromRegras(regras));
  const saveRegras = () => start(async () => {
    const r = await salvarFiscalRegras({
      rascunhoNaComanda: g.rascunhoNaComanda, tentativasMax: Number(g.tentativasMax), esperaMaxMin: Number(g.esperaMaxMin), certAvisoDias: Number(g.certAvisoDias),
      nfceCancelarAteMin: Number(g.nfceCancelarAteMin), assinaturaNfse: g.assinaturaNfse, informarAliquotaNaDps: g.informarAliquotaNaDps, textos: g.textos,
    });
    setError(r.ok ? null : r.error);
    toast(r.ok ? "Regras e textos salvos" : r.error, r.ok ? "ok" : "error");
    if (r.ok) router.refresh();
  });
  const num = (k: "tentativasMax" | "esperaMaxMin" | "certAvisoDias" | "nfceCancelarAteMin") => (
    <Input inputMode="numeric" className="w-24" value={g[k]} onChange={(ev) => setG((x) => ({ ...x, [k]: onlyDigits(ev.target.value, 5) }))} />
  );
  const lim = (k: keyof typeof FISCAL_REGRAS_LIMITES) => `De ${FISCAL_REGRAS_LIMITES[k][0]} a ${FISCAL_REGRAS_LIMITES[k][1]}.`;

  const trocarModo = (m: FiscalModo, kind: "nfse" | "nfce" = "nfse") => start(async () => {
    const r = kind === "nfce" ? await mudarNfceModo(m) : await mudarNfseModo(m);
    setError(r.ok ? null : r.error);
    toast(r.ok ? `${kind === "nfce" ? "NFC-e" : "Nota fiscal"}: ${MODOS.find((x) => x.value === m)!.label}` : r.error, r.ok ? "ok" : "error");
    if (r.ok) router.refresh();
  });
  const chave = (kind: "nfse" | "nfce", atual: FiscalModo, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {MODOS.map((m) => (
        <button key={m.value} type="button" role="radio" aria-checked={atual === m.value} disabled={pending} onClick={() => atual !== m.value && trocarModo(m.value, kind)}
          className={cn("min-h-11 rounded-full border px-4 text-sm transition-colors disabled:opacity-60 lg:min-h-9", atual === m.value ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>{m.label}</button>
      ))}
    </div>
  );
  const falta = (list: string[], ok: string) => (
    <div className="mt-4">
      <p className="text-sm font-medium text-graphite">{list.length ? "O que falta para emitir" : "Pronta para emitir"}</p>
      {list.length ? <ul className="mt-1 list-disc pl-5 text-sm text-alert">{list.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="mt-1 text-sm text-muted">{ok}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Como a Casa emite nota fiscal?</h2>
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}

      <Block id="nf-situacao" title="Situação">
        <section aria-label="Nota de serviço (NFS-e)">
          <h4 className="mb-2 text-sm font-semibold text-graphite">Nota de serviço (NFS-e)</h4>
          {chave("nfse", nfse, "Chave da nota de serviço (NFS-e)")}
          <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">{MODOS.map((m) => <li key={m.value}>{m.help}</li>)}</ul>
          {falta(missing, "Dados da Casa, certificado e parceiras conferidos.")}
        </section>
        <section aria-label="Nota do produto (NFC-e)" className="mt-5 border-t border-line pt-4">
          <h4 className="mb-2 text-sm font-semibold text-graphite">Nota do produto (NFC-e)</h4>
          {chave("nfce", nfce, "Chave da nota do produto (NFC-e)")}
          <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">{MODOS_NFCE.map((m) => <li key={m.value}>{m.help}</li>)}</ul>
          {falta(missingNfce, "Dados da Casa, certificado e CSC conferidos.")}
        </section>
      </Block>

      <Block id="nf-casa" title="Dados da Casa">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CNPJ da Casa" htmlFor="nf-cnpj"><Input id="nf-cnpj" inputMode="numeric" value={e.cnpj} onChange={(ev) => set("cnpj", formatCnpj(ev.target.value))} placeholder="00.000.000/0000-00" /></Field>
          <Field label="Razão social" htmlFor="nf-razao"><Input id="nf-razao" value={e.razaoSocial} onChange={(ev) => set("razaoSocial", ev.target.value)} maxLength={150} /></Field>
          <Field label="Inscrição municipal" htmlFor="nf-im"><Input id="nf-im" value={e.inscricaoMunicipal} onChange={(ev) => set("inscricaoMunicipal", ev.target.value)} maxLength={20} /></Field>
          <Field label="Inscrição estadual" htmlFor="nf-ie" hint="Só a nota do produto (NFC-e) pede."><Input id="nf-ie" value={e.inscricaoEstadual} onChange={(ev) => set("inscricaoEstadual", ev.target.value)} maxLength={20} /></Field>
          <Field label="Regime tributário" htmlFor="nf-regime">
            <Select id="nf-regime" value={e.regime} onChange={(ev) => set("regime", ev.target.value)}>
              <option value="">Não informado</option><option value="simples">Simples Nacional</option><option value="presumido">Lucro presumido</option>
            </Select>
          </Field>
          <Field label="Alíquota do Simples (%)" htmlFor="nf-aliq" hint="A alíquota efetiva da Casa, como está no contador."><Input id="nf-aliq" inputMode="decimal" value={e.aliquota} onChange={(ev) => set("aliquota", ev.target.value)} placeholder="Ex.: 6,00" className="w-32" /></Field>
          <Field label="Rua" htmlFor="nf-rua"><Input id="nf-rua" value={e.logradouro} onChange={(ev) => set("logradouro", ev.target.value)} maxLength={120} /></Field>
          <Field label="Número" htmlFor="nf-num"><Input id="nf-num" value={e.numero} onChange={(ev) => set("numero", ev.target.value)} maxLength={20} className="w-32" /></Field>
          <Field label="Bairro" htmlFor="nf-bairro"><Input id="nf-bairro" value={e.bairro} onChange={(ev) => set("bairro", ev.target.value)} maxLength={80} /></Field>
          <Field label="CEP" htmlFor="nf-cep"><Input id="nf-cep" inputMode="numeric" value={e.cep} onChange={(ev) => set("cep", ev.target.value)} maxLength={9} className="w-36" /></Field>
        </div>
        <p className="mt-3 text-sm text-muted">Município: Salvador (código 2927408). O certificado digital A1 e o CSC ficam no servidor, nunca aqui.</p>
        <div className="mt-4 flex justify-end"><Button loading={pending} onClick={saveEmpresa}>Salvar dados da Casa</Button></div>
      </Block>

      <Block id="nf-servicos" title="Padrão dos serviços">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código do serviço na nota (cTribNac)" htmlFor="nf-ctrib" hint="6 números. 060101 é cabeleireiro, manicure e congêneres. Cada serviço pode ter o seu em Serviços e pacotes."><Input id="nf-ctrib" inputMode="numeric" value={e.cTribNac} onChange={(ev) => set("cTribNac", onlyDigits(ev.target.value, 6))} className="w-32" /></Field>
          <Field label="NBS padrão" htmlFor="nf-nbs" hint={<>9 números; vazio por enquanto. Sugestão: {NBS_SUGERIDO}. <button type="button" className="text-gold-ink underline-offset-4 hover:underline" onClick={() => set("nbs", NBS_SUGERIDO)}>Usar o sugerido</button></>}>
            <Input id="nf-nbs" inputMode="numeric" value={e.nbs} onChange={(ev) => set("nbs", onlyDigits(ev.target.value, 9))} className="w-40" />
          </Field>
          <Field label="Alíquota do ISS (só se “Informar a alíquota na nota” estiver ligado)" htmlFor="nf-iss" hint="De 2% a 5%. Vai na nota como a alíquota do ISS; a do Simples continua como o total aproximado de tributos.">
            <Input id="nf-iss" inputMode="decimal" value={e.aliquotaIss} onChange={(ev) => set("aliquotaIss", ev.target.value)} placeholder="Ex.: 3,00" className="w-32" />
          </Field>
          <Field label="Série da DPS (NFS-e)" htmlFor="nf-sdps"><Input id="nf-sdps" inputMode="numeric" value={e.serieDps} onChange={(ev) => set("serieDps", onlyDigits(ev.target.value, 3))} className="w-24" /></Field>
          <Field label="Série da NFC-e" htmlFor="nf-snfce"><Input id="nf-snfce" inputMode="numeric" value={e.serieNfce} onChange={(ev) => set("serieNfce", onlyDigits(ev.target.value, 3))} className="w-24" /></Field>
        </div>
        <div className={cn(row, "mt-4")}>
          <span className="text-sm">Emitir a nota sozinha ao fechar a comanda<span className="block text-xs text-muted">Só vale com a chave em Teste ou Produção.</span></span>
          <Switch checked={e.emitirAoFechar} label="Emitir a nota ao fechar a comanda" onChange={(v) => set("emitirAoFechar", v)} />
        </div>
        <div className="mt-4 flex justify-end"><Button loading={pending} onClick={saveEmpresa}>Salvar padrão dos serviços</Button></div>
      </Block>

      <Block id="nf-regras" title="Regras e textos">
        <div className="grid gap-2.5">
          <div className={row}>
            <span className="text-sm">Mostrar “Dados da nota (para o nfse.gov.br)” na comanda fechada<span className="block text-xs text-muted">Com a chave Desligada, ajuda a copiar os dados para emitir à mão.</span></span>
            <Switch checked={g.rascunhoNaComanda} label="Mostrar os dados da nota na comanda" onChange={(v) => setG((x) => ({ ...x, rascunhoNaComanda: v }))} />
          </div>
          <label className={row}><span className="text-sm">Tentativas de envio<span className="block text-xs text-muted">Envios com falha antes de a nota ficar com erro. {lim("tentativasMax")}</span></span>{num("tentativasMax")}</label>
          <label className={row}><span className="text-sm">Espera máxima entre tentativas (minutos)<span className="block text-xs text-muted">{lim("esperaMaxMin")}</span></span>{num("esperaMaxMin")}</label>
          <label className={row}><span className="text-sm">Avisar o vencimento do certificado (dias)<span className="block text-xs text-muted">“Certificado vence em X dias” aparece em “O que falta para emitir”. {lim("certAvisoDias")}</span></span>{num("certAvisoDias")}</label>
          <label className={row}><span className="text-sm">Cancelar a NFC-e até (minutos)<span className="block text-xs text-muted">A regra da Bahia é de 30 minutos (RICMS-BA, art. 107-H). {lim("nfceCancelarAteMin")}</span></span>{num("nfceCancelarAteMin")}</label>
          <label className={cn(row, "flex-col items-stretch sm:flex-row sm:items-center")}>
            <span className="text-sm">Assinatura da NFS-e<span className="block text-xs text-alert">{NAO_CONFIRMADO}</span><span className="block text-xs text-muted">O manual de 2022 diz SHA-1; o guia de 2025 diz SHA-256.</span></span>
            <Select aria-label="Assinatura da NFS-e" className="w-32" value={g.assinaturaNfse} onChange={(ev) => setG((x) => ({ ...x, assinaturaNfse: ev.target.value === "sha256" ? "sha256" : "sha1" }))}>
              <option value="sha1">SHA-1</option><option value="sha256">SHA-256</option>
            </Select>
          </label>
          <div className={row}>
            <span className="text-sm">Informar a alíquota na nota<span className="block text-xs text-alert">{NAO_CONFIRMADO}</span><span className="block text-xs text-muted">Para ME e EPP sem retenção, o Anexo I proíbe informar a alíquota se o município estiver “Ativo”.</span></span>
            <Switch checked={g.informarAliquotaNaDps} label="Informar a alíquota na nota" onChange={(v) => setG((x) => ({ ...x, informarAliquotaNaDps: v }))} />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {TEXTOS.map((t) => (
            <Field key={t.key} label={t.label} htmlFor={`nf-txt-${t.key}`}
              hint={<>{t.help} Variáveis: {FISCAL_TEXT_VARS[t.key].map((v) => `{${v}}`).join(", ")}. <button type="button" className="text-gold-ink underline-offset-4 hover:underline" aria-label={`Usar o texto sugerido: ${t.label}`}
                onClick={() => setG((x) => ({ ...x, textos: { ...x.textos, [t.key]: DEFAULT_FISCAL_TEXTOS[t.key] } }))}>Usar o texto sugerido</button></>}>
              <Textarea id={`nf-txt-${t.key}`} rows={2} value={g.textos[t.key]} onChange={(ev) => setG((x) => ({ ...x, textos: { ...x.textos, [t.key]: ev.target.value } }))} maxLength={600} />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex justify-end"><SaveButton loading={pending} dirty={dirtyRegras} onClick={saveRegras}>Salvar regras e textos</SaveButton></div>
      </Block>
    </div>
  );
}
