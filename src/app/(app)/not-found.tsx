import { ErrorScreen, NOT_FOUND_TEXT } from "@/components/error-screen";

/** 404 dentro do sistema (`notFound()` de uma tela: cliente apagada, link velho): com o menu ao lado e a saída para o Hoje. */
export default function AppNotFound() {
  return <ErrorScreen {...NOT_FOUND_TEXT} inShell />;
}
