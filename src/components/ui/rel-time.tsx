import { relTime } from "@/lib/format";

/**
 * "há 3 minutos" renderizado no servidor e hidratado no navegador: perto da virada do minuto os dois relógios dão textos diferentes.
 * O texto é só informativo, então a diferença não quebra a hidratação (o próximo render atualiza).
 */
export function RelTime({ at }: { at: string | Date }) {
  return <span suppressHydrationWarning>{relTime(at)}</span>;
}
