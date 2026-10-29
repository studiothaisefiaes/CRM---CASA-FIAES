import { requirePerm } from "@/server/auth/session";
import { aiEnv, aiSpend, getAiSettings } from "@/server/ai/settings";
import { AiSettingsForm } from "@/components/config/ai-settings";
import { AiManualForm } from "@/components/config/ai-manual";
import { getAiManual } from "@/server/ai/manual";
import { listLicoes } from "@/server/ai/licoes";
import { AiLicoes } from "@/components/config/ai-licoes";

export const metadata = { title: "Sugestão de resposta por IA" };

export default async function IaPage() {
  await requirePerm("config.sistema");
  const [s, spend, manual, licoes] = await Promise.all([getAiSettings(), aiSpend(), getAiManual(), listLicoes()]);
  const { apiKey, model } = aiEnv();
  return (
    // Computador (≥1100 px): à esquerda Ligada + como funciona + Gasto; à direita, larga, o manual. Celular: uma coluna.
    <div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <AiSettingsForm initial={s} spend={spend} hasKey={!!apiKey} model={model} />
        <AiLicoes initial={licoes} />
      </div>
      <AiManualForm initial={manual.secoes} updatedAt={manual.updatedAt?.toISOString() ?? null} />
    </div>
  );
}
