// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Sheet } from "./sheet";
import { Dialog } from "./dialog";
import { isTop, popModal, pushModal } from "./modal-stack";

afterEach(cleanup);

function Stacked({ dialog, onSheet, onDialog }: { dialog: boolean; onSheet: () => void; onDialog: () => void }) {
  return (
    <>
      <button>abrir</button>
      <Sheet open onClose={onSheet} title="Lead">
        <input aria-label="Nota" />
        <button>Salvar nota</button>
      </Sheet>
      <Dialog open={dialog} onClose={onDialog} title="Fechar venda" footer={<button>Confirmar</button>}>
        <input aria-label="Valor" />
      </Dialog>
    </>
  );
}

const inDialog = () => screen.getByRole("dialog", { name: "Fechar venda" }).contains(document.activeElement);

describe("pilha de modais", () => {
  it("só o último empilhado é o topo", () => {
    const a = pushModal(); const b = pushModal();
    expect(isTop(a)).toBe(false); expect(isTop(b)).toBe(true);
    popModal(b); expect(isTop(a)).toBe(true);
    popModal(a); expect(isTop(a)).toBe(false);
  });

  it("Esc com Dialog sobre a Sheet fecha só o Dialog; depois fecha a Sheet", async () => {
    const onSheet = vi.fn(); const onDialog = vi.fn();
    const { rerender } = render(<Stacked dialog onSheet={onSheet} onDialog={onDialog} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDialog).toHaveBeenCalledTimes(1);
    expect(onSheet).not.toHaveBeenCalled();
    rerender(<Stacked dialog={false} onSheet={onSheet} onDialog={onDialog} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Fechar venda" })).toBeNull());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSheet).toHaveBeenCalledTimes(1);
    expect(onDialog).toHaveBeenCalledTimes(1);
  });

  it("Tab no Dialog empilhado fica dentro dele (a Sheet não puxa o foco)", async () => {
    render(<Stacked dialog onSheet={() => {}} onDialog={() => {}} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Valor"))); // foco inicial no Dialog
    screen.getByRole("button", { name: "Confirmar" }).focus();
    const sheet = screen.getByRole("dialog", { name: "Lead" });
    const stolen: Element[] = [];
    const spy = (e: FocusEvent) => { if (sheet.contains(e.target as Node)) stolen.push(e.target as Element); };
    document.addEventListener("focusin", spy);
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(inDialog()).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Nota"));
    // Shift+Tab no primeiro elemento do Dialog volta ao último do Dialog, não à Sheet
    screen.getByRole("dialog", { name: "Fechar venda" }).querySelector<HTMLElement>("button,input")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(inDialog()).toBe(true);
    document.removeEventListener("focusin", spy);
    expect(stolen).toEqual([]); // em nenhum momento o foco passou pela Sheet
  });

  it("sem Dialog por cima a Sheet trava o foco e fecha com Esc", async () => {
    const onSheet = vi.fn();
    render(<Stacked dialog={false} onSheet={onSheet} onDialog={() => {}} />);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Lead" }).contains(document.activeElement)).toBe(true));
    screen.getByRole("button", { name: "Salvar nota" }).focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Lead" }).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSheet).toHaveBeenCalledTimes(1);
  });
});
