// スラーが中間の符頭に重ならないこと（#406 Codex P2）。
//
// 曲率を緩めた（下限10→5px・係数0.15→0.09・上限24→16px）際、制御点の下限が
// 符頭の高さを考慮していなかったため、符幹が上向きで conflict の +8px が付かない
// 短いスラーが符頭の縁に接する状態になっていた。
//
// 符頭は半分の高さが約5px。弧の頂点は「端点×0.25 + 制御点×0.75」で決まるので、
// 制御点の下限がそのまま頂点の余裕になる。
import { describe, it, expect } from 'vitest';
import { computeArcApexPoint, SLUR_OBSTACLE_MIN_GAP_PX } from './arcUtils';
import { ARC_NOTEHEAD_GAP, ARC_NOTEHEAD_GAP_LEGACY } from '../utils/arcStemAnchorUtils';
import { ENGRAVING_THICKNESS_UNITS } from '../utils/engravingDefaults';

/** 符頭の半分の高さ（VexFlow の描画に合わせた目安） */
const NOTEHEAD_HALF_HEIGHT_PX = 5;
/** 弧の中央の太さの半分（塗り＋線）。見た目の輪郭はこのぶん外へ出る */
const ARC_HALF_THICKNESS_PX = 1.1;

/**
 * 同音高の音を結ぶ短い下向きスラー。中間の符頭が障害物になる。
 * @param stemDir 1=符幹上向き（conflict なし＝余裕が付かない厳しい側）
 */
function apexBelowNoteheadCenter(span: number, stemDir: number): number {
  const noteheadCenterY = 200;
  // 端点は符頭中心のすぐ外（描画側＝resolveArcEndpointY と同じ隙間を使う）
  const endpointY = noteheadCenterY + ARC_NOTEHEAD_GAP;
  const apex = computeArcApexPoint(
    0, endpointY, span, endpointY, false, 'slur', stemDir, noteheadCenterY, 0, 0
  ).y;
  return apex - noteheadCenterY;
}

/** 指定オフセットでの頂点Y（符頭中心を基準にした相対値） */
function apexWithOffset(span: number, stemDir: number, cpDyOffset: number): number {
  const noteheadCenterY = 200;
  const endpointY = noteheadCenterY + ARC_NOTEHEAD_GAP;
  return computeArcApexPoint(
    0, endpointY, span, endpointY, false, 'slur', stemDir, noteheadCenterY, cpDyOffset, 0
  ).y - noteheadCenterY;
}

describe('スラーが中間の符頭に重ならない（#406）', () => {
  // 符幹が上向きのとき conflict の +8px が付かないので、ここが最も厳しい
  it.each([20, 30, 40, 60])('span=%i の短いスラーでも符頭の縁を越える（符幹上向き）', (span) => {
    const gap = apexBelowNoteheadCenter(span, 1);
    expect(gap).toBeGreaterThan(NOTEHEAD_HALF_HEIGHT_PX + ARC_HALF_THICKNESS_PX);
  });

  it('符幹が下向き（conflict あり）はさらに余裕がある', () => {
    expect(apexBelowNoteheadCenter(30, -1)).toBeGreaterThan(apexBelowNoteheadCenter(30, 1));
  });

  // 下限を下げると符頭に接する。この関係が壊れたら重なりが再発する
  it('制御点の下限が、符頭の半分の高さ＋弧の太さより大きい', () => {
    const apexRatioOfControlPoint = 0.75;
    expect(SLUR_OBSTACLE_MIN_GAP_PX * apexRatioOfControlPoint)
      .toBeGreaterThan(NOTEHEAD_HALF_HEIGHT_PX + ARC_HALF_THICKNESS_PX);
  });
});

// 最低隙間をユーザーオフセットの**後**に適用すると、既定値が最低隙間より小さい短い弧では
// 「外へドラッグしても見た目が動かないのに値だけ溜まり、後から跳ねる」無反応帯ができる
// （#406 Codex round2 P2）
describe('短いスラーのドラッグに無反応帯が無い（#406）', () => {
  it('外側へのドラッグは1pxから見た目に反映される（符幹上向き・短い弧）', () => {
    const base = apexWithOffset(30, 1, 0);
    expect(apexWithOffset(30, 1, 1)).toBeGreaterThan(base);
    expect(apexWithOffset(30, 1, 4)).toBeGreaterThan(apexWithOffset(30, 1, 1));
  });

  it('ドラッグ量に比例して深くなる（途中で飲み込まれない）', () => {
    const d1 = apexWithOffset(30, 1, 2) - apexWithOffset(30, 1, 0);
    const d2 = apexWithOffset(30, 1, 4) - apexWithOffset(30, 1, 2);
    expect(d1).toBeGreaterThan(0);
    // 等間隔のドラッグなら等間隔に動く（誤差0.01）
    expect(Math.abs(d1 - d2)).toBeLessThan(0.01);
  });

  it('内側へのドラッグは符頭の手前で止まる（こちらは意図的な下限）', () => {
    expect(apexWithOffset(30, 1, -50)).toBeGreaterThan(NOTEHEAD_HALF_HEIGHT_PX + ARC_HALF_THICKNESS_PX);
  });
});

// ───────────────────────────────────────────────────────────────
// Issue #446: 弧の端点と符頭の間隔（下限の固定）
// ───────────────────────────────────────────────────────────────
//
// 利用者フィードバック「タイが音符とくっつきすぎ」。従来の隙間 3 は符頭中心からの
// 距離なので、符頭の半分の高さ（約5）より内側で、弧の端が符頭にめり込んでいた。
// ここでは「端点は符頭の縁より外」という浄書上の下限を固定する。下限を割ると
// くっつきが再発するので、隙間の定数を下げる変更はこのテストで止まる。

/** 弧の「端」の線の太さの半分。輪郭はこのぶん符頭側へ寄る */
const ARC_ENDPOINT_HALF_THICKNESS = ENGRAVING_THICKNESS_UNITS.slurEndpoint / 2;

describe('弧の端点が符頭にめり込まない（#446）', () => {
  it('端点の隙間が、符頭の縁＋弧の端の太さより大きい', () => {
    expect(ARC_NOTEHEAD_GAP - ARC_ENDPOINT_HALF_THICKNESS)
      .toBeGreaterThan(NOTEHEAD_HALF_HEIGHT_PX);
  });

  it('従来の隙間（3）はこの下限を満たしていなかった（＝これが今回の不具合）', () => {
    expect(ARC_NOTEHEAD_GAP_LEGACY - ARC_ENDPOINT_HALF_THICKNESS)
      .toBeLessThan(NOTEHEAD_HALF_HEIGHT_PX);
  });

  it('広げすぎて隣の五線の線を越えない（線間の音符でも1間の内側に収まる）', () => {
    // 五線の1間は 10。符頭中心から 10 以上離すと、隣の線を越えて見える
    expect(ARC_NOTEHEAD_GAP).toBeLessThan(10);
  });
});

describe('スラー側の見た目が崩れない（#446 の巻き添え確認）', () => {
  // 端点を外へ出すとスラーの頂点も少しだけ外へ動くが、ふくらみ（制御点の下限）は
  // 符頭を基準に決まるので、#406 で固定した「符頭に重ならない」性質は保たれる。
  it.each([20, 30, 40, 60])('span=%i のスラーの頂点は符頭の縁より外のまま', (span) => {
    expect(apexBelowNoteheadCenter(span, 1))
      .toBeGreaterThan(NOTEHEAD_HALF_HEIGHT_PX + ARC_HALF_THICKNESS_PX);
  });

  it('端点を外へ出したぶん、頂点も外側（または同じ）へ動く＝内側へ食い込まない', () => {
    const noteheadCenterY = 200;
    const apexAt = (gap: number) => computeArcApexPoint(
      0, noteheadCenterY + gap, 40, noteheadCenterY + gap, false, 'slur', 1, noteheadCenterY, 0, 0
    ).y;
    expect(apexAt(ARC_NOTEHEAD_GAP)).toBeGreaterThanOrEqual(apexAt(ARC_NOTEHEAD_GAP_LEGACY));
  });
});
