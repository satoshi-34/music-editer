// src/utils/customSymbolRenderUtils.test.ts
// カスタム記号の多段譜共通描画ユーティリティ（統一高さ計算・描画情報の組み立て・一括描画）のテスト

import { describe, expect, it } from 'vitest';
import type { CustomSymbolDef, NoteEvent } from '../types/storage';
import {
  buildCustomSymbolEntry,
  drawCustomSymbolEntries,
  getCustomSymbolAnchorY,
} from './customSymbolRenderUtils';

function makeNoteEvent(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    dur: '4',
    isRest: false,
    keys: ['c/4'],
    ...overrides,
  };
}

describe('getCustomSymbolAnchorY', () => {
  it('五線上端Yから10px上を統一アンカーとして返す（StaffCanvas の従来式と同じ）', () => {
    expect(getCustomSymbolAnchorY(100)).toBe(90);
    expect(getCustomSymbolAnchorY(0)).toBe(-10);
  });
});

describe('buildCustomSymbolEntry', () => {
  it('customSymbols が無い音符は null を返す（描画情報を作らない）', () => {
    const event = makeNoteEvent();
    expect(buildCustomSymbolEntry(event, 50, 100)).toBeNull();
  });

  it('休符は customSymbols が付いていても null を返す', () => {
    const event = makeNoteEvent({ isRest: true, customSymbols: [{ symbolId: 'sym_1' }] });
    expect(buildCustomSymbolEntry(event, 50, 100)).toBeNull();
  });

  it('プレースホルダー音符は null を返す', () => {
    const event = { ...makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }] }), __isPlaceholder: true } as NoteEvent & { __isPlaceholder: boolean };
    expect(buildCustomSymbolEntry(event, 50, 100)).toBeNull();
  });

  it('customSymbols を持つ音符から anchorX/anchorY と既定値補完済みの symbols を組み立てる', () => {
    const event = makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }] });
    const entry = buildCustomSymbolEntry(event, 50, 100);
    expect(entry).toEqual({
      anchorX: 50,
      anchorY: 90, // getCustomSymbolAnchorY(100)
      symbols: [{ symbolId: 'sym_1', scale: 1, offsetX: 0, offsetY: 0 }],
      measureAbsoluteIndex: 0,
      eventIndex: 0,
      event,
    });
  });

  it('scale/offsetX/offsetY が指定済みの場合はその値をそのまま使う', () => {
    const event = makeNoteEvent({
      customSymbols: [{ symbolId: 'sym_1', scale: 1.5, offsetX: 10, offsetY: -5 }],
    });
    const entry = buildCustomSymbolEntry(event, 20, 40);
    expect(entry?.symbols).toEqual([{ symbolId: 'sym_1', scale: 1.5, offsetX: 10, offsetY: -5 }]);
  });

  it('複数の記号が付いた音符は symbols 配列に全件含める', () => {
    const event = makeNoteEvent({
      customSymbols: [{ symbolId: 'sym_1' }, { symbolId: 'sym_2', scale: 2 }],
    });
    const entry = buildCustomSymbolEntry(event, 0, 0);
    expect(entry?.symbols).toHaveLength(2);
    expect(entry?.symbols[1]).toEqual({ symbolId: 'sym_2', scale: 2, offsetX: 0, offsetY: 0 });
  });
});

describe('drawCustomSymbolEntries', () => {
  function makeDef(id: string): CustomSymbolDef {
    return {
      id,
      name: 'test',
      shapes: [{ kind: 'circle', cx: 0, cy: 0, r: 4, filled: false }],
    };
  }

  it('定義が見つかる記号だけ SVG へ描画する（未定義IDはスキップ）', () => {
    const svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    drawCustomSymbolEntries(
      [
        { anchorX: 10, anchorY: 20, symbols: [{ symbolId: 'known', scale: 1, offsetX: 0, offsetY: 0 }] },
        { anchorX: 30, anchorY: 40, symbols: [{ symbolId: 'missing', scale: 1, offsetX: 0, offsetY: 0 }] },
      ],
      [makeDef('known')],
      svgRoot,
    );
    // known の1件だけ図形（circle 1個）が追加され、missing はスキップされる
    expect(svgRoot.querySelectorAll('circle')).toHaveLength(1);
  });

  it('offsetX/offsetY が実際の描画座標に反映される', () => {
    const svgRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    drawCustomSymbolEntries(
      [{ anchorX: 100, anchorY: 200, symbols: [{ symbolId: 'known', scale: 1, offsetX: 5, offsetY: -3 }] }],
      [makeDef('known')],
      svgRoot,
    );
    const circle = svgRoot.querySelector('circle');
    expect(circle?.getAttribute('cx')).toBe('105');
    expect(circle?.getAttribute('cy')).toBe('197');
  });
});
