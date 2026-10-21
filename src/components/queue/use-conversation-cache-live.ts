"use client";
import { useEffect } from "react";
import { useLive } from "@/components/shell/live";
import { invalidateFromEvent } from "./conversation-cache";

/** Todo aviso do tempo real marca como velhas as conversas guardadas dos leads que ele toca (a próxima abertura busca de novo). */
export function useConversationCacheLive() {
  const { subscribe } = useLive();
  useEffect(() => subscribe(invalidateFromEvent), [subscribe]);
}
