// 紙幅に収まる「音符の大きさ」を求めるフォールバックのテスト（Issue #477）。
//
// 実曲（ラヴェル ソナチネ）の持ち込みで「この小節は最小の1小節/段でも紙幅を超えます」警告が
// 出た原因は、16分×16イベントの小節を音符サイズ150%で組んでいたこと。ファイル指定の縮尺を
// 引き継いでも収まらない場合があるため、読込時に「収まる最大の倍率」まで下げる。
import { describe, it, expect } from 'vitest';
import {
  fitNotationSizeMultiplier,
  planEffectiveMeasuresPerSystem,
  worstCaseSystemContentBudget,
  SCORE_LAYOUT_RENDER_SCALE,
  SYSTEM_MAX_LABEL_WIDTH,
  NOTATION_SIZE_MULTIPLIER_MIN,
} from './measureLayoutUtils';
import type { MeasureData } from '../types/storage';

/**
 * 32分音符を n 個並べた密な小節（実曲の細かいパッセージ相当）。
 *
 * jsdom では VexFlow の実測（SVG のテキスト幅）がほぼ 0 を返すため、幅は見積もり式
 * （measureMinimumContentWidth）側で決まる。実ブラウザでは実測のほうが大きくなるので、
 * ここで固定したいのは「幅が予算を超えたら倍率が下がる」という関係であって、
 * 何個で溢れるかという具体的な個数ではない。
 */
function denseMeasure(n: number): MeasureData {
  const pitches = ['c#/5', 'd#/5', 'e/5', 'f#/5', 'g#/5', 'a#/5', 'b/5', 'c#/6'];
  const events = Array.from({ length: n }, (_, i) => ({
    dur: '32' as const,
    isRest: false,
    keys: [pitches[i % pitches.length]],
  }));
  return { events, voices: [{ id: 'voice-1', events }] };
}

/** ファイルが指定してきた「余白25mm」（本文幅が狭くなる）での段の本文予算。 */
function narrowBudget(): number {
  return worstCaseSystemContentBudget(25, SYSTEM_MAX_LABEL_WIDTH);
}

function planAt(multiplier: number, measures: MeasureData[]) {
  return planEffectiveMeasuresPerSystem(
    [{ measures, clef: 'treble' }],
    [4, 4],
    'C',
    4,
    narrowBudget(),
    SCORE_LAYOUT_RENDER_SCALE * multiplier,
  );
}

describe('fitNotationSizeMultiplier（紙幅に収まる最大倍率）', () => {
  it('希望どおりで収まるなら、そのまま希望値を返す（拡大はしない）', () => {
    // 幅 1000 論理単位の小節は 1000 × 0.44 × 1.5 = 660px。予算 800px なら収まる
    expect(fitNotationSizeMultiplier([1000], 800, 1.5)).toBe(1.5);
  });

  it('収まらないときは 5%刻みで切り下げる', () => {
    // 予算 500px / (1000 × 0.44) = 1.136… → 5%刻みで切り下げて 1.10
    expect(fitNotationSizeMultiplier([1000], 500, 1.5)).toBe(1.1);
  });

  it('どれだけ下げても収まらない場合はスライダーの最小値で止める（無限に小さくしない）', () => {
    expect(fitNotationSizeMultiplier([100000], 500, 1.5)).toBe(NOTATION_SIZE_MULTIPLIER_MIN);
  });

  it('小節が無い・予算が壊れている場合は希望値のまま（判断材料が無いので触らない）', () => {
    expect(fitNotationSizeMultiplier([], 800, 1.5)).toBe(1.5);
    expect(fitNotationSizeMultiplier([1000], 0, 1.5)).toBe(1.5);
  });
});

describe('密な小節をファイル指定の縮尺（200%）で組むと紙幅に収まらない', () => {
  const measures = [denseMeasure(32)];

  it('ファイル指定のまま（200%）では 1小節/段でも紙幅を超える＝警告が出る状態', () => {
    expect(planAt(2.0, measures).hasUnavoidableOverflow).toBe(true);
  });

  it('fitNotationSizeMultiplier が返す倍率まで下げれば収まる（警告が消える）', () => {
    const plan = planAt(2.0, measures);
    const fitted = fitNotationSizeMultiplier(plan.minimumWidths, narrowBudget(), 2.0);
    expect(fitted).toBeLessThan(2.0);
    expect(planAt(fitted, measures).hasUnavoidableOverflow).toBe(false);
  });
});
