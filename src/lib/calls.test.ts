import { describe, expect, it } from "vitest";
import { callDuration, callLabel, callPreview, callShort, durationLabel } from "./calls";

describe("ligações: textos", () => {
  it("duração legível, nunca inventada", () => {
    expect(durationLabel(45)).toBe("45 s");
    expect(durationLabel(185)).toBe("3 min");
    expect(durationLabel(3720)).toBe("1 h 2 min");
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(0)).toBeNull();
  });

  it("duração só com o início e o fim do atendimento", () => {
    expect(callDuration("2026-10-14T13:00:00.000Z", "2026-10-14T13:03:05.000Z")).toBe(185);
    expect(callDuration(null, "2026-10-14T13:03:05.000Z")).toBeNull();
    expect(callDuration("2026-10-14T13:00:00.000Z", null)).toBeNull();
    expect(callDuration("2026-10-14T13:05:00.000Z", "2026-10-14T13:00:00.000Z")).toBeNull();
  });

  it("rótulo completo: recebida/feita, atendida/perdida/recusada e a duração quando houver", () => {
    expect(callLabel({ video: false, status: "atendida", durationSecs: 185 }, "in")).toBe("Ligação recebida · atendida · 3 min");
    expect(callLabel({ video: false, status: "atendida" }, "in")).toBe("Ligação recebida · atendida");
    expect(callLabel({ video: false, status: "perdida" }, "in")).toBe("Ligação perdida");
    expect(callLabel({ video: true, status: "recusada" }, "in")).toBe("Ligação de vídeo recusada");
    expect(callLabel({ video: false, status: "atendida", durationSecs: 60 }, "out")).toBe("Ligação feita · atendida · 1 min");
    expect(callLabel({ video: false, status: "perdida" }, "out")).toBe("Ligação feita · não atendida");
  });

  it("rótulo curto e prévia da Fila com a anotação", () => {
    expect(callShort({ video: false, status: "atendida", durationSecs: 185 })).toBe("Ligação 3 min");
    expect(callShort({ video: false, status: "atendida" })).toBe("Ligação atendida");
    expect(callShort({ video: true, status: "perdida" })).toBe("Ligação de vídeo perdida");
    expect(callPreview({ video: false, status: "atendida", durationSecs: 185 }, "marcou corte sábado")).toBe("Ligação 3 min · marcou corte sábado");
    expect(callPreview({ video: false, status: "perdida" }, null)).toBe("Ligação perdida");
    expect(callPreview(null, null, "Ligação perdida")).toBe("Ligação perdida");
  });

  it("prévia da ligação feita pela Casa: 'Ligação feita · …'", () => {
    expect(callPreview({ video: false, status: "perdida", manual: true }, null, null, "out")).toBe("Ligação feita · não atendida");
    expect(callPreview({ video: false, status: "atendida", durationSecs: 240 }, "marcou escova", null, "out")).toBe("Ligação feita · atendida · 4 min · marcou escova");
  });
});
