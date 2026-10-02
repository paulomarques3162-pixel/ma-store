/**
 * Marca nominal (branded type).
 *
 * Permite distinguir valores com o mesmo tipo base mas semânticas diferentes
 * (ex.: gramas x centímetros) em tempo de compilação, sem custo em runtime.
 */
declare const brandSymbol: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };
