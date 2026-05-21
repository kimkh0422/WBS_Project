declare module 'virtual:app-release' {
  export const APP_VERSION: string;
  export const APP_COMMIT_DATE: string;
  /** JSON 문자열 — `JSON.parse` 후 `{ version, date, changes[] }[]` */
  export const APP_CHANGELOG_JSON: string;
}

declare module '*.png' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_HIDDEN_VIEWS?: string;
  readonly VITE_ENABLE_PRESENCE?: string;
  readonly VITE_REALTIME_ENABLED?: string;
  /** billing: paid(기본) | free — free면 Realtime 부가기능 최소화 */
  readonly VITE_BILLING_PLAN?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
