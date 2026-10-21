import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button-styles";

/**
 * Tela de "não achei" e de erro (dsgfix, r68 #1): em português, com a marca da Casa e uma saída clara ("Voltar para o Hoje").
 * `inShell`: dentro do sistema (menu ao lado), sem a marca grande; fora dele, a página inteira centralizada com a marca.
 */
export function ErrorScreen({ title, text, action, code, inShell = false }: { title: string; text: string; action?: ReactNode; code?: string | null; inShell?: boolean }) {
  return (
    <main className={inShell ? "flex min-h-[70dvh] items-center px-5 py-12 lg:px-8" : "flex min-h-dvh items-center justify-center bg-paper px-5 py-12"}>
      <div className="mx-auto flex w-full max-w-[520px] flex-col items-center text-center">
        {!inShell && <p className="mb-8 font-display text-xl font-normal tracking-[-0.02em] text-ink">Casa <span className="text-gold-ink">Fiaes</span></p>}
        <svg width="56" height="28" viewBox="0 0 88 44" aria-hidden className="mb-5 text-gold">
          <path d="M2 30 C14 30 16 8 28 10 C40 12 32 34 22 30 C12 26 24 6 44 12 C62 18 58 36 50 34 C40 31 52 10 70 16 C80 19 84 22 86 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <h1 className="font-display text-2xl font-normal leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        <p className="mt-3 max-w-[42ch] text-base text-graphite">{text}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {action}
          <Link href="/" className={buttonClass({ variant: action ? "secondary" : "primary" })}>Voltar para o Hoje</Link>
        </div>
        {code && <p className="mt-6 text-xs text-muted">Código do erro: <span className="tabular">{code}</span></p>}
      </div>
    </main>
  );
}

export const NOT_FOUND_TEXT = { title: "Esta página não existe", text: "O endereço pode ter mudado ou estar escrito errado. Pelo menu você chega a tudo do sistema." } as const;
export const ERROR_TEXT = { title: "Algo deu errado nesta tela", text: "Nada do que você já salvou se perdeu. Tente de novo; se continuar, avise a gestão com o código abaixo." } as const;
