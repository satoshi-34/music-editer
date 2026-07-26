import { execSync } from 'node:child_process'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// フィードバックボタン（Issue #91）で「どのビルドで発生したか」を報告に含めるための
// ビルド時 git sha 埋め込み。Docker イメージ（.dockerignore で .git を除外）や
// shallow clone など .git が読めない環境でも失敗させず 'dev' にフォールバックする。
function resolveGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_GIT_SHA__: JSON.stringify(resolveGitSha()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // .claude/worktrees・.night-worktrees には他セッションの古いリポジトリコピーが
    // 残ることがあり、既定の除外設定だけでは拾ってしまうため明示的に除外する
    // （ESLint 側は #48 で同様の対応済み）
    exclude: [...configDefaults.exclude, '.claude/**', '.night-worktrees/**'],
  },
})