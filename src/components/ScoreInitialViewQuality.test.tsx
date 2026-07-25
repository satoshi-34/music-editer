// src/components/ScoreInitialViewQuality.test.tsx
// Issue #71: 新規作成直後（データが空の状態）の初期表示を、全譜種で「五線紙品質」に保つ。
//
// ここで固定したいのは、譜種ごとの具体的な段数そのものではなく（音符の大きさなどの
// 既定値が変われば段数も変わってよい）、どの譜種でも壊れていない初期表示とは何か、
// という不変条件のほう:
//
//   I1. ページが「実段1つ＋空の段」で満たされる（空の段が0個＝下半分が空白、にならない）
//   I2. 段の中身（五線）が、その段に割り当てられた箱（SVG）に収まる
//       ＝隣の段へはみ出して重ならない
//   I3. 段内の譜表間隔が、五線そのものの高さに対して極端に広くない（浄書として自然）
//
// I2/I3 が壊れると、弦楽四重奏・編成譜で「1段だけ表示されて残りが空白」「下のパートが
// 次の段に重なる」という初期表示の崩れになる（Issue #71 の報告そのもの）。
// jsdom は実レイアウトを計算しないため、描画そのものではなく「描画に使う寸法計算」
// （measureLayoutUtils）の側で不変条件を検証する。実画面での確認はブラウザ実測で行う。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  computeLayout,
  staveSpacingForPartCount,
  measuredSystemHeightPx,
  recommendedSystemHeightPx,
  SYSTEM_BREATHING_ROOM_PX,
  SCORE_LAYOUT_RENDER_SCALE,
} from '../utils/measureLayoutUtils';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

// 各譜種の「1段に描かれる五線の数」。ScorePage.tsx の partCountForSystemLayout と
// 同じ値（単旋律1・ピアノ2・弦楽四重奏4・室内オーケストラ8＝Fl/Ob/Hn＋弦5）。
const PART_COUNTS = {
  単旋律: 1,
  ピアノ: 2,
  弦楽四重奏: 4,
  室内オーケストラ: 8,
} as const;

describe('新規作成直後の初期表示（Issue #71）: 段の寸法の不変条件', () => {
  it('I2: 段の中身（最下段の五線の下端）が、段の箱の高さ（sysH）に収まる', () => {
    // 描画は Stave を staveYs へ置き、ctx.scale(s,s) でまとめて s 倍する。
    // したがって段の実寸は sysH * s で、五線の下端も同じ座標系で sysH 以内に
    // 収まっている必要がある。ここが崩れると中身だけが箱からはみ出し、
    // 次の段（空の段を含む）と視覚的に重なる（Issue #71 の重なりバグ）。
    //
    // 注意: このテストが検証するのは寸法計算（computeLayout）側の整合性だけで、
    // 「PianoSystemCanvas が実際にこの座標系で Stave を置いているか」までは見ていない
    // （jsdom は VexFlow のレイアウトを実際には計算しないため）。今回の不具合の実体は
    // 描画側が staveYs を描画倍率で割ってしまい、この座標系から外れていたことだった。
    // 実描画が箱に収まることは、ブラウザ実測（SVGのviewBox高さと中身の下端の比較）で
    // 確認している（.claude/specs/... の検証結果を参照）。
    for (const [name, n] of Object.entries(PART_COUNTS)) {
      const { staveYs, sysH } = computeLayout(n);
      const lastStaveTop = staveYs[staveYs.length - 1];
      // VexFlow の五線は line0〜line4 の4間隔ぶん（＝40座標単位）の高さを持つ
      const STAVE_INK_UNITS = 40;
      expect(lastStaveTop + STAVE_INK_UNITS, `${name}: 五線の下端が段の高さに収まる`)
        .toBeLessThanOrEqual(sysH);
    }
  });

  it('I3: 段内の譜表間隔が、五線そのものの高さの3倍を超えない（間隔だけ広い間延びした段にならない）', () => {
    // かつては譜表の位置だけが音符の大きさに追従せず固定ピクセルのままだったため、
    // 五線は小さいのに間隔だけ広い（間隔が五線の3.3倍）段になっていた。
    const STAVE_INK_UNITS = 40;
    for (const [name, n] of Object.entries(PART_COUNTS)) {
      if (n < 2) continue;
      const spacing = staveSpacingForPartCount(n);
      expect(spacing, `${name}: 譜表間隔が五線の高さに対して極端に広くない`)
        .toBeLessThanOrEqual(STAVE_INK_UNITS * 3);
    }
  });

  it('推奨段数の基準の高さは「実測の段の高さ＋一定の余白」で、譜種によらず同じ余白を使う', () => {
    // 楽譜種別ごとにばらばらの固定係数を使っていたことが、パート数の多い譜種ほど
    // 推奨段数が過剰に少なくなる原因だった（Issue #71）。
    for (const n of Object.values(PART_COUNTS)) {
      expect(recommendedSystemHeightPx(n) - measuredSystemHeightPx(n))
        .toBeCloseTo(SYSTEM_BREATHING_ROOM_PX, 6);
    }
  });

  it('measuredSystemHeightPx は実際に描画される段の高さ（sysH × 描画倍率）と一致する', () => {
    for (const n of Object.values(PART_COUNTS)) {
      expect(measuredSystemHeightPx(n))
        .toBeCloseTo(computeLayout(n).sysH * SCORE_LAYOUT_RENDER_SCALE, 6);
    }
  });
});

describe('新規作成直後の初期表示（Issue #71）: 全譜種で五線紙のようにページが満たされる', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  function renderOnScoreTab() {
    const utils = render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    return utils;
  }

  // 楽譜種別の切り替えボタン名（「楽譜の種類」の4つ）
  const SCORE_TYPE_BUTTONS = ['単旋律', 'ピアノ', '弦楽四重奏', '編成譜'] as const;

  for (const label of SCORE_TYPE_BUTTONS) {
    it(`${label}: 実段1つ＋空の段でページが満たされ、あふれ警告も出ない`, () => {
      const { container } = renderOnScoreTab();
      fireEvent.click(screen.getByRole('button', { name: label }));

      const systemsPerPage = Number((screen.getByLabelText('段数/ページ') as HTMLInputElement).value);

      // I1: ページに2段以上入る想定なら、実段1つの残りは必ず空の段で埋まる。
      // 「1段だけ表示されて残りが空白」（Issue #71 の弦楽四重奏・編成譜の症状）だと
      // systemsPerPage が1になり、空の段が0個になる。
      expect(systemsPerPage, `${label}: 1ページに2段以上入る`).toBeGreaterThan(1);
      expect(
        container.querySelectorAll('.empty-stave-filler').length,
        `${label}: 残り容量ぶんの空の段でページが満たされる`
      ).toBe(systemsPerPage - 1);

      // 推奨値は実測の上限内に収まっているため、あふれ警告は出ない
      expect(screen.queryByRole('alert'), `${label}: あふれ警告が出ない`).toBeNull();
    });
  }
});
