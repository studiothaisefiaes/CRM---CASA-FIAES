import { it, expect } from "vitest";
import { transferOptions } from "./transfer-options";

it("quem está disponível vem primeiro, com estado e quantas esperam; a dona atual fica de fora", () => {
  const people = [
    { id: "a", name: "Ana Souza", availability: "ausente", priorityLevel: 1, waiting: 0 },
    { id: "b", name: "Bia Lima", availability: "disponivel", priorityLevel: 2, waiting: 2 },
    { id: "c", name: "Carla", availability: "disponivel", priorityLevel: 1, waiting: 1 },
    { id: "d", name: "Dora", availability: "pausa", priorityLevel: 1, waiting: 0 },
  ];
  expect(transferOptions(people, "c")).toEqual([
    { id: "b", label: "Bia Lima", detail: "Disponível · 2 esperando" },
    { id: "d", label: "Dora", detail: "Em pausa" },
    { id: "a", label: "Ana Souza", detail: "Ausente" },
  ]);
  expect(transferOptions([{ id: "x", name: "Xu", availability: "disponivel", priorityLevel: 1, waiting: 1 }], null)[0].detail).toBe("Disponível · 1 esperando");
});
