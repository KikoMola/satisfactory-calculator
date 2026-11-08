/** Lower case without accents, so "lingote" finds "Lingote de hierro" and "acero" "Acero". */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** True when every word of `query` appears somewhere in `text` (accents and case ignored). */
export function matchesSearch(text: string, query: string): boolean {
  const haystack = normalizeSearch(text);
  return normalizeSearch(query)
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
