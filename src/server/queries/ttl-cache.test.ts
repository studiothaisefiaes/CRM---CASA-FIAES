import { describe, expect, it } from "vitest";
import { cached } from "./ttl-cache";

describe("cached (contagens que podem atrasar alguns segundos)", () => {
  it("reaproveita dentro do prazo, refaz depois; falha não fica guardada", async () => {
    let n = 0;
    const f = async () => ++n;
    expect(await cached("t1", 1000, f, 0)).toBe(1);
    expect(await cached("t1", 1000, f, 500)).toBe(1);
    expect(await cached("t1", 1000, f, 1500)).toBe(2);
    await expect(cached("t2", 1000, async () => { throw new Error("x"); }, 0)).rejects.toThrow("x");
    await Promise.resolve();
    expect(await cached("t2", 1000, f, 10)).toBe(3);
  });
});
