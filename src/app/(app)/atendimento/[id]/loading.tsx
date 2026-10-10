import { ConversationOpening } from "@/components/queue/conversation-opening";

/** Celular: ao tocar numa conversa da Fila a tela já troca; o cabeçalho e a última mensagem saem do item que a lista tinha. */
export default function Loading() {
  return (
    <main className="h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh overflow-hidden grid grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="hidden lg:block border-r border-line bg-paper" aria-hidden />
      <ConversationOpening />
    </main>
  );
}
