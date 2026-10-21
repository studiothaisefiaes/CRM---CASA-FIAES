// @vitest-environment jsdom
import { it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCrossedThreshold } from "./use-crossed-threshold";

it("verdadeiro só no render que cruza o limite", () => {
  const { result, rerender } = renderHook(({ v }) => useCrossedThreshold(v, 120), { initialProps: { v: 100 } });
  expect(result.current).toBe(false);
  rerender({ v: 121 }); expect(result.current).toBe(true);
  rerender({ v: 122 }); expect(result.current).toBe(false);
  rerender({ v: 10 }); rerender({ v: 130 }); expect(result.current).toBe(true);
});

it("nasce já passado do limite: não conta como cruzamento (nada pulsa ao abrir a tela)", () => {
  const { result, rerender } = renderHook(({ v }) => useCrossedThreshold(v, 120), { initialProps: { v: 500 } });
  expect(result.current).toBe(false);
  rerender({ v: 501 }); expect(result.current).toBe(false);
});

it("limite que anda com o valor anterior: 'subiu' (0 -> 1 e 2 -> 3), nunca no primeiro render, nem igual, nem descendo", () => {
  const { result, rerender } = renderHook(({ v }) => useCrossedThreshold(v, (prev) => prev + 1), { initialProps: { v: 3 } });
  expect(result.current).toBe(false); // primeiro render
  rerender({ v: 4 }); expect(result.current).toBe(true);
  rerender({ v: 4 }); expect(result.current).toBe(true); // mesmo valor: repete a última resposta, não é novo cruzamento
  rerender({ v: 2 }); expect(result.current).toBe(false); // desceu
  rerender({ v: 0 }); expect(result.current).toBe(false);
  rerender({ v: 1 }); expect(result.current).toBe(true);
});
