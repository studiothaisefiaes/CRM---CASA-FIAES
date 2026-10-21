/** Celular pelo User-Agent (não é a regra final: a janela decide no navegador; serve para o servidor não montar a tela errada). Tablet Android sem "Mobile" e iPad não contam. */
export const isMobileUserAgent = (ua: string | null | undefined): boolean => !!ua && /iPhone|iPod|Android.*Mobile|Mobile.*Android|Windows Phone|Opera Mini|webOS/i.test(ua);
