// Pilha de modais abertos: só o do topo trata Tab (trava de foco) e Esc.
const stack: number[] = [];
let next = 1;

/** Registra um modal que acabou de abrir e devolve o id dele. */
export function pushModal(): number { const id = next++; stack.push(id); return id; }
/** Remove o modal da pilha (ao fechar). */
export function popModal(id: number) { const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1); }
/** `true` quando é o modal mais ao topo. */
export function isTop(id: number) { return stack[stack.length - 1] === id; }
