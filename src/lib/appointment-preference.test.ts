import { expect, it } from "vitest";
import { matchesPreference, parseAvecPreference, parsePreferenceFilter, PREFERENCE_LABEL } from "./appointment-preference";

it("o Avec: só Preferencial e Sem Preferência viram preferência; o resto fica sem informar", () => {
  expect(parseAvecPreference("Preferencial")).toBe("escolhida");
  expect(parseAvecPreference("SEM PREFERÊNCIA")).toBe("sem_preferencia");
  expect(parseAvecPreference("Sem preferencia")).toBe("sem_preferencia");
  expect(parseAvecPreference("Encaixe")).toBeNull();
  expect(parseAvecPreference("")).toBeNull();
  expect(parseAvecPreference(null)).toBeNull();
});

it("filtro: Escolhida · Tanto faz · Não informado; inválido é nenhum filtro", () => {
  expect(parsePreferenceFilter("tanto_faz")).toBe("tanto_faz");
  expect(parsePreferenceFilter("x")).toBeNull();
  expect(matchesPreference("escolhida", "escolhida")).toBe(true);
  expect(matchesPreference("sem_preferencia", "tanto_faz")).toBe(true);
  expect(matchesPreference(null, "nao_informado")).toBe(true);
  expect(matchesPreference("escolhida", "nao_informado")).toBe(false);
  expect(matchesPreference(null, null)).toBe(true);
  expect(PREFERENCE_LABEL).toEqual({ escolhida: "Pediu ela", sem_preferencia: "Tanto faz" });
});
