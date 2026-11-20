/** Escapes LIKE/ILIKE wildcards so user input is matched literally (use with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
