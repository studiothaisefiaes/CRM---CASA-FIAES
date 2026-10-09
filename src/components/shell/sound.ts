// Som curto de alerta gerado no navegador (sem arquivo de áudio).
let ctx: AudioContext | null = null;
const MUTE_KEY = "cf-silencio-ate";
export function isMuted() { try { return Number(localStorage.getItem(MUTE_KEY) ?? 0) > Date.now(); } catch { return false; } }
export function muteFor(minutes: number) { try { localStorage.setItem(MUTE_KEY, String(Date.now() + minutes * 60_000)); } catch { /* sem storage */ } }
export function unmute() { try { localStorage.removeItem(MUTE_KEY); } catch { /* sem storage */ } }

export function playAlert() {
  if (isMuted()) return;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    [880, 1175].forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.22);
      o.connect(g).connect(ctx!.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.25);
    });
  } catch { /* navegador sem áudio */ }
}
