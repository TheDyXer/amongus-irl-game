import type { Lang } from '../api/types';

export type Params = Record<string, string | number>;
export type Catalog = ReadonlyMap<string, string>;
export type Catalogs = Record<Lang, Catalog>;

const pluralRules: Record<Lang, Intl.PluralRules> = {
  en: new Intl.PluralRules('en'),
  hu: new Intl.PluralRules('hu'),
};

/** Flattens namespace files into one catalog keyed `<prefix>.<key>`. */
export function catalog(namespaces: Record<string, Record<string, string>>): Catalog {
  const out = new Map<string, string>();
  for (const [prefix, entries] of Object.entries(namespaces)) {
    for (const [key, text] of Object.entries(entries)) out.set(`${prefix}.${key}`, text);
  }
  return out;
}

function lookup(entries: Catalog, lang: Lang, key: string, count: number | undefined): string | undefined {
  if (count === undefined) return entries.get(key);
  return entries.get(`${key}_${pluralRules[lang].select(count)}`) ?? entries.get(`${key}_other`) ?? entries.get(key);
}

/**
 * Text for `key` in `lang`, else in English, else the key itself. A numeric `count` param picks
 * the `key_one` / `key_other` form; `{name}` placeholders are filled from `params`.
 */
export function translate(catalogs: Catalogs, lang: Lang, key: string, params?: Params): string {
  const count = typeof params?.count === 'number' ? params.count : undefined;
  const text = lookup(catalogs[lang], lang, key, count) ?? lookup(catalogs.en, 'en', key, count) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (slot, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : slot));
}
