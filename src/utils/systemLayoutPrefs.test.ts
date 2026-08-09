// src/utils/systemLayoutPrefs.test.ts
// Issue #211: 「段あたり小節数」「段数/ページ」を楽譜種別ごとに保持する保存層の単体テスト。
// localStorage を触らない純関数（parse / migrate / get / with）だけをここで固める。
// 画面の挙動（種別を切り替えると値が戻る等）は
// src/components/ScorePagePerScoreTypeSystemLayout.test.tsx が担当する。

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEASURES_PER_SYSTEM,
  SYSTEM_LAYOUT_SCORE_TYPES,
  getMeasuresPerSystemFor,
  getSystemsPerPageFor,
  migrateLegacySystemsPerPage,
  parseSystemLayoutPrefs,
  withMeasuresPerSystem,
  withSystemsPerPage,
  type SystemLayoutPrefs,
} from './systemLayoutPrefs';

describe('parseSystemLayoutPrefs（保存済み JSON の解析）', () => {
  it('未保存（null）なら空を返す', () => {
    expect(parseSystemLayoutPrefs(null)).toEqual({});
  });

  it('JSON として壊れていても例外を投げず空を返す', () => {
    expect(parseSystemLayoutPrefs('{壊れた')).toEqual({});
  });

  it('オブジェクト以外（配列・数値）でも空を返す', () => {
    expect(parseSystemLayoutPrefs('[1,2,3]')).toEqual({});
    expect(parseSystemLayoutPrefs('42')).toEqual({});
  });

  it('種別ごとの値をそのまま復元する', () => {
    const raw = JSON.stringify({
      piano: { measuresPerSystem: 2, systemsPerPage: 4 },
      ensemble: { measuresPerSystem: 4 },
    });
    expect(parseSystemLayoutPrefs(raw)).toEqual({
      piano: { measuresPerSystem: 2, systemsPerPage: 4 },
      ensemble: { measuresPerSystem: 4 },
    });
  });

  it('知らない種別名は無視する', () => {
    const raw = JSON.stringify({ drumline: { measuresPerSystem: 2 }, single: { measuresPerSystem: 3 } });
    expect(parseSystemLayoutPrefs(raw)).toEqual({ single: { measuresPerSystem: 3 } });
  });

  it('範囲外・型違いの項目だけを落とし、同じ種別の生きている値は残す', () => {
    const raw = JSON.stringify({
      piano: { measuresPerSystem: 99, systemsPerPage: 3 },
      single: { measuresPerSystem: '4', systemsPerPage: 0 },
      quartet: { measuresPerSystem: 2.5, systemsPerPage: 2 },
    });
    expect(parseSystemLayoutPrefs(raw)).toEqual({
      // 99 は 1〜8 の範囲外なので落ち、段数/ページだけが残る
      piano: { systemsPerPage: 3 },
      // 文字列の '4' と 0 段はどちらも不正なので、single のエントリごと消える
      quartet: { systemsPerPage: 2 },
    });
  });
});

describe('migrateLegacySystemsPerPage（旧単一キーからの移行）', () => {
  it('旧キーの値を全楽譜種別の初期値としてコピーする', () => {
    const migrated = migrateLegacySystemsPerPage('3');
    for (const scoreType of SYSTEM_LAYOUT_SCORE_TYPES) {
      expect(getSystemsPerPageFor(migrated, scoreType)).toBe(3);
    }
  });

  it('旧キーが無い・壊れている場合は空（全種別が未設定）を返す', () => {
    expect(migrateLegacySystemsPerPage(null)).toEqual({});
    expect(migrateLegacySystemsPerPage('abc')).toEqual({});
    expect(migrateLegacySystemsPerPage('0')).toEqual({});
  });

  it('移行しても「段あたり小節数」は埋めない（旧形式にそのキーが存在しないため）', () => {
    const migrated = migrateLegacySystemsPerPage('3');
    expect(getMeasuresPerSystemFor(migrated, 'ensemble')).toBe(DEFAULT_MEASURES_PER_SYSTEM);
  });
});

describe('種別ごとの値の読み書き', () => {
  it('未設定の種別は既定値を返す（直前に使っていた別種別の値は引き継がない）', () => {
    const prefs = withMeasuresPerSystem({}, 'piano', 2);
    expect(getMeasuresPerSystemFor(prefs, 'piano')).toBe(2);
    expect(getMeasuresPerSystemFor(prefs, 'ensemble')).toBe(DEFAULT_MEASURES_PER_SYSTEM);
    expect(getSystemsPerPageFor(prefs, 'ensemble')).toBeNull();
  });

  it('ある種別を書き換えても、他の種別の値は変わらない', () => {
    const before: SystemLayoutPrefs = {
      piano: { measuresPerSystem: 2, systemsPerPage: 4 },
      ensemble: { measuresPerSystem: 4, systemsPerPage: 1 },
    };
    const after = withMeasuresPerSystem(before, 'piano', 6);
    expect(after.ensemble).toEqual({ measuresPerSystem: 4, systemsPerPage: 1 });
    expect(getMeasuresPerSystemFor(after, 'piano')).toBe(6);
    // 同じ種別のもう一方の項目も巻き添えで消えない
    expect(getSystemsPerPageFor(after, 'piano')).toBe(4);
  });

  it('元のオブジェクトを書き換えない（純関数）', () => {
    const before: SystemLayoutPrefs = { piano: { measuresPerSystem: 2 } };
    withSystemsPerPage(before, 'piano', 4);
    expect(before).toEqual({ piano: { measuresPerSystem: 2 } });
  });

  it('段数/ページに null を渡すと「未設定（推奨値を使う）」へ戻る', () => {
    const before = withSystemsPerPage({}, 'quartet', 2);
    expect(getSystemsPerPageFor(before, 'quartet')).toBe(2);
    const after = withSystemsPerPage(before, 'quartet', null);
    expect(getSystemsPerPageFor(after, 'quartet')).toBeNull();
    expect(JSON.stringify(after)).not.toContain('systemsPerPage');
  });

  it('保存→解析を往復しても値が変わらない', () => {
    const prefs = withSystemsPerPage(withMeasuresPerSystem({}, 'ensemble', 2), 'ensemble', 1);
    expect(parseSystemLayoutPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });
});
