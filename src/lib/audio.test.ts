import { it, expect } from "vitest";
import { audioPreview, formatDuration } from "./audio";

it("duração m:ss e h:mm:ss", () => {
  expect(formatDuration(42)).toBe("0:42");
  expect(formatDuration(75.4)).toBe("1:15");
  expect(formatDuration(3725)).toBe("1:02:05");
});

it("prévia do áudio: duração + começo da transcrição", () => {
  expect(audioPreview(42, "Oi, queria marcar escova")).toBe("Áudio (0:42): Oi, queria marcar escova");
  expect(audioPreview(42, null)).toBe("Áudio (0:42)");
  expect(audioPreview(null, null)).toBe("Áudio");
  expect(audioPreview(10, "a ".repeat(100), 10)).toBe("Áudio (0:10): a a a a a…");
});
