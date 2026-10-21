// Som curto de alerta gerado no navegador (sem arquivo de áudio).
// O navegador só deixa tocar som depois de um gesto da pessoa: o AudioContext é criado/retomado no primeiro toque ou tecla.
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const MUTE_KEY = "cf-silencio-ate";
export function isMuted() { try { return Number(localStorage.getItem(MUTE_KEY) ?? 0) > Date.now(); } catch { return false; } }
export function muteFor(minutes: number) { try { localStorage.setItem(MUTE_KEY, String(Date.now() + minutes * 60_000)); } catch { /* sem storage */ } notify(); }
export function unmute() { try { localStorage.removeItem(MUTE_KEY); } catch { /* sem storage */ } notify(); }

/**
 * Som quando uma conversa passa do prazo (LateWatch): DESLIGADO por padrão (pesquisa de 20/10, fadiga de alerta: som só para
 * "a cliente escreveu"). Quem quiser liga no sino; vale só neste aparelho.
 */
const LATE_SOUND_KEY = "cf-som-atraso";
export function lateSoundOn() { try { return localStorage.getItem(LATE_SOUND_KEY) === "1"; } catch { return false; } }
export function setLateSound(on: boolean) { try { if (on) localStorage.setItem(LATE_SOUND_KEY, "1"); else localStorage.removeItem(LATE_SOUND_KEY); } catch { /* sem storage */ } notify(); }

/** "locked": ainda precisa de um toque para o som funcionar. */
export type AudioState = "locked" | "running" | "unsupported";
export function subscribeAudio(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

type Ctor = new () => AudioContext;
const ctor = (): Ctor | undefined => (globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor }).AudioContext ?? (globalThis as { webkitAudioContext?: Ctor }).webkitAudioContext;

export function audioState(): AudioState {
  if (!ctor()) return "unsupported";
  return ctx?.state === "running" ? "running" : "locked";
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const C = ctor();
  if (!C) return null;
  try {
    ctx = new C();
    // Se o navegador suspender depois (ex.: iPhone volta do fundo), o próximo toque libera de novo.
    ctx.addEventListener?.("statechange", () => { if (ctx?.state !== "running" && installed) addUnlock(); notify(); });
    return ctx;
  } catch { return null; }
}

// pointerdown só conta como gesto para mouse; no toque o navegador libera no pointerup/touchend.
const GESTURES = ["pointerdown", "pointerup", "touchend", "keydown"] as const;
let installed = false;
let listening = false;
function unlock() {
  const c = ensureCtx();
  if (!c) { removeUnlock(); return; }
  if (c.state === "running") { removeUnlock(); notify(); return; }
  c.resume().then(() => { if (c.state === "running") removeUnlock(); notify(); }, () => {});
}
function addUnlock() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  GESTURES.forEach((t) => window.addEventListener(t, unlock, { capture: true, passive: true }));
}
function removeUnlock() {
  if (!listening) return;
  listening = false;
  GESTURES.forEach((t) => window.removeEventListener(t, unlock, { capture: true }));
}

/** Liga os ouvintes do primeiro gesto (uma vez só; saem sozinhos quando o som fica liberado). */
export function installAudioUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  if (ctor()) addUnlock();
}
/** Para o botão "Toque para ativar o som": o próprio clique é o gesto. */
export const unlockAudio = unlock;

function beep(c: AudioContext) {
  const t = c.currentTime;
  [880, 1175].forEach((f, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.16);
    g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.22);
    o.connect(g).connect(c.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.25);
  });
}

/** No máximo um bipe a cada 3 s por aba: uma rajada de mensagens (foto + texto + áudio) não vira sirene. */
export const MIN_BEEP_GAP_MS = 3000;
let lastBeepAt = -Infinity;
function beepOnce(c: AudioContext) {
  const now = Date.now();
  if (now - lastBeepAt < MIN_BEEP_GAP_MS) return;
  lastBeepAt = now;
  beep(c);
}

export function playAlert() {
  if (isMuted()) return;
  if (Date.now() - lastBeepAt < MIN_BEEP_GAP_MS) return;
  try {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === "running") { beepOnce(c); return; }
    // Suspenso (ex.: o iPhone suspende ao voltar do fundo): tenta retomar. Só toca se voltar logo — nada de bipe atrasado depois.
    const asked = Date.now();
    c.resume().then(() => { notify(); if (c.state === "running" && Date.now() - asked < 1500) beepOnce(c); }, () => {});
  } catch { /* navegador sem áudio */ }
}
