import { afterEach, describe, expect, it, vi } from "vitest";
import { markUrlAhead, setRefreshing, takeUrlAhead, whenRefreshIdle } from "./refresh-gate";

afterEach(() => { setRefreshing(false); vi.useRealTimers(); });

describe("portão do refresh (troca de conversa x router.refresh)", () => {
  it("sem refresh a caminho roda na hora; com refresh, só quando ele termina (a mesma função uma vez só)", () => {
    const fn = vi.fn();
    whenRefreshIdle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    setRefreshing(true);
    whenRefreshIdle(fn); whenRefreshIdle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    setRefreshing(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("refresh preso: depois de 10 s a URL volta a ser trocada", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    setRefreshing(true);
    whenRefreshIdle(fn);
    vi.advanceTimersByTime(9_999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("URL trocada por replaceState: o próximo refresh sabe (uma vez)", () => {
    expect(takeUrlAhead()).toBe(false);
    markUrlAhead();
    expect(takeUrlAhead()).toBe(true);
    expect(takeUrlAhead()).toBe(false);
  });
});
