// ピアノ譜のレイヤー明示選択×空白クリック挿入（裁定②案A・2026-08-23）の配線テスト。
// PianoSystemCanvasLayerSelection.test.tsx は props を直接注入しているため、
// ScorePage → PianoSystemCanvas の activeLayerPartIndex の受け渡しが消えても通る。
// ここでは ScorePage を実際にマウントし、既定レイヤー（右手・声部1）のまま左手帯の
// 空白をクリックすると選択レイヤーへ入ることを固定する（CLAUDE.md の統合テストルール）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { SCORE_EDIT_NOTICE_EVENT } from '../utils/scoreEditorNotices';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;
const WIDTH = 700;

function mockSvgLayout(svg: SVGSVGElement) {
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 400;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: WIDTH, bottom: height, width: WIDTH, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: WIDTH } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

describe('ScorePage: ピアノの空白クリックは選択レイヤーへ入る（裁定②案A の配線）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => WIDTH, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('既定レイヤー（右手・声部1）のまま左手帯の空白をクリックすると右手へ入り、帯またぎ通知が出る', async () => {
    const notices: string[] = [];
    const onNotice = (e: Event) => notices.push((e as CustomEvent<{ message: string }>).detail?.message ?? '');
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    try {
      render(<ScorePage />);
      // ピアノ大譜表へ切り替え（既定レイヤーは右手・声部1）
      fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
      fireEvent.click(screen.getByRole('button', { name: 'ピアノ' }));
      // レイヤーUIが出ている＝ScorePage がレイヤー状態を持っていることの確認
      fireEvent.click(screen.getByRole('tab', { name: '音符・休符' }));
      expect(screen.getByRole('button', { name: '右手・声部1' })).toBeTruthy();

      // 最初の内容 svg の「下側の帯」（左手）の小節背景をクリックする
      const svg = Array.from(document.querySelectorAll('svg'))
        .find((candidate) => candidate.querySelector('rect.vf-hit')) as SVGSVGElement;
      expect(svg).toBeTruthy();
      mockSvgLayout(svg);
      const hits = Array.from(svg.querySelectorAll('rect.vf-hit')) as SVGRectElement[];
      // 同じ小節の上下の帯 = x が同じで y が違う2枚。y が大きい方が左手
      const firstX = parseFloat(hits[0].getAttribute('x') ?? '0');
      const sameMeasure = hits.filter((hit) => parseFloat(hit.getAttribute('x') ?? '0') === firstX);
      expect(sameMeasure.length).toBeGreaterThanOrEqual(2);
      const leftBand = sameMeasure.sort((a, b) => parseFloat(a.getAttribute('y')!) - parseFloat(b.getAttribute('y')!)).at(-1)!;
      const bx = parseFloat(leftBand.getAttribute('x')!);
      const bw = parseFloat(leftBand.getAttribute('width')!);
      const by = parseFloat(leftBand.getAttribute('y')!);
      const bh = parseFloat(leftBand.getAttribute('height')!);

      expect(svg.querySelectorAll('rect.vf-note-hit')).toHaveLength(0);
      fireEvent.click(leftBand, { clientX: bx + bw * 0.5, clientY: by + bh * 0.5 });

      // 挿入された音符の編集セルはアクティブレイヤー（右手）にだけ作られるので、
      // vf-note-hit の出現 = 右手へ入った証拠。左手に入っていたら（案B/配線切れ）
      // レイヤー外のため編集セルは作られず、通知も切替系になる
      // 挿入後の再描画で svg 要素ごと差し替わるため、毎回取り直して数える
      await waitFor(() => {
        const current = Array.from(document.querySelectorAll('svg'))
          .find((candidate) => candidate.querySelector('rect.vf-note-hit'));
        expect(current).toBeTruthy();
      });
      expect(notices.join(' ')).toContain('右手・声部1に入れました');
    } finally {
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    }
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
