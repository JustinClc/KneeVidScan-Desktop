import { useSyncExternalStore } from 'react';
import { backendClient } from './backendClient';
import {
  getLocale,
  setLocale as storeLocale,
  subscribeLocale,
  t,
  type Locale,
} from './locale';

function publish(next: Locale) {
  void backendClient.publishLocale?.(next)?.catch(() => {});
}

export function useLocale(): {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: typeof t;
} {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return {
    locale,
    setLocale: (next: Locale) => {
      storeLocale(next);
      publish(next);
    },
    t,
  };
}
