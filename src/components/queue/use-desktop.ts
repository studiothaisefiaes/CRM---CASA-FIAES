"use client";
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Desktop (≥ 1024 px)? No servidor e na hidratação vale "não": só serve a coisas que abrem depois de um toque (folhas, menus). */
export const useDesktop = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
