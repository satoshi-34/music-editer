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
  // 端点は符頭中心のすぐ外（描画側と同じく数px外側）
  const endpointY = noteheadCenterY + 3;
  const apex = computeArcApexPoint(
    0, endpointY, span, endpointY, false, 'slur', stemDir, noteheadCenterY, 0, 0
  ).y;
  return apex - noteheadCenterY;
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
