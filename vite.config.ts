import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// ホーム画面のフッターに出すアプリのバージョン（Issue #500）。
// package.json の version を唯一の正本にして、画面側に版番号を手書きしない
// （手書きすると更新を忘れ、リリースノートと突き合わせられなくなる）。
function resolveAppVersion(): string {
  try {
    const pkgUrl = new URL('./package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf-8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

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
  server: {
    watch: {
      // .night-worktrees には夜間ルーチンの git worktree（リポジトリの完全なコピー）が
      // 作られる。dev サーバーがその配下の変更まで監視すると、夜間作業のたびに
      // 大量の reload と tsconfig 再検出が走り、CPU を浪費する（2026-08-01 に
      // Air で実発生）。vitest/ESLint 側の除外（下の test.exclude / #48）と同趣旨。
      ignored: ['**/.night-worktrees/**', '**/.claude/worktrees/**'],
    },
  },
  define: {
    __APP_GIT_SHA__: JSON.stringify(resolveGitSha()),
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // .claude/worktrees・.night-worktrees には他セッションの古いリポジトリコピーが
    // 残ることがあり、既定の除外設定だけでは拾ってしまうため明示的に除外する
    // （ESLint 側は #48 で同様の対応済み）
    exclude: [...configDefaults.exclude, '.claude/**', '.night-worktrees/**'],
    // jsdom + VexFlow の描画を伴うテストが重く、GitHub Actions のランナーでは
    // vitest 既定の 5000ms を超えることがある（#133）。ローカル・CIで同じ値が
    // 効くようここで一括指定する
    testTimeout: 20000,
  },
})