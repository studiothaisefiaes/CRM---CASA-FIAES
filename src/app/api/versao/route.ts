import { NextResponse } from "next/server";
import { buildId } from "@/server/build-id";

export const dynamic = "force-dynamic";

/**
 * A versão do CRM que o servidor está rodando (20/10, Cati: atualização derrubava a tela). Leve, sem banco: a tela pergunta a cada
 * minuto e ao voltar para a janela e, se mudou, mostra "Versão nova do CRM. Atualizar" (`VersionWatch`). Só com sessão (proxy).
 */
export function GET() {
  return NextResponse.json({ versao: buildId() }, { headers: { "Cache-Control": "no-store" } });
}
