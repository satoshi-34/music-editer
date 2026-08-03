// バグ修正の再現・回帰確認テスト:
// 「画面表示のズーム」（.page-wrapper の --scale。ツールバー最下段の常設エリアにある
// 画面表示のズームスライダー、0.5〜3.0）を上げると、和音内の個別音をクリックしても
// 選択にならなくなる/選択の許容幅がズレるという報告への対応。
//
// Issue #176 でスライダーの上限を 150% → 300% へ広げたため、150% だけでなく
// 300%（新しい上限）でも同じ検証を通すよう、ズーム倍率でパラメータ化してある。
// 座標変換（clientToGroup・getRawPerScreenPx）が実測ベースで倍率に依存しない
// 作りになっているかを、上限を上げた後も機械的に担保するのが狙い。
//
// 原因: 個別音選択のX方向許容幅 keySelectXPad は、以前は VexFlow の requestedScale
// （PianoSystemCanvas の scale prop、s）だけを使って画面px→raw単位に変換していた。
// s には「画面表示のズーム」（.page-wrapper の --scale、CSSズーム）の分が含まれて
// いないため、画面px換算の実効パディングがズーム倍率によって変わってしまっていた
// （PianoSystemCanvas.tsx の keySelectXPad 実装コメント参照）。
//
// 修正: getSvgVisualMetrics/getRawPerScreenPx で svg.getBoundingClientRect()（実測値、
// CSSズームを含む実際の見た目サイズ）から「画面px ⇄ raw単位」の実効スケールを求め、
// keySelectXPad をその実測値ベースに変更した。これにより画面px換算の許容幅は
// 常に KEY_SELECT_X_PAD_SCREEN_PX（12px）で一定になり、ズーム倍率に左右されなくなる。
//
// このテストでは、符頭から画面px換算で
//   - 10px（新旧どちらの許容幅（12px・18px）にも収まる）→ 選択になる
//   - 14px（新しい許容幅12pxの外だが、ズーム分を無視していた旧実装の許容幅18pxの
//     内側）→ 修正後は選択に「ならない」ことを確認する
// の2パターンを検証する。2つ目のケースは、旧実装（keySelectXPad(s) が
// CSSズームを無視していた版）ではズームのぶん許容幅が広がりすぎて「選択」に
// なってしまっていたケースであり、この修正による挙動変化を検出できる。
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
const TEST_CONTAINER_WIDTH = 700;
// 編成譜相当の縮小スケール。PianoSystemCanvas の scale prop（requestedScale = s）に渡す。
const SMALL_SCALE = 0.3;
// 「画面表示のズーム」相当（.page-wrapper の --scale）として検証する倍率。
// 150% は従来の上限、300% は Issue #176 で引き上げた新しい上限。
const VIEW_ZOOMS = [1.5, 3] as const;

// svg.getBoundingClientRect() を「.page-wrapper の transform: scale(--scale) が
// 実際に適用された後の見た目サイズ」に見せかける。
// 本物のブラウザでは CSS transform を親要素にかけると getBoundingClientRect は
// 自動的にズーム後のサイズを返すため、このスタブはその挙動を模している。
function mockZoomedSvgLayout(svg: SVGSVGElement, viewZoom: number) {
  const width = TEST_CONTAINER_WIDTH * viewZoom;
  const logicalHeight = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  const height = logicalHeight * viewZoom;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  })) as any;
  // width/height の baseVal は「ズーム前の論理サイズ」（VexFlow が描画した実寸）のまま。
  // CSS transform は要素そのものの座標を書き換えないため、baseVal はズームの影響を受けない。
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: TEST_CONTAINER_WIDTH } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: logicalHeight } }, configurable: true });
}

describe.each(VIEW_ZOOMS)('PianoSystemCanvas 画面表示のズーム(%s倍)での個別音選択', (VIEW_ZOOM) => {
  // 実効スケール（画面px ⇄ raw単位の変換係数）。s と CSSズームの両方を含む。
  const EFFECTIVE_SCALE = SMALL_SCALE * VIEW_ZOOM;
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

  function renderZoomedScore() {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();

    // 実際の画面では .page-wrapper に --scale を設定し、その子（.print-page）に
    // transform: scale(var(--scale)) をかけて画面表示のズームを行う
    // （App.css 参照）。getAccumulatedCSSZoom は最も近い .page-wrapper から
    // --scale を読むため、テストでも同じ構造を再現する。
    const { container } = render(
      <div className="page-wrapper" style={{ '--scale': String(VIEW_ZOOM) } as React.CSSProperties}>
        <PianoSystemCanvas
          measuresPerSystem={1}
          tool={{ duration: '4', isRest: false }}
          scale={SMALL_SCALE}
          partsConfig={[{ clef: 'treble', data, onChange }]}
          showInstrumentLabels={false}
          timeSignature={[4, 4]}
        />
      </div>
    );

    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockZoomedSvgLayout(svg, VIEW_ZOOM);
    return { svg, onChange, container };
  }

  it('符頭から画面px換算10px（新旧どちらの許容幅にも収まる）は選択になる', async () => {
    setup();
    try {
      const { svg, container } = renderZoomedScore();

      const midHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
      expect(midHit).toBeTruthy();

      const rawY = parseFloat(midHit.getAttribute('y')!);
      const rawH = parseFloat(midHit.getAttribute('height')!);
      const rawLineSpacing = rawH / 10;
      const rawClickY = rawY + (2 - (-3)) * rawLineSpacing;
      const rawNoteRight = parseFloat(midHit.getAttribute('data-note-right')!);

      // 画面px換算のオフセット。clientToGroup は screen = raw * effectiveScale なので
      // raw座標に screenOffset/effectiveScale を足してから effectiveScale を掛け戻す。
      const screenOffsetPx = 10;
      const clickX = rawNoteRight * EFFECTIVE_SCALE + screenOffsetPx;
      const clickY = rawClickY * EFFECTIVE_SCALE;

      fireEvent.click(midHit, { clientX: clickX, clientY: clickY });

      await waitFor(() => {
        const selectedRect = container.querySelector('rect.vf-note-selected');
        expect(selectedRect).toBeTruthy();
      });
    } finally {
      teardown();
    }
  });

  it('符頭から画面px換算14px（修正後の許容幅12pxの外）は選択にならない', async () => {
    setup();
    try {
      const { svg, onChange } = renderZoomedScore();

      const midHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
      expect(midHit).toBeTruthy();

      const rawY = parseFloat(midHit.getAttribute('y')!);
      const rawH = parseFloat(midHit.getAttribute('height')!);
      const rawLineSpacing = rawH / 10;
      const rawClickY = rawY + (2 - (-3)) * rawLineSpacing;
      const rawNoteRight = parseFloat(midHit.getAttribute('data-note-right')!);

      // 14px は修正後の許容幅（12px）の外。
      // 修正前（keySelectXPad(s) が CSSズームを無視していた版）では
      // 画面px換算の許容幅が 12 * VIEW_ZOOM（150%なら18px、300%なら36px）まで
      // 広がっていたため、このオフセットでも誤って「選択」になってしまっていた。
      const screenOffsetPx = 14;
      const clickX = rawNoteRight * EFFECTIVE_SCALE + screenOffsetPx;
      const clickY = rawClickY * EFFECTIVE_SCALE;

      fireEvent.click(midHit, { clientX: clickX, clientY: clickY });

      // 個別音選択にはならない（.vf-note-selected は keyIndex 指定時のみ描画される）。
      // 和音追加ゾーンの外なので、代わりに新規音符の挿入（onChange 呼び出し）が起きる。
      await waitFor(() => {
        expect(onChange).toHaveBeenCalled();
      });
      const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
      expect(updated[0].events.length).toBeGreaterThan(3);
    } finally {
      teardown();
    }
  });

  // Issue #176: ズームの上限を300%へ広げたので、「拡大しても狙った高さに音符が入る」
  // ことを倍率ごとに固定しておく。座標変換（clientToGroup）がズーム倍率を実測から
  // 取り込めていれば、同じ raw 座標を指すクリックは倍率に関わらず同じ音高になる。
  it('同じ位置（raw座標）をクリックすれば、ズーム倍率が変わっても同じ音高が入る', async () => {
    setup();
    try {
      const { svg, onChange } = renderZoomedScore();

      const midHit = svg.querySelector('rect.vf-note-hit[data-measure="0"][data-note="1"]') as SVGRectElement;
      expect(midHit).toBeTruthy();

      const rawY = parseFloat(midHit.getAttribute('y')!);
      const rawH = parseFloat(midHit.getAttribute('height')!);
      const rawLineSpacing = rawH / 10;
      // 五線の第3線（真ん中の線）を狙う。ヒット領域の上端 rawY は line=-3 に相当し、
      // そこから 3 行ぶん下がった位置がちょうど第3線（ト音記号では B4=シ）になる。
      const rawClickY = rawY + 3 * rawLineSpacing;
      const rawNoteRight = parseFloat(midHit.getAttribute('data-note-right')!);

      // 和音の追加ゾーン（符頭の近傍12px）から十分離し、新規音符の挿入にする
      const clickX = rawNoteRight * EFFECTIVE_SCALE + 40;
      const clickY = rawClickY * EFFECTIVE_SCALE;

      fireEvent.click(midHit, { clientX: clickX, clientY: clickY });

      await waitFor(() => {
        expect(onChange).toHaveBeenCalled();
      });
      const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];
      const inserted = updated[0].events.at(-1)!;
      // 倍率（150%・300%）に関わらず同じ音高になることが要点。
      // 座標変換がズームを二重に掛ける/掛け忘れると、ここが線1本ぶん以上ずれて落ちる
      expect(inserted.keys).toEqual(['b/4']);
    } finally {
      teardown();
    }
  });
});
