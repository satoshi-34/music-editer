// 弧の膨らみを次の五線の手前で止める（Issue #390）のテスト。
//
// 実機報告（2026-08-24・月光 m1 清書）: 深い音型に掛けた下向きスラーの弧が
// 左手五線へ食い込む。#382（pp の五線間クランプ）と同型の
// 「描画が隣の五線を知らない」問題の弧版。
import { describe, it, expect } from 'vitest';
import {
  clampArcCpDyOffsetToStaveLimit,
  computeArcApexPoint,
  computeArcMaxY,
  ARC_STAVE_CLAMP_MAX_SHRINK_PX,
  nextStaveTopBelow,
} from './arcUtils';

/** 下向きスラーの標準的な引数（深い音型を想定して端点を離す） */
const ARC = {
  x1: 100, y1: 200, x2: 300, y2: 200,
  upward: false,
  kind: 'slur' as const,
  stemDir: -1,
  // 障害物（避ける音符）を置くと弧には最小の膨らみが生まれる。基本ケースでは
  // 縮められる余地を確かめたいので障害物なしにする
  obstacleY: undefined as number | undefined,
  apexXRatio: 0,
};

function apexYWith(cpDyOffset: number): number {
  return computeArcApexPoint(
    ARC.x1, ARC.y1, ARC.x2, ARC.y2, ARC.upward, ARC.kind, ARC.stemDir,
    ARC.obstacleY, cpDyOffset, ARC.apexXRatio
  ).y;
}

function clampWith(maxBottomY: number | undefined, cpDyOffset = 0): number {
  return clampArcCpDyOffsetToStaveLimit(
    ARC.x1, ARC.y1, ARC.x2, ARC.y2, ARC.upward, ARC.kind, ARC.stemDir,
    ARC.obstacleY, cpDyOffset, ARC.apexXRatio, maxBottomY
  );
}

describe('clampArcCpDyOffsetToStaveLimit（Issue #390）', () => {
  it('既定の弧が境界を超えるなら、頂点が境界内に収まるまで膨らみを減らす', () => {
    const naturalApexY = apexYWith(0);
    // 既定の頂点より少し上に境界を置く＝はみ出している状態
    const maxBottomY = naturalApexY - 3;

    const clamped = clampWith(maxBottomY);

    expect(clamped).toBeLessThan(0);           // 膨らみを減らす向きに効く
    expect(apexYWith(clamped)).toBeLessThanOrEqual(maxBottomY + 0.01);
  });

  it('境界に収まっている弧は一切変えない', () => {
    const maxBottomY = apexYWith(0) + 50;      // 余裕がある
    expect(clampWith(maxBottomY)).toBe(0);
  });

  it('境界が無い（最下段）ときは何もしない', () => {
    expect(clampWith(undefined)).toBe(0);
  });

  // #373 で確定した手動優先の原則。手で整えた弧を自動で平たくしない
  it('手で調整済みの弧（cpDyOffset≠0）は、はみ出していても変えない', () => {
    const manual = 25;
    const maxBottomY = apexYWith(manual) - 30; // 明らかにはみ出す
    expect(clampWith(maxBottomY, manual)).toBe(manual);
  });

  it('上向きの弧は対象外（下の五線を脅かさない）', () => {
    const upwardClamped = clampArcCpDyOffsetToStaveLimit(
      ARC.x1, ARC.y1, ARC.x2, ARC.y2, true, ARC.kind, 1, undefined, 0, 0, 0
    );
    expect(upwardClamped).toBe(0);
  });

  // 実機で再発した形（月光 m1）: 始点と終点の高さが違うスラー。
  // 最下点が t=0.5 からずれるため、中央だけ見てクランプすると境界を越えたまま残る
  // （#403 Codex round1 P2）
  it('始点と終点の高さが違う弧でも、実際の最下点が境界に収まる', () => {
    const asym = { x1: 100, y1: 220, x2: 320, y2: 170 };
    const maxYWith = (c: number): number => computeArcMaxY(
      asym.x1, asym.y1, asym.x2, asym.y2, false, 'slur', -1, undefined, c, 0);
    const natural = maxYWith(0);
    const maxBottomY = natural - 4;

    const clamped = clampArcCpDyOffsetToStaveLimit(
      asym.x1, asym.y1, asym.x2, asym.y2, false, 'slur', -1, undefined, 0, 0, maxBottomY);

    expect(clamped).toBeLessThan(0);
    expect(maxYWith(clamped)).toBeLessThanOrEqual(maxBottomY + 0.01);
    // 中央(t=0.5)の値より実際の最下点の方が下にある形であることも確かめる
    // （この差が無いとテストとして意味がない）
    const apexAtHalf = computeArcApexPoint(
      asym.x1, asym.y1, asym.x2, asym.y2, false, 'slur', -1, undefined, 0, 0).y;
    expect(natural).toBeGreaterThan(apexAtHalf);
  });

  // タイ（二次ベジェ）でも同じ規則が効くこと
  it('タイでも境界を超えるなら膨らみを減らす', () => {
    const maxYWith = (c: number): number => computeArcMaxY(
      100, 200, 300, 200, false, 'tie', -1, undefined, c, 0);
    const maxBottomY = maxYWith(0) - 3;

    const clamped = clampArcCpDyOffsetToStaveLimit(
      100, 200, 300, 200, false, 'tie', -1, undefined, 0, 0, maxBottomY);

    expect(clamped).toBeLessThan(0);
    expect(maxYWith(clamped)).toBeLessThanOrEqual(maxBottomY + 0.01);
  });

  // 板挟み（どれだけ縮めても収まらない）ときは、縮めた形のまま境界に留める。
  // #382 で確定した「部分的な重なりは許容する」原則と同じ
  it('どれだけ縮めても収まらないときは、最大まで縮めた値を返す', () => {
    const clamped = clampWith(-10000);         // 到達不能な境界
    expect(clamped).toBe(-ARC_STAVE_CLAMP_MAX_SHRINK_PX);
  });
});

// 境界を「パート番号の次」ではなく「弧が描かれている五線の次」から引く（2026-08-24 実機修正）
describe('nextStaveTopBelow', () => {
  const STAVE_TOPS = [60, 140];   // 右手五線の上端60 / 左手五線の上端140

  it('上の五線に描かれた弧には、下の五線の上端を返す', () => {
    expect(nextStaveTopBelow(STAVE_TOPS, 60)).toBe(140);
  });

  // ここが実機で壊れていた点。パートまたぎ（⇵）の音符は左手五線に描かれるので、
  // 「右手パートの次＝左手五線」を境界にすると音符より上を境界にしてしまい、
  // 弧が最大まで潰れて直線同然になる
  it('下の五線に描かれた弧には境界を返さない（下にもう五線が無いため）', () => {
    expect(nextStaveTopBelow(STAVE_TOPS, 140)).toBeUndefined();
  });

  it('五線が3つ以上あるときは、すぐ下の1つを選ぶ（一番下ではない）', () => {
    expect(nextStaveTopBelow([60, 140, 220], 60)).toBe(140);
  });

  it('同じ高さの五線（誤差込み）は自分自身とみなして選ばない', () => {
    expect(nextStaveTopBelow([140, 140.5], 140)).toBeUndefined();
  });
});
