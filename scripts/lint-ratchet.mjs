// lint のエラー件数を「ラチェット（逆戻り防止の爪車）」で管理するスクリプト。
//
// このプロジェクトの lint エラーは長年の蓄積で数百件あり、
// 「ゼロになるまで CI を落とす」という運用が現実的でない。
// そこで「今より増えたら失敗、減ったら基準値を自動で締め直す」方式にして、
// 少しずつしか減らない代わりに、絶対に増えないことを保証する。
//
// 使い方:
//   npm run lint:ratchet          … 基準値と比較する（増えていたら終了コード1）
//   npm run lint:ratchet -- --check … 減っていても基準値を書き換えない（CI向け）

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const baselinePath = join(scriptDir, 'lint-baseline.json');

// --check が付いているときは基準値を書き換えない（CI で基準値だけ勝手に動くのを防ぐ）
const checkOnly = process.argv.includes('--check');

// eslint は「エラーがある＝終了コード1」なので、終了コードではなく JSON の中身で判断する。
// stdout が数MBになるので maxBuffer を明示的に広げておく（既定の1MBだと切れる）。
const result = spawnSync('npx', ['eslint', '.', '-f', 'json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error) {
  console.error('[lint:ratchet] eslint を起動できませんでした:', result.error.message);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  // JSON として読めない＝eslint 自体が設定エラーなどで異常終了したケース。
  // 件数を比較できないので、黙って通さずに異常終了させる。
  console.error('[lint:ratchet] eslint の出力を JSON として解釈できませんでした。');
  console.error(result.stdout.slice(0, 2000));
  console.error(result.stderr.slice(0, 2000));
  process.exit(2);
}

let errorCount = 0;
let warningCount = 0;
const byRule = {};
for (const file of report) {
  for (const message of file.messages) {
    const rule = message.ruleId ?? '(directive)';
    if (message.severity === 2) {
      errorCount++;
      byRule[rule] = (byRule[rule] ?? 0) + 1;
    } else {
      warningCount++;
    }
  }
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const maxErrors = baseline.maxErrors;

console.log(`[lint:ratchet] エラー ${errorCount} 件 / 警告 ${warningCount} 件（基準値 ${maxErrors} 件）`);

if (errorCount > maxErrors) {
  console.error(`[lint:ratchet] NG: エラーが基準値より ${errorCount - maxErrors} 件増えています。`);
  console.error('[lint:ratchet] 増えた分を直すか、`npx eslint .` で内容を確認してください。');
  console.error('[lint:ratchet] ルール別の内訳:');
  for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(count).padStart(4)}  ${rule}`);
  }
  process.exit(1);
}

if (errorCount < maxErrors) {
  const reduced = maxErrors - errorCount;
  if (checkOnly) {
    console.log(`[lint:ratchet] OK: 基準値より ${reduced} 件少ないです（--check のため基準値は更新しません）。`);
  } else {
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ ...baseline, maxErrors: errorCount }, null, 2)}\n`,
      'utf8',
    );
    console.log(`[lint:ratchet] OK: ${reduced} 件減りました。基準値を ${errorCount} 件へ更新しました。`);
    console.log('[lint:ratchet] scripts/lint-baseline.json の差分も一緒にコミットしてください。');
  }
  process.exit(0);
}

console.log('[lint:ratchet] OK: 基準値ちょうどです。');
process.exit(0);
