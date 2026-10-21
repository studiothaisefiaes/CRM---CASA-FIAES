import { ErrorScreen, NOT_FOUND_TEXT } from "@/components/error-screen";

export const metadata = { title: "Página não encontrada" };

/** 404 de endereço que não existe (e do `notFound()` fora do sistema): português, a marca da Casa e a saída para o Hoje. */
export default function NotFound() {
  return <ErrorScreen {...NOT_FOUND_TEXT} />;
}
