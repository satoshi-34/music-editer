// src/components/ScorePageAutosaveDeps.test.tsx
// Issue #107: 自動保存の依存配列から保存対象の state が漏れると、その state だけを
// 編集して閉じたときに変更が失われる（実際に ensembleSecondStaffParts が漏れており、
// 編成譜の大譜表で下段だけ編集して閉じると復元されなかった）。
//
// この不具合は「個別の state を1つ足し忘れる」形で何度でも再発しうるため、
// 個々の振る舞いではなく**不変条件そのもの**を検証する:
//
//   buildScoreData（＝保存される譜面内容を組み立てる関数）が読む state は、
//   自動保存 useEffect の依存配列にすべて含まれていなければならない。
//
// 依存配列は React の仕様上リテラル配列でなければならず、実行時に取り出せないため、
// ソースを読んで両者の依存配列を突き合わせる静的検査として実装している
// （振る舞いテストではないので、自動保存が実際に localStorage へ書くことの検証は
// storage.test.ts の saveAutosave のテストが担当する）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_PATH = join(__dirname, 'ScorePage.tsx');

// 自動保存 useEffect の直前に置かれている目印コメント。
const AUTOSAVE_EFFECT_MARKER = '// 自動保存（編集から 1.5 秒後に localStorage へ保存）';
const BUILD_SCORE_DATA_MARKER = 'const buildScoreData = useCallback(';

/**
 * 指定位置以降に最初に現れる依存配列 `}, [ ... ]);` を読み取り、識別子の配列にする。
 * 関数本体の内側には `}, 1500);` のような閉じ方しか無いため、`}, [` を目印にすれば
 * 依存配列だけを取り出せる。
 */
function readDepsAfter(source: string, markerIndex: number): string[] {
  const depsStart = source.indexOf('}, [', markerIndex);
  expect(depsStart, '依存配列が見つからない（ScorePage.tsx の構造が変わった可能性）').toBeGreaterThan(-1);
  const open = source.indexOf('[', depsStart);
  const close = source.indexOf(']', open);
  return source
    .slice(open + 1, close)
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

describe('自動保存の依存配列は保存対象の state を網羅する（Issue #107）', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');

  it('buildScoreData が読む state は、すべて自動保存の依存配列に含まれる', () => {
    const buildScoreDataIndex = source.indexOf(BUILD_SCORE_DATA_MARKER);
    expect(buildScoreDataIndex, 'buildScoreData が見つからない').toBeGreaterThan(-1);
    const savedStateDeps = readDepsAfter(source, buildScoreDataIndex);

    const autosaveIndex = source.indexOf(AUTOSAVE_EFFECT_MARKER);
    expect(autosaveIndex, '自動保存 useEffect の目印コメントが見つからない').toBeGreaterThan(-1);
    const autosaveDeps = readDepsAfter(source, autosaveIndex);

    // 取り違え防止: 既知の代表的な依存が取れていることを先に確かめる
    expect(savedStateDeps).toContain('ensembleSecondStaffParts');
    expect(autosaveDeps).toContain('autosaveRestoreReady');

    const missing = savedStateDeps.filter((name) => !autosaveDeps.includes(name));
    expect(
      missing,
      `保存対象なのに自動保存の依存配列から漏れている state: ${missing.join(', ')}。` +
        'この state だけを編集して閉じると変更が失われる（Issue #107 と同じ不具合）',
    ).toEqual([]);
  });

  it('measuresPerSystem は自動保存の依存配列に含まれる（Issue #117）', () => {
    // measuresPerSystem は buildScoreData の外（saveAutosave 呼び出し時）で組み立てられる
    // 保存対象のため、上の buildScoreData ベースの不変条件チェックでは検出できない。
    // 個別に依存配列への同梱を検証する。
    const autosaveIndex = source.indexOf(AUTOSAVE_EFFECT_MARKER);
    expect(autosaveIndex, '自動保存 useEffect の目印コメントが見つからない').toBeGreaterThan(-1);
    const autosaveDeps = readDepsAfter(source, autosaveIndex);

    expect(
      autosaveDeps,
      '「段あたり小節数」（measuresPerSystem）だけを変更して閉じても自動保存されない（Issue #117 と同じ不具合）',
    ).toContain('measuresPerSystem');
  });
});
