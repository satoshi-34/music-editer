import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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