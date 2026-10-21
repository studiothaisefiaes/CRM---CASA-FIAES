import { describe, expect, it } from "vitest";
import { pushToast } from "./toast-queue";

type T = { id: number; action?: { label: string } };
const undo = { label: "Desfazer" };

describe("pushToast", () => {
  it("o Desfazer não é empurrado por outros avisos", () => {
    let list: T[] = [{ id: 1, action: undo }];
    for (const id of [2, 3, 4, 5, 6]) list = pushToast(list, { id });
    expect(list.map((t) => t.id)).toEqual([1, 5, 6]); // sai o mais antigo sem ação
  });
  it("sem passar do limite, nada sai", () => {
    expect(pushToast<T>([{ id: 1 }, { id: 2 }], { id: 3 }).map((t) => t.id)).toEqual([1, 2, 3]);
  });
  it("só avisos com ação: sai o mais antigo", () => {
    const list: T[] = [{ id: 1, action: undo }, { id: 2, action: undo }, { id: 3, action: undo }];
    expect(pushToast(list, { id: 4, action: undo }).map((t) => t.id)).toEqual([2, 3, 4]);
  });
  it("o aviso novo nunca sai na hora", () => {
    const list: T[] = [{ id: 1, action: undo }, { id: 2, action: undo }, { id: 3, action: undo }];
    expect(pushToast(list, { id: 4 }).map((t) => t.id)).toContain(4);
  });
});
