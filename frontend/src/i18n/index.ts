import { useSyncExternalStore } from 'react';
import type { Lang } from '../api/types';
import enCommon from './en/common.json';
import enErrors from './en/errors.json';
import enGm from './en/gm.json';
import enMonitor from './en/monitor.json';
import enPairing from './en/pairing.json';
import huCommon from './hu/common.json';
import huErrors from './hu/errors.json';
import huGm from './hu/gm.json';
import huMonitor from './hu/monitor.json';
import huPairing from './hu/pairing.json';
import { catalog, translate, type Catalogs, type Params } from './translate';

export type Translate = (key: string, params?: Params) => string;

// errors.json holds the server's err.* codes, so it is keyed under "err" and t(code) works as is.
const catalogs: Catalogs = {
  en: catalog({ common: enCommon, monitor: enMonitor, pairing: enPairing, gm: enGm, err: enErrors }),
  hu: catalog({ common: huCommon, monitor: huMonitor, pairing: huPairing, gm: huGm, err: huErrors }),
};

const translators: Record<Lang, Translate> = {
  en: (key, params) => translate(catalogs, 'en', key, params),
  hu: (key, params) => translate(catalogs, 'hu', key, params),
};

let current: Lang = 'en';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const listener of listeners) listener();
}

/** Translates in the current language outside React (event handlers, tests). */
export const t: Translate = (key, params) => translators[current](key, params);

/** The translator for the current language; the component re-renders when it changes. */
export function useT(): Translate {
  return translators[useSyncExternalStore(subscribe, getLang, getLang)];
}
