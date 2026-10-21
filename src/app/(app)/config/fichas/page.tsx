import { requirePerm } from "@/server/auth/session";
import { listQuestions } from "@/server/domain/fichas";
import { getFuncoes } from "@/server/domain/funcoes";
import { getPhotoConfig } from "@/server/domain/client-photos";
import { FichasEditor } from "@/components/config/fichas-editor";
import { FotosConfig } from "@/components/config/fotos-config";
import { isFichaForm } from "@/lib/fichas";

export const metadata = { title: "Fichas da cliente" };

/** Configurações › Clientes › Fichas da cliente: as perguntas da Anamnese, da Consultoria de imagem e dos Campos da ficha (`?ficha=`), e o tamanho máximo da foto de antes e depois. Pede config.fichas. */
export default async function FichasPage({ searchParams }: PageProps<"/config/fichas">) {
  await requirePerm("config.fichas");
  const f = (await searchParams).ficha;
  const form = isFichaForm(f) ? f : "anamnese";
  const [questions, funcoes, photo] = await Promise.all([listQuestions(form, { all: true }), getFuncoes(), getPhotoConfig()]);
  return (
    <div className="flex flex-col gap-6">
      <FichasEditor form={form} questions={questions} fichasOn={funcoes.fichas} />
      <FotosConfig maxMb={photo.maxMb} fotosOn={funcoes.fotos} />
    </div>
  );
}
