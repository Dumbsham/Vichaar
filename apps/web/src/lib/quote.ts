export function normalizeQuoteText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function quoteLength(value: string): number {
  return [...normalizeQuoteText(value)].length;
}
