// src/utils/engravingScreenFloor.test.ts
// Issue #210: 編成譜の縮小表示で線が細すぎて見えない問題への「画面表示の太さの下限（フロア）」。
//
// このファイルが見張るのは次の4つ。
//   1. 実測した各譜種の縮尺で、フロアが「発動すべきところだけ」発動すること
//      （数値はブラウザでの実測値。design.md §15 の表と同じもの）
//   2. フロアを掛けても候補Aの相対比（五線 < 小節線 …）が崩れないこと
//   3. 極端な縮小でも黒く塗り潰れないよう上限で頭打ちになること
//   4. 塗り矩形の縦線（小節線・終止線の太線）に、CSS からフロアを掛けるための
//      目印のクラスが付くこと、および App.css 側の数値がずれていないこと

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ENGRAVING_THICKNESS_UNITS,
  MAX_SCREEN_STROKE_FLOOR_MULTIPLIER,
  MIN_STAFF_LINE_DEVICE_PX,
  VF_THICK_LINE_RECT_CLASS,
  VF_THIN_LINE_RECT_CLASS,
  computeScreenStrokeFloorMultiplier,
  markThickBarlineRect,
  widenThinBarlineRect,
} from './engravingDefaults';

const appCss = readFileSync(resolve(__dirname, '../App.css'), 'utf8');

/** ブラウザで実測した「SVG論理単位1つが画面の何 CSS px になるか」（2026-08-09・1440x900・dpr2） */
const MEASURED_TOTAL_DISPLAY_SCALE = {
  /** 単旋律・100%表示（音符の大きさ既定 150%） */
  single: 0.572931,
  /** ピアノ・100%表示（同上） */
  piano: 0.572911,
  /** 室内オーケストラ・100%表示 */
  chamberOrchestra: 0.381948,
  /** 室内オーケストラ・ズーム50%（運用者が「細すぎやて」と報告した画面） */
  chamberOrchestraHalf: 0.190974,
} as const;

/** その縮尺・その倍率のときの五線の実効太さ（CSS px） */
function staffLineScreenPx(totalDisplayScale: number, multiplier: number): number {
  return ENGRAVING_THICKNESS_UNITS.staffLine * totalDisplayScale * multiplier;
}

describe('computeScreenStrokeFloorMultiplier（画面表示の太さの下限）', () => {
  const retina = { devicePixelRatio: 2 };

  it('単旋律・ピアノの100%表示では発動しない（#195 で「現状で良い」と判定された見た目を変えない）', () => {
    expect(
      computeScreenStrokeFloorMultiplier({
        totalDisplayScale: MEASURED_TOTAL_DISPLAY_SCALE.single,
        ...retina,
      })
    ).toBe(1);
    expect(
      computeScreenStrokeFloorMultiplier({
        totalDisplayScale: MEASURED_TOTAL_DISPLAY_SCALE.piano,
        ...retina,
      })
    ).toBe(1);
  });

  it('室内オーケストラのズーム50%（報告された画面）では発動し、五線が1デバイスピクセルに届く', () => {
    const scale = MEASURED_TOTAL_DISPLAY_SCALE.chamberOrchestraHalf;
    const before = staffLineScreenPx(scale, 1);
    // 修正前は 0.248 CSS px = 0.50 デバイスピクセルしかなく、塗り切れずにかすれていた
    expect(before * 2).toBeLessThan(MIN_STAFF_LINE_DEVICE_PX);

    const m = computeScreenStrokeFloorMultiplier({ totalDisplayScale: scale, ...retina });
    expect(m).toBeGreaterThan(1);
    expect(staffLineScreenPx(scale, m) * 2).toBeCloseTo(MIN_STAFF_LINE_DEVICE_PX, 6);
  });

  it('全部の線に同じ倍率が掛かるので、候補Aの相対比は崩れない', () => {
    const scale = MEASURED_TOTAL_DISPLAY_SCALE.chamberOrchestraHalf;
    const m = computeScreenStrokeFloorMultiplier({ totalDisplayScale: scale, ...retina });
    const px = (units: number) => units * scale * m;
    // 五線 < 小節線 = 加線 < 終止線の太線（3 u）という主従が保たれていること。
    // 特に「細線だけ太らせて終止線の太線が細く見える」逆転が起きないこと（#210 の設計判断）
    expect(px(ENGRAVING_THICKNESS_UNITS.staffLine)).toBeLessThan(px(ENGRAVING_THICKNESS_UNITS.thinBarline));
    expect(px(ENGRAVING_THICKNESS_UNITS.thinBarline)).toBeLessThan(px(3));
    // 比率そのものは倍率に依らず一定
    expect(px(ENGRAVING_THICKNESS_UNITS.thinBarline) / px(ENGRAVING_THICKNESS_UNITS.staffLine)).toBeCloseTo(
      ENGRAVING_THICKNESS_UNITS.thinBarline / ENGRAVING_THICKNESS_UNITS.staffLine,
      10
    );
  });

  it('表示ウェイト「細い」はウェイトを適用したあとの実効値で判定する', () => {
    const scale = MEASURED_TOTAL_DISPLAY_SCALE.single;
    // 標準では発動しない縮尺でも、「細い」（0.8/1.2 倍）まで細らせると下限を割る
    expect(computeScreenStrokeFloorMultiplier({ totalDisplayScale: scale, ...retina })).toBe(1);
    const thin = computeScreenStrokeFloorMultiplier({
      totalDisplayScale: scale,
      strokeWeightScale: 0.8 / 1.2,
      ...retina,
    });
    expect(thin).toBeGreaterThan(1);
    // 下限ちょうどまでしか戻さない（「細い」を選んだ意図は残る）
    expect(staffLineScreenPx(scale, 1) * (0.8 / 1.2) * thin * 2).toBeCloseTo(MIN_STAFF_LINE_DEVICE_PX, 6);
  });

  it('dpr が低い画面ほど早く発動する（下限はデバイスピクセル基準）', () => {
    const scale = MEASURED_TOTAL_DISPLAY_SCALE.chamberOrchestra;
    expect(computeScreenStrokeFloorMultiplier({ totalDisplayScale: scale, devicePixelRatio: 1 })).toBeGreaterThan(
      computeScreenStrokeFloorMultiplier({ totalDisplayScale: scale, devicePixelRatio: 2 })
    );
  });

  it('極端な縮小では上限で頭打ちになり、五線が黒帯へ潰れない', () => {
    // 大編成を最小ズームで見るような、下限まで戻すと五線間隔の半分を超えてしまう縮尺
    const m = computeScreenStrokeFloorMultiplier({ totalDisplayScale: 0.02, devicePixelRatio: 2 });
    expect(m).toBe(MAX_SCREEN_STROKE_FLOOR_MULTIPLIER);
    // 太らせた五線が「この譜面でいちばん太い線（0.30 sp = 3 u）」を超えないこと
    expect(ENGRAVING_THICKNESS_UNITS.staffLine * m).toBeLessThanOrEqual(3);
  });

  it('壊れた値（0・負・NaN）が来てもフロアを掛けない（従来どおりの見た目に倒す）', () => {
    expect(computeScreenStrokeFloorMultiplier({ totalDisplayScale: 0 })).toBe(1);
    expect(computeScreenStrokeFloorMultiplier({ totalDisplayScale: -1 })).toBe(1);
    expect(computeScreenStrokeFloorMultiplier({ totalDisplayScale: Number.NaN })).toBe(1);
    expect(
      computeScreenStrokeFloorMultiplier({ totalDisplayScale: 0.1, strokeWeightScale: 0 })
    ).toBe(1);
    // devicePixelRatio が壊れている場合は 1 とみなして計算を続ける（発動判定は行う）
    expect(
      computeScreenStrokeFloorMultiplier({ totalDisplayScale: 0.19, devicePixelRatio: Number.NaN })
    ).toBeGreaterThan(1);
  });
});

describe('塗り矩形の縦線に、CSS からフロアを掛けるための目印が付く', () => {
  const makeRect = (attrs: Record<string, string>) => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries(attrs).forEach(([k, v]) => r.setAttribute(k, v));
    return r;
  };

  it('細い縦線（幅1）には thin のクラスが付く', () => {
    const rect = makeRect({ x: '100', width: '1' });
    widenThinBarlineRect(rect);
    expect(rect.classList.contains(VF_THIN_LINE_RECT_CLASS)).toBe(true);
    expect(rect.classList.contains(VF_THICK_LINE_RECT_CLASS)).toBe(false);
  });

  it('終止線の太線・メイン括弧（幅3）には thick のクラスが付き、幅は変わらない', () => {
    const rect = makeRect({ x: '50', width: '3' });
    expect(markThickBarlineRect(rect)).toBe(true);
    expect(rect.classList.contains(VF_THICK_LINE_RECT_CLASS)).toBe(true);
    expect(rect.getAttribute('width')).toBe('3');
    expect(rect.getAttribute('x')).toBe('50');
  });

  it('それ以外の幅の rect（当たり判定など）には何も付けない', () => {
    const rect = makeRect({ x: '0', width: '40' });
    expect(markThickBarlineRect(rect)).toBe(false);
    expect(rect.getAttribute('class')).toBeNull();
  });
});

describe('App.css 側のフロア指定が TypeScript 側の値とずれていない', () => {
  /** `.score-area svg rect.<class> { width: calc(<n>px * var(--score-stroke-floor, 1)); … }` を読む */
  function floorRule(className: string): { width: number; shift: number } {
    const re = new RegExp(
      `rect\\.${className}\\s*\\{\\s*width:\\s*calc\\(([\\d.]+)px\\s*\\*\\s*var\\(--score-stroke-floor,\\s*1\\)\\);\\s*transform:\\s*translateX\\(calc\\(-([\\d.]+)px\\s*\\*\\s*\\(var\\(--score-stroke-floor,\\s*1\\)\\s*-\\s*1\\)\\)\\);`
    );
    const m = re.exec(appCss);
    expect(m, `App.css に rect.${className} のフロア指定があること`).toBeTruthy();
    return { width: Number(m![1]), shift: Number(m![2]) };
  }

  it('細い縦線は小節線の太さ（1.6 u）を基準にし、広がった半分だけ左へ戻す', () => {
    const rule = floorRule(VF_THIN_LINE_RECT_CLASS);
    expect(rule.width).toBeCloseTo(ENGRAVING_THICKNESS_UNITS.thinBarline, 10);
    // 中心を保つので、ずらす量は基準幅のちょうど半分
    expect(rule.shift).toBeCloseTo(ENGRAVING_THICKNESS_UNITS.thinBarline / 2, 10);
  });

  it('太い縦線は VexFlow の幅 3 u を基準にする（太さ自体は #202 のまま変えない）', () => {
    const rule = floorRule(VF_THICK_LINE_RECT_CLASS);
    expect(rule.width).toBe(3);
    expect(rule.shift).toBe(1.5);
  });

  it('印刷ではフロアを 1 へ戻す（インライン style を打ち消すため !important 付き）', () => {
    expect(/--score-stroke-floor:\s*1\s*!important;/.test(appCss)).toBe(true);
  });
});
