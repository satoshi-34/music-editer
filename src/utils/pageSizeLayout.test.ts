// src/utils/pageSizeLayout.test.ts
// 用紙サイズ（Issue #495）がレイアウト計算と保存形式へ正しく効くことのテスト。
//
// 受入条件3（寸法の定義が単一モジュールに集約され直書きが消えている）と
// 受入条件2（保存→再読込でサイズが保持され、旧データは A4 として開ける）を固定する。
import { describe, it, expect } from 'vitest';
import { printScoreAreaWidthPx, worstCaseSystemContentBudget, PRINT_SCORE_AREA_WIDTH_PX } from './measureLayoutUtils';
import { pageWidthPxForSize, computeFitZoom, A4_PAGE_WIDTH_PX } from './viewZoomUtils';
import { pageWidthMm } from './pageSize';
import { createSavedScoreData, validateSavedScoreData } from './storage';
import type { PartData, ScoreMetadata } from '../types/storage';

const metadata: ScoreMetadata = {
  title: 'テスト譜面',
  subtitle: '',
  lyricist: '',
  composer: '',
  arranger: '',
};

const parts: PartData[] = [
  { partId: 'melody', clef: 'treble', measures: [{ events: [] }] },
];

describe('printScoreAreaWidthPx（本文幅の用紙追従）', () => {
  it('引数を省略すると従来の A4 の値と完全に一致する（受入条件5）', () => {
    // 旧実装は (210 - sideMarginMm * 2) * (96 / 25.4) の直書きだった
    expect(printScoreAreaWidthPx()).toBe((210 - 14 * 2) * (96 / 25.4));
    expect(printScoreAreaWidthPx(14)).toBe(PRINT_SCORE_AREA_WIDTH_PX);
  });

  it('用紙が広いほど本文幅も広い（B4/A3 で段に入る小節が増える前提）', () => {
    const a4 = printScoreAreaWidthPx(14, pageWidthMm('a4'));
    const b4 = printScoreAreaWidthPx(14, pageWidthMm('b4'));
    const a3 = printScoreAreaWidthPx(14, pageWidthMm('a3'));
    expect(a4).toBeLessThan(b4);
    expect(b4).toBeLessThan(a3);
    // 用紙幅の差(mm)がそのまま本文幅の差として出る（余白は用紙サイズに依らず同じ mm 値）
    expect(b4 - a4).toBeCloseTo((257 - 210) * (96 / 25.4), 6);
  });

  it('左右余白の効き方は用紙サイズを変えても従来どおり（余白を広げるほど本文幅が狭い）', () => {
    expect(printScoreAreaWidthPx(25, pageWidthMm('b4'))).toBeLessThan(printScoreAreaWidthPx(8, pageWidthMm('b4')));
  });
});

describe('worstCaseSystemContentBudget（段の本文予算の用紙追従）', () => {
  it('引数を省略すると従来どおりの値（A4 基準）', () => {
    expect(worstCaseSystemContentBudget(14, 74, 210)).toBe(worstCaseSystemContentBudget());
  });

  it('用紙が広いほど1段に使える予算が増える', () => {
    expect(worstCaseSystemContentBudget(14, 74, pageWidthMm('a4')))
      .toBeLessThan(worstCaseSystemContentBudget(14, 74, pageWidthMm('b4')));
  });
});

describe('pageWidthPxForSize / computeFitZoom（初期ズームの用紙追従）', () => {
  it('A4 は従来の A4_PAGE_WIDTH_PX と一致する', () => {
    expect(pageWidthPxForSize('a4')).toBe(A4_PAGE_WIDTH_PX);
    expect(pageWidthPxForSize(undefined)).toBe(A4_PAGE_WIDTH_PX);
  });

  it('同じ画面幅なら、用紙が大きいほど初期ズームは小さくなる（幅フィット）', () => {
    // 幅フィットは 1.0 で頭打ちになるので、頭打ちにならない狭めの画面幅で比べる
    const availableWidthPx = 600;
    const a4Zoom = computeFitZoom(availableWidthPx, pageWidthPxForSize('a4'));
    const b4Zoom = computeFitZoom(availableWidthPx, pageWidthPxForSize('b4'));
    expect(b4Zoom).toBeLessThan(a4Zoom);
  });
});

describe('保存形式（受入条件2: 保存→再読込でサイズが保持される／旧データは A4）', () => {
  it('A4（既定）のときは pageSize 項目自体を書き出さない（旧データとの差分を増やさない）', () => {
    const data = createSavedScoreData(metadata, parts, 1, 4, 'single', 'C', [4, 4],
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'a4');
    expect(data.pageSize).toBeUndefined();
    expect(validateSavedScoreData(data)).toBe(true);
  });

  it('A4 以外は pageSize として保存される', () => {
    const data = createSavedScoreData(metadata, parts, 1, 4, 'single', 'C', [4, 4],
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'b4');
    expect(data.pageSize).toBe('b4');
    expect(validateSavedScoreData(data)).toBe(true);
    // JSON を通しても保持される（localStorage / ファイル保存と同じ経路）
    const roundTripped = JSON.parse(JSON.stringify(data));
    expect(roundTripped.pageSize).toBe('b4');
    expect(validateSavedScoreData(roundTripped)).toBe(true);
  });

  it('用紙サイズを渡さない（旧コードパス）と pageSize は付かず、A4 として読める', () => {
    const data = createSavedScoreData(metadata, parts, 1, 4);
    expect(data.pageSize).toBeUndefined();
    expect(validateSavedScoreData(data)).toBe(true);
  });

  it('用紙サイズが無い旧データも検証を通る（読込互換）', () => {
    const legacy = {
      version: '3.6.0',
      timestamp: Date.now(),
      metadata,
      scoreType: 'single' as const,
      parts,
      systems: 1,
      measuresPerSystem: 4,
    };
    expect(validateSavedScoreData(legacy)).toBe(true);
  });
});
