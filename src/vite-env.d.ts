/// <reference types="vite/client" />

/**
 * 앱에서 사용하는 커스텀 VITE_ 환경변수 타입.
 * 동적 키 접근(예: viteEnvTruthy)을 위해 인덱스 시그니처도 둔다.
 */
interface ImportMetaEnv {
  readonly VITE_PROJECT_STATUS_ONLY?: string;
  readonly VITE_FORCE_EVERYONE_ADMIN?: string;
  readonly VITE_HIDDEN_VIEWS?: string;
  readonly [key: string]: string | boolean | undefined;
}
