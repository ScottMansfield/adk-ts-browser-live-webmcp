/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional dev convenience: pre-fills the API key field. Never committed. */
  readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
