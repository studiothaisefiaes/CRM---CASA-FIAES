import { requirePerm } from "@/server/auth/session";
import { getClientAlertConfig } from "@/server/domain/client-alert";
import { getFuncoes } from "@/server/domain/funcoes";
import { AvisoClienteSettings } from "@/components/config/aviso-cliente-settings";

export const metadata = { title: "Aviso da cliente" };

/** Configurações › Agenda e caixa › Aviso da cliente: onde o aviso salta e o texto de quem não autorizou uso de imagem. Pede config.diaadia. */
export default async function AvisoClientePage() {
  await requirePerm("config.aviso_cliente");
  const [config, funcoes] = await Promise.all([getClientAlertConfig(), getFuncoes()]);
  return <AvisoClienteSettings config={config} avisoOn={funcoes.aviso_salta} />;
}
