// カスタム記号エディタの手ぶれ補正（Issue #529 段階1）の実マウントテスト。
// 受入条件:
// 1. ジグザグの手描き線が滑らかな曲線として表示される（点数削減とパスの連続性）
//    → 描いた直後のキャンバス上の path が、記録した折れ線より少ない経由点で描かれる
// 2. 補正オフでオリジナルのストロークに戻せる
//    → チェックを外すと描いたままの d に戻り、保存済み記号も「補正オフ」ボタンで戻せる
// 3. 既存の保存データが従来どおり表示される（smoothing を持たない記号は補正なしで描画）
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import SymbolEditor from './SymbolEditor';
import type { CustomSymbolDef } from '../types/storage';
import { pathPointsToD } from '../utils/customSymbolUtils';

// エディタのキャンバスは論理座標 x∈[-40,40], y∈[-90,10] を 240×300px で表示する。
// jsdom はレイアウトを計算しないため、この対応関係を getBoundingClientRect で与える。
const CANVAS_W = 240;
const CANVAS_H = 300;

function mockCanvasLayout(svg: SVGSVGElement) {
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: CANVAS_W, bottom: CANVAS_H, width: CANVAS_W, height: CANVAS_H, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
}

/** 論理座標 → 画面座標（上のキャンバス設定の逆変換） */
function toClient(p: { x: number; y: number }) {
  return {
    clientX: ((p.x - -40) / 80) * CANVAS_W,
    clientY: ((p.y - -90) / 100) * CANVAS_H,
  };
}

/** 1点ごとに上下へ揺れる手描き線（手の震えの再現） */
function zigzagPoints(count: number, amplitude: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    x: -30 + i * 1.5,
    y: -40 + (i % 2 === 0 ? amplitude : -amplitude),
  }));
}

function renderEditor(existingDefs: CustomSymbolDef[] = []) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onToggleSmoothing = vi.fn();
  const { container } = render(
    <SymbolEditor
      existingDefs={existingDefs}
      onSave={onSave}
      onDelete={onDelete}
      onToggleSmoothing={onToggleSmoothing}
      onClose={vi.fn()}
    />
  );
  const canvas = container.querySelector('svg') as SVGSVGElement;
  mockCanvasLayout(canvas);
  return { container, canvas, onSave, onDelete, onToggleSmoothing };
}

/** キャンバス上でフリーハンドのストロークを1本描く（ポインタ操作の再現） */
function drawStroke(canvas: SVGSVGElement, points: { x: number; y: number }[]) {
  fireEvent.pointerDown(canvas, { ...toClient(points[0]), pointerId: 1 });
  for (const p of points.slice(1)) {
    fireEvent.pointerMove(canvas, { ...toClient(p), pointerId: 1 });
  }
  fireEvent.pointerUp(canvas, { ...toClient(points[points.length - 1]), pointerId: 1 });
}

/** 確定済みストロークの path 要素（アンカーの十字線・符頭ゴーストを除く） */
function committedStrokeD(canvas: SVGSVGElement): string {
  const paths = Array.from(canvas.querySelectorAll('path'));
  expect(paths.length).toBeGreaterThan(0);
  return paths[paths.length - 1].getAttribute('d') ?? '';
}

describe('カスタム記号エディタの手ぶれ補正', () => {
  it('描き終わったジグザグは、補正オンのとき経由点の少ないなめらかな線として描かれる', () => {
    const { canvas } = renderEditor();
    drawStroke(canvas, zigzagPoints(41, 3));

    const d = committedStrokeD(canvas);
    // ひと続きのパスであること（受入条件1の「パスの連続性」）
    expect((d.match(/M/g) ?? []).length).toBe(1);
    expect(d).not.toContain('NaN');
    // 経由点（Q コマンド）が、記録した点数よりはっきり少ないこと
    expect((d.match(/Q/g) ?? []).length).toBeLessThan(10);
  });

  it('補正のチェックを外すと、描いたままのストロークの表示に戻る', () => {
    const { canvas } = renderEditor();
    drawStroke(canvas, zigzagPoints(41, 3));
    const smoothedD = committedStrokeD(canvas);

    fireEvent.click(screen.getByLabelText('手ぶれ補正'));
    const rawD = committedStrokeD(canvas);

    expect(rawD).not.toBe(smoothedD);
    // 補正オフの d のほうが経由点が多い（＝間引かれていない元のストローク）
    expect((rawD.match(/Q/g) ?? []).length).toBeGreaterThan((smoothedD.match(/Q/g) ?? []).length);
  });

  it('保存すると、そのときの補正の設定が記号定義に入る（元のストロークはそのまま保持）', () => {
    const { canvas, onSave } = renderEditor();
    const stroke = zigzagPoints(41, 3);
    drawStroke(canvas, stroke);

    fireEvent.change(screen.getByLabelText('記号名'), { target: { value: 'ふるえ' } });
    fireEvent.click(screen.getByLabelText('この記号を保存'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const def: CustomSymbolDef = onSave.mock.calls[0][0];
    expect(def.smoothing).toBe(true);
    // 保存されるのは補正結果ではなく描いたままの頂点列（あとで補正を外せる）
    const pathShape = def.shapes.find(s => s.kind === 'path');
    expect(pathShape).toBeDefined();
    if (pathShape && pathShape.kind === 'path') {
      expect(pathShape.points.length).toBeGreaterThan(10);
    }
  });

  it('補正のチェックを外して保存すると smoothing: false で保存される', () => {
    const { canvas, onSave } = renderEditor();
    drawStroke(canvas, zigzagPoints(21, 3));

    fireEvent.click(screen.getByLabelText('手ぶれ補正'));
    fireEvent.change(screen.getByLabelText('記号名'), { target: { value: 'なまの震え' } });
    fireEvent.click(screen.getByLabelText('この記号を保存'));

    expect(onSave.mock.calls[0][0].smoothing).toBe(false);
  });

  it('保存済みの記号は一覧のボタンで補正をオン/オフできる', () => {
    const points = zigzagPoints(21, 3);
    const legacyDef: CustomSymbolDef = {
      id: 'sym_legacy',
      name: '旧記号',
      shapes: [{ kind: 'path', points, strokeWidth: 1.5 }],
    };
    const { container, onToggleSmoothing } = renderEditor([legacyDef]);

    // smoothing を持たない既存データは「補正オフ」表示＝従来どおりの見た目（受入条件3）
    const preview = container.querySelector('[aria-label="旧記号"]')!;
    expect(preview.innerHTML).toContain(pathPointsToD(points));

    fireEvent.click(screen.getByLabelText('旧記号 の手ぶれ補正をオンにする'));
    expect(onToggleSmoothing).toHaveBeenCalledWith('sym_legacy', true);
  });

  it('補正オンの保存済み記号は、一覧のボタンでオフに戻せる', () => {
    const def: CustomSymbolDef = {
      id: 'sym_on',
      name: '補正済み',
      shapes: [{ kind: 'path', points: zigzagPoints(21, 3), strokeWidth: 1.5 }],
      smoothing: true,
    };
    const { onToggleSmoothing } = renderEditor([def]);

    fireEvent.click(screen.getByLabelText('補正済み の手ぶれ補正をオフにする'));
    expect(onToggleSmoothing).toHaveBeenCalledWith('sym_on', false);
  });

  it('フリーハンド線を含まない記号には補正の切り替えボタンを出さない', () => {
    const def: CustomSymbolDef = {
      id: 'sym_circle',
      name: '丸だけ',
      shapes: [{ kind: 'circle', cx: 0, cy: -4, r: 3, filled: true }],
    };
    renderEditor([def]);

    expect(screen.queryByLabelText('丸だけ の手ぶれ補正をオンにする')).toBeNull();
    expect(screen.queryByLabelText('丸だけ の手ぶれ補正をオフにする')).toBeNull();
  });
});
