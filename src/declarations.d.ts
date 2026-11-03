declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module '*.css' {
  const css: string;
  export default css;
}

declare module '*.jpg' {
  const url: string;
  export default url;
}

import type { MotusCapLiteApi } from './preload';

declare global {
  interface Window {
    motuscapLite?: MotusCapLiteApi;
  }
}

export {};
