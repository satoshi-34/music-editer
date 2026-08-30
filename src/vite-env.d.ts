/// <reference types="vite/client" />

// vite.config.ts の define で埋め込むビルド時 git sha（フィードバックボタン用、Issue #91）
declare const __APP_GIT_SHA__: string

// vite.config.ts の define で埋め込むアプリのバージョン（package.json の version、Issue #500）
declare const __APP_VERSION__: string
