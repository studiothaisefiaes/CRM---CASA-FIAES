// Som curto de alerta gerado no navegador (sem arquivo de áudio).
let ctx: AudioContext | null = null;
export function playAlert() {
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
