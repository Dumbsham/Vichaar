const languageNames: Record<string, string> = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்' };

export function languageLabel(code: string): string {
  return languageNames[code] ?? code.toUpperCase();
}

export function formatDate(iso: string, language: string): string {
  const locale = language === 'hi' ? 'hi-IN' : language === 'ta' ? 'ta-IN' : 'en-IN';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}
