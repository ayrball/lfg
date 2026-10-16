/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** Public website, e.g. https://lfg.example.com — used for share links from the apps. */
  readonly VITE_SITE_URL?: string;
  /** 'true' once Firebase (Android) / APNs (iOS) push is configured. */
  readonly VITE_NATIVE_PUSH?: string;
  /** Optional store / download links shown on the website's landing page. */
  readonly VITE_ANDROID_URL?: string;
  readonly VITE_IOS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
