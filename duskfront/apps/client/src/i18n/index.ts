/**
 * الترجمة وواجهة RTL.
 * i18n with full RTL support. Arabic is the default; direction, number formatting and
 * the document lang/dir attributes all follow the active locale.
 */
import ar from './ar.json';
import en from './en.json';

export type Locale = 'ar' | 'en';
type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Locale, Dictionary> = { ar, en };
const STORAGE_KEY = 'duskfront.locale';

let current: Locale = 'ar';
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

export function isRtl(): boolean {
  return current === 'ar';
}

export function setLocale(locale: Locale): void {
  if (!DICTIONARIES[locale]) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* private mode — direction still applies for this session */
  }
  applyDocumentDirection();
  for (const listener of listeners) listener(locale);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyDocumentDirection(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  document.documentElement.dataset.locale = current;
}

/**
 * العربية هي الافتراضي دائمًا (كما تنصّ المواصفات)؛ لا تُستبدل إلا باختيار صريح
 * سابق من اللاعب. لا نستنتج اللغة من إعدادات المتصفّح.
 * Arabic is always the default. Only an explicit previous choice overrides it — the
 * browser's locale never does, because the spec makes Arabic the product default.
 */
export function initLocale(preferred?: Locale): void {
  let locale: Locale = preferred ?? 'ar';
  if (!preferred) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (stored && DICTIONARIES[stored]) locale = stored;
    } catch {
      /* private mode: نبقى على العربية */
    }
  }
  current = locale;
  applyDocumentDirection();
}

/**
 * ترجمة مفتاح مع استبدال المعاملات {name}.
 * Falls back to English, then to the key itself, so a missing string is visible
 * in QA instead of rendering as an empty box.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dictionary = DICTIONARIES[current];
  let value = dictionary[key] ?? DICTIONARIES.en[key] ?? key;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
    }
  }
  return value;
}

/** أرقام محلية / locale-aware number formatting. */
export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(current === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** مدة بصيغة m:ss / duration as m:ss (always LTR so the clock never flips). */
export function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatPlayTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
