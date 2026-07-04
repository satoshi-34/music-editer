// src/utils/customSymbolUtils.test.ts
// カスタム記号ユーティリティ（トグル付与・path描画・間引き・プレビュー）のテスト

import { describe, expect, it } from 'vitest';
import type { CustomSymbolDef, NoteEvent } from '../types/storage';
import {
  applyCustomSymbolToEvent,
  capPointCount,
  fitArcFromDragPoints,
  MAX_SYMBOL_SCALE,
  MIN_SYMBOL_SCALE,
  pathPointsToD,
  renderCustomSymbol,
  setCustomSymbolScale,
  simplifyPoints,
  symbolDefToPreviewSvg,
} from './customSymbolUtils';

function makeNoteEvent(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    dur: '4',
    isRest: false,
    keys: ['c/4'],
    ...overrides,
  };
}

describe('applyCustomSymbolToEvent', () => {
  it('未付与の音符に記号を付与すると customSymbols に追加される', () => {
    const event = makeNoteEvent();
    const next = applyCustomSymbolToEvent(event, 'sym_1');
    expect(next.customSymbols).toEqual([{ symbolId: 'sym_1' }]);
  });

  it('既に付与済みの記号を再度付けると外れる（トグル）', () => {
    const event = makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }] });
    const next = applyCustomSymbolToEvent(event, 'sym_1');
    expect(next.customSymbols).toBeUndefined();
  });

  it('複数記号のうち1つだけ外しても他の記号は残る', () => {
    const event = makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }, { symbolId: 'sym_2' }] });
    const next = applyCustomSymbolToEvent(event, 'sym_1');
    expect(next.customSymbols).toEqual([{ symbolId: 'sym_2' }]);
  });

  it('休符には記号を付与できない（元のイベントをそのまま返す）', () => {
    const event = makeNoteEvent({ isRest: true, keys: [] });
    const next = applyCustomSymbolToEvent(event, 'sym_1');
    expect(next).toBe(event);
    expect(next.customSymbols).toBeUndefined();
  });
});

describe('setCustomSymbolScale', () => {
  it('既に付与済みの symbolId の scale を更新する', () => {
    const event = makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }] });
    const next = setCustomSymbolScale(event, 'sym_1', 1.5);
    expect(next.customSymbols).toEqual([{ symbolId: 'sym_1', scale: 1.5 }]);
  });

  it('複数記号のうち対象の symbolId だけ scale を更新し、他は変更しない', () => {
    const event = makeNoteEvent({
      customSymbols: [{ symbolId: 'sym_1', scale: 2 }, { symbolId: 'sym_2' }],
    });
    const next = setCustomSymbolScale(event, 'sym_2', 0.5);
    expect(next.customSymbols).toEqual([
      { symbolId: 'sym_1', scale: 2 },
      { symbolId: 'sym_2', scale: 0.5 },
    ]);
  });

  it('存在しない symbolId を指定した場合は元の event をそのまま返す', () => {
    const event = makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }] });
    const next = setCustomSymbolScale(event, 'sym_unknown', 2);
    expect(next).toBe(event);
  });

  it('customSymbols が未設定の場合も元の event をそのまま返す', () => {
    const event = makeNoteEvent();
    const next = setCustomSymbolScale(event, 'sym_1', 2);
    expect(next).toBe(event);
  });

  it('MAX_SYMBOL_SCALE を超える値は上限にクランプされる', () => {
    const event = makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }] });
    const next = setCustomSymbolScale(event, 'sym_1', 999);
    expect(next.customSymbols?.[0].scale).toBe(MAX_SYMBOL_SCALE);
  });

  it('MIN_SYMBOL_SCALE を下回る値は下限にクランプされる', () => {
    const event = makeNoteEvent({ customSymbols: [{ symbolId: 'sym_1' }] });
    const next = setCustomSymbolScale(event, 'sym_1', 0.001);
    expect(next.customSymbols?.[0].scale).toBe(MIN_SYMBOL_SCALE);
  });
});

describe('renderCustomSymbol の scale 反映', () => {
  function makeSvgRoot(): SVGGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'g');
  }

  it('scale を省略すると等倍（1）で描画される', () => {
    const def: CustomSymbolDef = {
      id: 'sym_1',
      name: 'テスト',
      shapes: [{ kind: 'circle', cx: 10, cy: -10, r: 4, filled: true }],
    };
    const svgRoot = makeSvgRoot();
    renderCustomSymbol(def, 100, 200, svgRoot);
    const circle = svgRoot.querySelector('circle')!;
    expect(circle.getAttribute('cx')).toBe('110'); // anchorX(100) + cx(10)*1
    expect(circle.getAttribute('cy')).toBe('190'); // anchorY(200) + cy(-10)*1
    expect(circle.getAttribute('r')).toBe('4');
    expect(circle.getAttribute('stroke-width')).toBe('1.5');
  });

  it('scale を指定すると座標と太さの両方が比例して拡大される', () => {
    const def: CustomSymbolDef = {
      id: 'sym_2',
      name: 'テスト2',
      shapes: [{ kind: 'circle', cx: 10, cy: -10, r: 4, filled: false }],
    };
    const svgRoot = makeSvgRoot();
    renderCustomSymbol(def, 100, 200, svgRoot, 2);
    const circle = svgRoot.querySelector('circle')!;
    expect(circle.getAttribute('cx')).toBe('120'); // 100 + 10*2
    expect(circle.getAttribute('cy')).toBe('180'); // 200 + (-10)*2
    expect(circle.getAttribute('r')).toBe('8');    // 4*2
    expect(circle.getAttribute('stroke-width')).toBe('3'); // 1.5*2
  });

  it('line の座標・太さも scale 倍される', () => {
    const def: CustomSymbolDef = {
      id: 'sym_3',
      name: 'テスト3',
      shapes: [{ kind: 'line', x1: -5, y1: 0, x2: 5, y2: 0, strokeWidth: 2 }],
    };
    const svgRoot = makeSvgRoot();
    renderCustomSymbol(def, 0, 0, svgRoot, 0.5);
    const line = svgRoot.querySelector('line')!;
    expect(line.getAttribute('x1')).toBe('-2.5');
    expect(line.getAttribute('x2')).toBe('2.5');
    expect(line.getAttribute('stroke-width')).toBe('1'); // 2*0.5
  });

  it('path の points も scale 倍された座標で d 文字列が生成される', () => {
    const def: CustomSymbolDef = {
      id: 'sym_4',
      name: 'テスト4',
      shapes: [{ kind: 'path', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }],
    };
    const svgRoot = makeSvgRoot();
    renderCustomSymbol(def, 0, 0, svgRoot, 2);
    const path = svgRoot.querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M 0 0 L 20 20');
  });
});

describe('pathPointsToD', () => {
  it('点が0個のときは空文字を返す', () => {
    expect(pathPointsToD([])).toBe('');
  });

  it('点が1個のときは同じ点への移動のみのdを返す', () => {
    const d = pathPointsToD([{ x: 1, y: 2 }]);
    expect(d).toBe('M 1 2 L 1 2');
  });

  it('点が2個のときは単純なlineのdを返す（Qコマンドを含まない）', () => {
    const d = pathPointsToD([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(d).toBe('M 0 0 L 10 10');
    expect(d).not.toContain('Q');
  });

  it('点が3個以上のときは中点Quadraticスムージングのdを返す（Qコマンドを含む）', () => {
    const d = pathPointsToD([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q');
    // 最後は終端の点へ L で戻る
    expect(d.trim().endsWith('L 10 0')).toBe(true);
  });

  it('非有限値（NaN/Infinity）の点は除外して描画する', () => {
    const d = pathPointsToD([{ x: 0, y: 0 }, { x: NaN, y: 5 }, { x: 10, y: 10 }]);
    expect(d).not.toContain('NaN');
  });
});

describe('simplifyPoints', () => {
  it('点が2個以下ならそのまま返す', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPoints(points, 2)).toEqual(points);
  });

  it('epsilon未満の近い点は間引かれる', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 }, // 直前(0,0)から距離0.5 < epsilon(2) なので間引かれる
      { x: 1, y: 0 },   // 直前(0,0)から距離1 < epsilon(2) なので間引かれる
      { x: 5, y: 0 },   // 直前(0,0)から距離5 >= epsilon(2) なので残る
    ];
    const simplified = simplifyPoints(points, 2);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified).toContainEqual({ x: 5, y: 0 });
    // 最後の点（終端）は間引かれた基準点からの距離に関わらず必ず残る
    expect(simplified[simplified.length - 1]).toEqual({ x: 5, y: 0 });
  });

  it('最初と最後の点は必ず残る', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.2, y: 0 },
    ];
    const simplified = simplifyPoints(points, 100);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 0.2, y: 0 });
  });
});

describe('capPointCount', () => {
  it('上限以下の点列はそのまま返す', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
    expect(capPointCount(points, 10)).toBe(points);
  });

  it('上限を超えた点列は等間隔サンプリングで上限個へ収まる', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: 0 }));
    const capped = capPointCount(points, 600);
    expect(capped).toHaveLength(600);
    // 始点と終点は形状の要なので必ず残る
    expect(capped[0]).toEqual({ x: 0, y: 0 });
    expect(capped[capped.length - 1]).toEqual({ x: 999, y: 0 });
  });
});

describe('symbolDefToPreviewSvg', () => {
  it('通常の図形からNaNを含まないSVG文字列を生成する', () => {
    const def: CustomSymbolDef = {
      id: 'sym_1',
      name: 'テスト記号',
      shapes: [
        { kind: 'circle', cx: 0, cy: 0, r: 3, filled: true },
        { kind: 'line', x1: -5, y1: 0, x2: 5, y2: 0 },
      ],
    };
    const svg = symbolDefToPreviewSvg(def);
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('<svg');
  });

  it('非有限値を含む図形はスキップしてもNaNを含まない', () => {
    const def: CustomSymbolDef = {
      id: 'sym_2',
      name: '壊れた記号',
      shapes: [
        { kind: 'circle', cx: NaN, cy: 0, r: 3, filled: false },
        { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 5 },
      ],
    };
    const svg = symbolDefToPreviewSvg(def);
    expect(svg).not.toContain('NaN');
  });

  it('フリーハンド(path)を含む記号も全図形のbboxにフィットしたviewBoxで出力する', () => {
    const def: CustomSymbolDef = {
      id: 'sym_3',
      name: 'フリーハンド記号',
      shapes: [
        { kind: 'path', points: [{ x: -20, y: -30 }, { x: 0, y: 0 }, { x: 20, y: -10 }] },
      ],
    };
    const svg = symbolDefToPreviewSvg(def);
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('viewBox');
  });

  it('図形が空のときも例外を投げずviewBoxを持つSVGを返す', () => {
    const def: CustomSymbolDef = { id: 'sym_4', name: '空記号', shapes: [] };
    const svg = symbolDefToPreviewSvg(def);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('NaN');
  });
});

describe('fitArcFromDragPoints', () => {
  it('ほぼ1点（クリックに近い）ドラッグでは既定の小さな半円を返す', () => {
    const arc = fitArcFromDragPoints([{ x: 0, y: 0 }]);
    expect(Number.isFinite(arc.cx)).toBe(true);
    expect(Number.isFinite(arc.cy)).toBe(true);
    expect(arc.r).toBeGreaterThan(0);
  });

  it('直線的な2点ドラッグでもNaNにならず、既定のふくらみを持つ弧を返す', () => {
    const arc = fitArcFromDragPoints([{ x: -20, y: 0 }, { x: 20, y: 0 }]);
    expect(Number.isFinite(arc.cx)).toBe(true);
    expect(Number.isFinite(arc.cy)).toBe(true);
    expect(Number.isFinite(arc.startAngle)).toBe(true);
    expect(Number.isFinite(arc.sweepAngle)).toBe(true);
    expect(arc.r).toBeGreaterThan(0);
    // 直線ドラッグでも見た目にわかる程度のふくらみを持つ（サジッタがゼロにならない）
    expect(Math.abs(arc.sweepAngle)).toBeGreaterThan(0);
  });

  it('実際の円弧に沿ってドラッグした軌跡から、その円の中心・半径をほぼ復元できる', () => {
    // 中心(0,-50)・半径20の円周上を200°→340°（反時計回りに140°分）なぞった想定の点列
    const cx = 0, cy = -50, r = 20;
    const points = Array.from({ length: 20 }, (_, i) => {
      const deg = 200 + (140 * i) / 19;
      const rad = (deg * Math.PI) / 180;
      return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    });
    const arc = fitArcFromDragPoints(points);
    expect(arc.cx).toBeCloseTo(cx, 0);
    expect(arc.cy).toBeCloseTo(cy, 0);
    expect(arc.r).toBeCloseTo(r, 0);
    expect(Math.abs(arc.sweepAngle)).toBeCloseTo(140, 0);
  });

  it('逆向きになぞると掃引角の符号も逆になる（ドラッグの向きに追従する）', () => {
    const cx = 0, cy = -50, r = 20;
    const makePoints = (fromDeg: number, toDeg: number) =>
      Array.from({ length: 20 }, (_, i) => {
        const deg = fromDeg + ((toDeg - fromDeg) * i) / 19;
        const rad = (deg * Math.PI) / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
      });

    const forward = fitArcFromDragPoints(makePoints(200, 340));
    const backward = fitArcFromDragPoints(makePoints(340, 200));
    expect(Math.sign(forward.sweepAngle)).not.toBe(Math.sign(backward.sweepAngle));
  });
});
