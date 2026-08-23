// 記号の調整オーバーレイが、調整対象の記号に被らない位置に開くことの回帰テスト（Issue #230）。
//
// 症状: 「記号位置調整」「記号サイズ変更」のオーバーレイはクリックした場所にそのまま開いていたため、
// 対象記号の真上に被さり、矢印キーで動かしても記号が見えなかった。
//
// jsdom はレイアウトを行わないので、確認に必要な計測だけを差し替えている:
//   - getBBox: 記号のクリック判定 rect（.symbol-hit-region）を作るために必要
//   - SVG 要素の getBoundingClientRect: x/y/width/height 属性をそのまま画面座標として返す
//     （コンテナは原点 0,0・縮小率 1 として扱われるため、SVG 座標＝オーバーレイ座標になる）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import SymbolAdjustOverlay from './SymbolAdjustOverlay';
import type { CustomSymbolDef, MeasureData } from '../types/storage';
import { SYMBOL_OVERLAY_GAP, SYMBOL_OVERLAY_FALLBACK_HEIGHT } from '../utils/symbolOverlayPlacementUtils';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function () {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: { PIANO: 'piano', ORGAN: 'organ', GUITAR: 'guitar', STRINGS: 'strings' },
  SoundSource: vi.fn().mockImplementation(function () {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn(),
    };
  }),
}));

const SYMBOL_DEF: CustomSymbolDef = {
  id: 'sym-1',
  name: 'テスト記号',
  shapes: [{ kind: 'circle', cx: 0, cy: 0, r: 4, filled: true }],
};

// 記号が「五線のかなり下（画面上端から十分離れた位置）」に描かれている想定。
// 上に置いても画面からはみ出さない＝既定の「上に出す」経路を通る。
const SYMBOL_BBOX = { x: 120, y: 240, width: 18, height: 14 };

/** オーバーレイ（div）と記号（rect）が1pxでも重なっていないか */
function overlapsSymbol(overlay: HTMLElement, symbol: { left: number; top: number; width: number; height: number }) {
  const left = parseFloat(overlay.style.left);
  const top = parseFloat(overlay.style.top);
  // オーバーレイの実寸は jsdom では測れないため、実装と同じ代替サイズで判定する
  const width = 200;
  const height = SYMBOL_OVERLAY_FALLBACK_HEIGHT;
  return left < symbol.left + symbol.width
    && left + width > symbol.left
    && top < symbol.top + symbol.height
    && top + height > symbol.top;
}

describe('記号調整オーバーレイの表示位置（Issue #230）', () => {
  let originalGetBBox: unknown;
  let originalSvgRect: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    originalGetBBox = (SVGElement.prototype as unknown as Record<string, unknown>).getBBox;
    originalSvgRect = (SVGElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
    (SVGElement.prototype as unknown as Record<string, unknown>).getBBox = function () {
      return { ...SYMBOL_BBOX };
    };
    // SVG 要素は属性値をそのまま画面座標として返す（コンテナ原点 0,0・等倍の想定）
    (SVGElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect = function (this: SVGElement) {
      const num = (name: string) => parseFloat(this.getAttribute(name) ?? '0') || 0;
      const left = num('x');
      const top = num('y');
      const width = num('width');
      const height = num('height');
      return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
    };
  });

  afterEach(() => {
    (SVGElement.prototype as unknown as Record<string, unknown>).getBBox = originalGetBBox;
    (SVGElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect = originalSvgRect;
  });

  function renderScore() {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'], customSymbols: [{ symbolId: 'sym-1' }] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const onChange = vi.fn();
    const utils = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        customSymbolDefs={[SYMBOL_DEF]}
        symbolsClickable
      />
    );
    return { ...utils, onChange };
  }

  /** 記号のクリック判定 rect（描画時に .symbol-hit-region として置かれる） */
  function symbolHitRegion(container: HTMLElement): SVGRectElement {
    const hit = container.querySelector('rect.symbol-hit-region') as SVGRectElement | null;
    expect(hit).toBeTruthy();
    return hit!;
  }

  /** 記号のクリック判定 rect の位置・大きさ（＝オーバーレイが避けるべき範囲） */
  function symbolRect(container: HTMLElement) {
    const r = symbolHitRegion(container).getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  it('記号をクリックして開いた位置調整オーバーレイが、記号に重ならず上に出る', () => {
    const { container } = renderScore();
    fireEvent.click(symbolHitRegion(container), { clientX: 128, clientY: 246 });

    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    // 計測後の確定位置になっていること（暫定位置のままではない）
    expect(overlay.dataset.placed).toBe('true');

    const symbol = symbolRect(container);
    // 記号の上・余白ぶん離れた位置に出る
    expect(parseFloat(overlay.style.top)).toBe(symbol.top - SYMBOL_OVERLAY_GAP - SYMBOL_OVERLAY_FALLBACK_HEIGHT);
    expect(overlapsSymbol(overlay, symbol)).toBe(false);
  });

  it('矢印キーの調整中はオーバーレイが半透明になり、止まる/カーソルが乗ると戻る（#385 裁定C）', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderScore();
      fireEvent.click(symbolHitRegion(container), { clientX: 128, clientY: 246 });
      const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
      // 開いた直後は不透明
      expect(overlay.classList.contains('symbol-adjust-overlay-translucent')).toBe(false);

      // 矢印キーを押すと透ける（位置合わせの参照物＝周辺の音符が見える）
      const xInput = container.querySelectorAll('.symbol-adjust-overlay input')[0] as HTMLInputElement;
      fireEvent.keyDown(xInput, { key: 'ArrowRight' });
      expect(container.querySelector('.symbol-adjust-overlay-translucent')).toBeTruthy();

      // キー入力が止まって 800ms 経つと不透明へ戻る
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelector('.symbol-adjust-overlay-translucent')).toBeNull();

      // もう一度透かした状態でカーソルが乗ると、待たずに戻る
      fireEvent.keyDown(xInput, { key: 'ArrowDown' });
      expect(container.querySelector('.symbol-adjust-overlay-translucent')).toBeTruthy();
      fireEvent.mouseEnter(container.querySelector('.symbol-adjust-overlay') as HTMLElement);
      expect(container.querySelector('.symbol-adjust-overlay-translucent')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('矢印キーで記号を動かしてもオーバーレイは動かない（開いた位置に固定）', () => {
    const { container } = renderScore();
    fireEvent.click(symbolHitRegion(container), { clientX: 128, clientY: 246 });

    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    const beforeTop = overlay.style.top;
    const beforeLeft = overlay.style.left;

    const xInput = container.querySelectorAll('.symbol-adjust-overlay input')[0] as HTMLInputElement;
    fireEvent.keyDown(xInput, { key: 'ArrowRight' });
    fireEvent.keyDown(xInput, { key: 'ArrowDown' });

    // 記号（下書き）は動くが、オーバーレイは開いた位置のまま
    expect(xInput.value).not.toBe('0');
    const after = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(after.style.top).toBe(beforeTop);
    expect(after.style.left).toBe(beforeLeft);
  });

  it('サイズ変更オーバーレイも同じ配置ロジックで記号に重ならない', () => {
    const data: MeasureData[] = [{
      events: [
        { dur: '4', isRest: false, keys: ['b/4'], customSymbols: [{ symbolId: 'sym-1' }] },
        { dur: '4', isRest: false, keys: ['b/4'] },
      ],
    }];
    const { container } = render(
      <PianoSystemCanvas
        measuresPerSystem={1}
        // 「カスタム記号サイズ変更」ツール: 記号が付いた音符をクリックするとサイズ変更オーバーレイが開く
        tool={{ mode: 'customSymbolResize', symbolId: 'sym-1' }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange: vi.fn() }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        customSymbolDefs={[SYMBOL_DEF]}
      />
    );

    const noteHit = container.querySelector('rect.vf-note-hit[data-measure="0"][data-note="0"]') as SVGRectElement;
    const noteRect = noteHit.getBoundingClientRect();
    fireEvent.click(noteHit, { clientX: noteRect.left + 2, clientY: noteRect.top + 2 });

    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('記号サイズ変更');
    // 音符を押して開いた場合も、記号の描画範囲（.symbol-hit-region）を基準に避ける
    const symbol = symbolRect(container);
    expect(parseFloat(overlay.style.top)).toBe(symbol.top - SYMBOL_OVERLAY_GAP - SYMBOL_OVERLAY_FALLBACK_HEIGHT);
    expect(overlapsSymbol(overlay, symbol)).toBe(false);
  });
});

describe('計測できない場合の暫定位置（Issue #392 防御）', () => {
  it('コンテナ ref が無いままでも、暫定位置は画面内（コンテナ左上の内側）へクランプされる', () => {
    // 譜面左端・上端の記号では概算位置が負座標になり、そのまま描くと入力欄が
    // 画面外へ見切れる（#392 の報告と同じ形）。計測が走らない経路でも
    // 最低限コンテナの左上より内側に収まることを固定する
    const { container } = render(
      <SymbolAdjustOverlay
        anchor={{ left: -60, top: -50, width: 20, height: 10 }}
        containerRef={{ current: null }}
        minWidth={100}
      >
        <span>x</span>
      </SymbolAdjustOverlay>
    );
    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay.dataset.placed).toBe('false');
    expect(parseFloat(overlay.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(overlay.style.top)).toBeGreaterThanOrEqual(8);
  });

  it('overflow:hidden の祖先（A4ページ）に切り取られない位置へ置く（#392 の真因）', () => {
    // オーバーレイは position:absolute で譜面コンテナに属するため、.print-page の
    // overflow:hidden に視覚的に切られる。ビューポート内に収めるだけでは
    // 「画面内だがページの外」に置かれ、譜面左端の記号で左側が見切れていた
    const page = document.createElement('div');
    page.className = 'print-page';
    page.style.overflow = 'hidden';
    // ページは画面左端より右（x=200〜）にある想定
    page.getBoundingClientRect = () => ({
      left: 200, top: 0, right: 900, bottom: 800, width: 700, height: 800, x: 200, y: 0, toJSON: () => ({}),
    }) as DOMRect;
    const host = document.createElement('div');
    // コンテナ（オーバーレイの offsetParent）はページ内の x=210 から始まる
    host.getBoundingClientRect = () => ({
      left: 210, top: 10, right: 890, bottom: 790, width: 680, height: 780, x: 210, y: 10, toJSON: () => ({}),
    }) as DOMRect;
    Object.defineProperty(host, 'offsetWidth', { value: 680, configurable: true });
    page.appendChild(host);
    document.body.appendChild(page);
    try {
      // 記号はコンテナ左端付近（＝ページ左端付近）にある
      const { container } = render(
        <SymbolAdjustOverlay
          anchor={{ left: 5, top: 300, width: 20, height: 10 }}
          containerRef={{ current: host }}
          minWidth={100}
        >
          <span>x</span>
        </SymbolAdjustOverlay>
      );
      const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
      expect(overlay.dataset.placed).toBe('true');
      // コンテナ座標での左端 = ページ左端(200) - コンテナ左端(210) = -10。
      // これより左には置かない（置くと overflow:hidden に切られる）
      expect(parseFloat(overlay.style.left)).toBeGreaterThanOrEqual(-10);
    } finally {
      page.remove();
    }
  });

  it('あとから ref が揃うと、リトライで確定位置（data-placed=true）へ到達する', async () => {
    // 計測が空振りした場合の rAF リトライ経路（最大10回）の固定
    const containerRef: { current: HTMLDivElement | null } = { current: null };
    const { container } = render(
      <SymbolAdjustOverlay
        anchor={{ left: -60, top: -50, width: 20, height: 10 }}
        containerRef={containerRef}
        minWidth={100}
      >
        <span>x</span>
      </SymbolAdjustOverlay>
    );
    const overlay = container.querySelector('.symbol-adjust-overlay') as HTMLElement;
    expect(overlay.dataset.placed).toBe('false');
    // コンテナが後から現れる（マウント順の揺れの再現）
    const host = document.createElement('div');
    document.body.appendChild(host);
    containerRef.current = host;
    try {
      await waitFor(() => {
        expect((container.querySelector('.symbol-adjust-overlay') as HTMLElement).dataset.placed).toBe('true');
      });
    } finally {
      host.remove();
    }
  });
});
