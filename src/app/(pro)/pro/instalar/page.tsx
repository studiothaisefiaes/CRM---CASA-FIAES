import Link from "next/link";
import { requirePro } from "@/server/auth/pro-session";
import { vapidConfig } from "@/server/env";
import { PushSetup } from "@/components/pro/push-setup";

export const metadata = { title: "Instalar" };

const STEP = "rounded-[var(--radius-card)] border border-line bg-paper p-4";

/** Depois de criar a senha: pôr na tela inicial (iPhone e Android), ativar avisos e receber um aviso de teste. */
export default async function ProInstallPage() {
  const { pro } = await requirePro();
  if (!pro) return null;
  return (
    <main className="flex flex-col gap-4">
      <h1 className="font-display text-xl">Pôr na tela inicial</h1>
      <section aria-labelledby="iphone" className={STEP}>
        <h2 id="iphone" className="font-medium">iPhone (Safari)</h2>
        <ol className="mt-2 list-decimal pl-5 text-sm leading-relaxed">
          <li>Toque em <b>Compartilhar</b> (o quadrado com a seta para cima, na barra de baixo).</li>
          <li>Role e toque em <b>Adicionar à Tela de Início</b>.</li>
          <li>Toque em <b>Adicionar</b>. Abra sempre pelo ícone <b>Minha agenda</b>.</li>
        </ol>
      </section>
      <section aria-labelledby="android" className={STEP}>
        <h2 id="android" className="font-medium">Android (Chrome)</h2>
        <ol className="mt-2 list-decimal pl-5 text-sm leading-relaxed">
          <li>Toque em <b>⋮</b> (os três pontinhos, no alto).</li>
          <li>Toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</li>
          <li>Confirme. Abra sempre pelo ícone <b>Minha agenda</b>.</li>
        </ol>
      </section>
      <section aria-labelledby="avisos" className={STEP}>
        <h2 id="avisos" className="font-medium">Ativar avisos</h2>
        <p className="mb-3 mt-1 text-sm text-graphite">Você recebe aviso de horário novo, remarcado ou cancelado, e quando a cliente chega. Fora do seu horário, o aviso espera você começar.</p>
        <PushSetup publicKey={vapidConfig()?.publicKey ?? null} />
      </section>
      <Link href="/pro" className="inline-flex min-h-11 items-center font-medium text-gold-ink">Ir para a minha agenda</Link>
    </main>
  );
}
