// バグ修正の再現・回帰確認テスト:
// 編成譜（オーケストラスコア）のように描画スケール s が小さい場合、
// 符頭のすぐ近くをクリックしても「選択」にならず「音符追加」になってしまっていた。
//
// 原因: 個別音選択の当たり判定（符頭±KEY_SELECT_X_PAD）が SVG 内部座標（raw 単位）の
// 固定値だった。VexFlow の SVGContext.scale(s,s) は viewBox 幅を width/s にするだけで
// 各要素の座標を書き換えないため、画面クリック座標→raw 座標の変換係数は概ね 1/s になる
// （raw 単位 1 は画面上では概ね s px にしかならない）。
// s が小さい編成譜では、この固定 12 raw 単位が画面上わずか数px相当まで縮み、
// 符頭のすぐ隣をクリックしても選択にならなかった。
//
// 修正: パディングを「画面px基準」の定数にし、keySelectXPad(s) = 画面px / s で
// raw 単位に変換してから当たり判定に使うようにした（結果として画面px換算の
// 実効パディングは s によらず一定になる）。
//
// 注意: このテストでは PianoSystemCanvas の clientToGroup が
// 「画面クリック座標 → SVG raw 座標」の変換に viewBox / svg実寸 の比（≒ 1/s）を使う
// ため、raw 座標で表現された当たり判定境界（data-note-left/right など）を
// 画面クリック座標として使う場合は `* s` で screen 座標に変換する必要がある。
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn()
    };
  })
}));

// jsdom はレイアウトを持たないため、clientWidth をスタブして実ブラウザに近い横幅で描画させる
// （EmptyBeatClick / HoverFeedback テストと同じ手法）。
const TEST_CONTAINER_WIDTH = 700;
// 編成譜相当の縮小スケール。PianoSystemCanvas の scale prop（requestedScale）に渡す。
const SMALL_SCALE = 0.3;

// clientToGroup は svg.getBoundingClientRect()（画面上の実表示サイズ）と
// svg.viewBox.baseVal（VexFlow の ctx.scale(s,s) が設定する width/s の内部座標系）から
// 「画面px → SVG raw座標」の変換係数（≒ 1/s）を求める。
// jsdom は viewBox 属性の値を baseVal に正しく反映するので、width/height だけ
// 実ブラウザの表示サイズに合わせてスタブすれば、実際のアプリと同じ変換式で
// テストできる。
function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as any;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

describe('PianoSystemCanvas 編成譜（縮小スケール）での個別音選択', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  function setup() {
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  }
  function teardown() {
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as any).clientWidth;
    }
  }

  function renderSmallScaleScore() {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();

    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={SMALL_SCALE}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
      />
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    return { svg, onChange, container };
  }

  it('編成譜相当の縮小スケール（scale=0.3）でも、符頭の少し外側をクリックすると選択になる', async () => {
    setup();
    try {
      const { svg, onChange, container } = renderSmallScaleScore();

      const midHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
      expect(midHit).toBeTruthy();

      // raw 座標（VexFlow 内部座標）でのY: ヒット領域が五線±3加線を覆うので、
      // そこから b/4（treble の中央線 = ライン2）のY座標を逆算する。
      const rawY = parseFloat(midHit.getAttribute('y')!);
      const rawH = parseFloat(midHit.getAttribute('height')!);
      const rawLineSpacing = rawH / 10; // (7 - (-3)) = 10 ライン分
      const rawClickY = rawY + (2 - (-3)) * rawLineSpacing;

      // 符頭の実描画X範囲（raw 単位）。
      const rawNoteRight = parseFloat(midHit.getAttribute('data-note-right')!);

      // 画面px基準で「旧パディング(12px相当のraw=12) を画面pxに換算すると
      // 12*SMALL_SCALE=3.6px」しかなかった位置より外、かつ新パディング
      // (keySelectXPad(0.3)=40raw を画面pxに戻すと12px) より内側、
      // 画面px換算で+8px の位置をクリックする。
      // clientToGroup は「画面px × (1/s)」で raw 座標を得るため、
      // raw 座標を画面px化するには逆に「raw × s」する。
      const rawOffsetPx = 8; // 画面px基準のオフセット（旧12rawの画面px換算3.6pxより大きく、新12px換算の閾値以内）
      const clickX = rawNoteRight * SMALL_SCALE + rawOffsetPx;
      const clickY = rawClickY * SMALL_SCALE;

      fireEvent.click(midHit, { clientX: clickX, clientY: clickY });

      // 選択（.vf-note-selected の描画）になっていること。
      // setSelected による状態更新→再描画は useEffect 経由で svg 全体を作り直すため、
      // クリック前に取得した svg 参照は使わず、container から都度取得し直す
      // （SingleStaffArrowKeyEdit.test.tsx の選択マーカー確認と同じ流儀）。
      await waitFor(() => {
        const selectedRect = container.querySelector('rect.vf-note-selected');
        expect(selectedRect).toBeTruthy();
      });

      // 「追加」ではないので、onChange は呼ばれない（音符は3つのまま）。
      if (onChange.mock.calls.length > 0) {
        const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
        expect(updated[0].events).toHaveLength(3);
      }
    } finally {
      teardown();
    }
  });

  it('編成譜相当の縮小スケール（scale=0.3）でも、符頭から十分離れた空き拍クリックは音符追加のまま', () => {
    setup();
    try {
      const { svg, onChange } = renderSmallScaleScore();

      // 最後の音符のヒット領域は小節右端まで広がっている（空き拍領域を含む）。
      const lastHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="2"]') as SVGRectElement;
      expect(lastHit).toBeTruthy();

      const rawY = parseFloat(lastHit.getAttribute('y')!);
      const rawH = parseFloat(lastHit.getAttribute('height')!);
      const rawLineSpacing = rawH / 10;
      const rawClickY = rawY + (2 - (-3)) * rawLineSpacing;
      const rawX = parseFloat(lastHit.getAttribute('x')!);
      const rawW = parseFloat(lastHit.getAttribute('width')!);

      // 小節右端ぎりぎり（符頭から確実に keySelectXPad(0.3) より離れている）を、
      // 画面px座標に変換してクリックする。
      const rawClickX = rawX + rawW - 3;
      const clickX = rawClickX * SMALL_SCALE;
      const clickY = rawClickY * SMALL_SCALE;

      fireEvent.click(lastHit, { clientX: clickX, clientY: clickY });

      expect(onChange).toHaveBeenCalled();
      const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
      expect(updated[0].events).toHaveLength(4);
      expect(updated[0].events[3].isRest).toBe(false);
      expect(updated[0].events[3].keys).toEqual(['b/4']);
    } finally {
      teardown();
    }
  });
});
