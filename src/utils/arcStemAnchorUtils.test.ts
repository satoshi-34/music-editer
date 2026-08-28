// Issue #296: 多声部で弧の端点・障害物を符幹側へ寄せる判断ロジックの単体テスト。
//
// 座標計算（PianoSystemCanvas 側）と混ぜずにここで固定しておくと、
// 「単声部は1pxも変えない」「向きを手で反転したら符頭側へ戻る」といった
// 浄書上の決めごとが、描画のリファクタで静かに壊れたときにすぐ分かる。
import { describe, it, expect } from 'vitest';
import {
  ARC_NOTEHEAD_GAP,
  ARC_STEM_TIP_GAP,
  resolveArcEndpointY,
  resolveSlurObstacleY,
  shouldAnchorArcToStemSide,
} from './arcStemAnchorUtils';

describe('shouldAnchorArcToStemSide（符幹側へ付けるかの判定）', () => {
  it('多声部小節で、上向きの弧＋上向きの符幹なら符幹側へ付ける', () => {
    expect(shouldAnchorArcToStemSide({ isMultiVoiceMeasure: true, upward: true, stemDirection: 1 })).toBe(true);
  });

  it('多声部小節で、下向きの弧＋下向きの符幹（声部2の標準形）でも符幹側へ付ける', () => {
    expect(shouldAnchorArcToStemSide({ isMultiVoiceMeasure: true, upward: false, stemDirection: -1 })).toBe(true);
  });


  it('単声部小節では、向きが一致していても符頭側のまま（既存譜面の見た目を変えない）', () => {
    expect(shouldAnchorArcToStemSide({ isMultiVoiceMeasure: false, upward: true, stemDirection: 1 })).toBe(false);
    expect(shouldAnchorArcToStemSide({ isMultiVoiceMeasure: false, upward: false, stemDirection: -1 })).toBe(false);
  });

  it('符幹の向きが不明（0＝全音符・休符など）なら符頭側のまま', () => {
    expect(shouldAnchorArcToStemSide({ isMultiVoiceMeasure: true, upward: true, stemDirection: 0 })).toBe(false);
  });
});

describe('resolveArcEndpointY（端点のY）', () => {
  // SVG のYは下ほど大きい。符頭が y=120、符幹先端が y=73 の上向き符幹を想定する。
  const NOTEHEAD_Y = 120;
  const STEM_TIP_Y = 73;

  it('符頭アンカーのときは符頭から ARC_NOTEHEAD_GAP だけ外側', () => {
    expect(resolveArcEndpointY({ noteheadY: NOTEHEAD_Y, stemTipY: STEM_TIP_Y, upward: true, anchorToStem: false }))
      .toBe(NOTEHEAD_Y - ARC_NOTEHEAD_GAP);
    expect(resolveArcEndpointY({ noteheadY: NOTEHEAD_Y, upward: false, anchorToStem: false }))
      .toBe(NOTEHEAD_Y + ARC_NOTEHEAD_GAP);
  });

  it('符幹アンカーのときは符幹先端から 5 だけ外側（ビームの厚みを越える）', () => {
    expect(resolveArcEndpointY({ noteheadY: NOTEHEAD_Y, stemTipY: STEM_TIP_Y, upward: true, anchorToStem: true }))
      .toBe(STEM_TIP_Y - ARC_STEM_TIP_GAP);
    expect(resolveArcEndpointY({ noteheadY: 80, stemTipY: 127, upward: false, anchorToStem: true }))
      .toBe(127 + ARC_STEM_TIP_GAP);
  });

  it('符幹先端が取れない音符（全音符など）は符頭アンカーへ戻る', () => {
    expect(resolveArcEndpointY({ noteheadY: NOTEHEAD_Y, stemTipY: undefined, upward: true, anchorToStem: true }))
      .toBe(NOTEHEAD_Y - ARC_NOTEHEAD_GAP);
    expect(resolveArcEndpointY({ noteheadY: NOTEHEAD_Y, stemTipY: Number.NaN, upward: true, anchorToStem: true }))
      .toBe(NOTEHEAD_Y - ARC_NOTEHEAD_GAP);
  });

  it('符幹先端が符頭より内側という壊れた値でも、端点は符頭より内側へ入らない', () => {
    // 上向きの弧なのに符幹先端が符頭より下（y が大きい）という矛盾したデータ。
    expect(resolveArcEndpointY({ noteheadY: NOTEHEAD_Y, stemTipY: 140, upward: true, anchorToStem: true }))
      .toBe(NOTEHEAD_Y - ARC_NOTEHEAD_GAP);
  });
});

// Issue #446: 「タイが音符とくっつきすぎ」という利用者フィードバックへの対応。
// 端点の隙間を広げたが、手動で位置を決めた端点だけは動かさない。
describe('resolveSlurObstacleY（スラーが避ける高さ）', () => {
  it('上向きなら符頭と符幹先端をまとめて見て、いちばん上を返す', () => {
    expect(resolveSlurObstacleY({ upward: true, noteheadYs: [120, 110, 100], stemTipYs: [73, 69, 65] })).toBe(65);
  });

  it('下向きならいちばん下を返す', () => {
    expect(resolveSlurObstacleY({ upward: false, noteheadYs: [120, 110], stemTipYs: [150, 160] })).toBe(160);
  });

  it('符幹先端を渡さなければ従来どおり符頭だけで決まる（単声部の経路）', () => {
    expect(resolveSlurObstacleY({ upward: true, noteheadYs: [120, 110, 100] })).toBe(100);
  });

  it('候補が1つも無ければ undefined（呼び出し側が端点から決める）', () => {
    expect(resolveSlurObstacleY({ upward: true, noteheadYs: [] })).toBeUndefined();
  });
});
