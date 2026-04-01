declare const __APP_VERSION__: string;
declare const __APP_COMMIT_DATE__: string;
declare const __APP_CHANGELOG_JSON__: string; // JSON array of { version, date, changes[] }

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
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
