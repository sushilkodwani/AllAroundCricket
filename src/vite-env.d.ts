/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __APP_BUILT_AT__: string

interface ImportMetaEnv {
  readonly VITE_DATA_OWNER?: string
  readonly VITE_DATA_REPO?: string
  readonly VITE_VAPID_PUBLIC_KEY?: string
}
