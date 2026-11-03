import { zhHans, zhHant } from './messages';
import { VIEW_ROLES } from './steps';

/** Which writing system the interface uses. English is the starting Locale. */
export type Locale = 'en' | 'zh-Hant' | 'zh-Hans';

export const LOCALE_STORAGE_KEY = 'motuscap-lite.locale';

const CATALOGS: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
  'zh-Hant': zhHant,
  'zh-Hans': zhHans,
};

export function parseLocale(value: string | null | undefined): Locale {
  if (value === 'zh-Hant' || value === 'zh-Hans' || value === 'en')
    return value;
  return 'en';
}

function readStored(): Locale {
  try {
    return parseLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return 'en';
  }
}

let locale: Locale = readStored();
const listeners = new Set<() => void>();

function htmlLang(value: Locale): string {
  if (value === 'zh-Hant') return 'zh-HK';
  if (value === 'zh-Hans') return 'zh-CN';
  return 'en';
}

function emit() {
  try {
    document.documentElement.lang = htmlLang(locale);
  } catch {
    /* tests and the phone page set lang themselves */
  }
  for (const listener of listeners) listener();
}

export function getLocale(): Locale {
  return locale;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLocale(next: Locale) {
  locale = parseLocale(next);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* storage can be unavailable */
  }
  emit();
}

export function resetLocaleForTests() {
  locale = 'en';
  try {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

function fill(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value == null ? match : String(value);
  });
}

/** Product copy in the current Locale. Missing wording stays English. */
export function t(
  text: string,
  vars?: Record<string, string | number>,
): string {
  const table = locale === 'en' ? undefined : CATALOGS[locale];
  const translated =
    table && Object.prototype.hasOwnProperty.call(table, text)
      ? table[text]
      : text;
  return fill(translated, vars);
}

/** Camera tile label. Role letters stay in filenames; the words around them translate. */
export function camLabel(camCount: number, index: number): string {
  if (camCount < 2) return t('Cam {n}', { n: index + 1 });
  const role = VIEW_ROLES[index];
  return role
    ? t('Cam {n} · {role}', { n: index + 1, role: t(role) })
    : t('Cam {n}', { n: index + 1 });
}
