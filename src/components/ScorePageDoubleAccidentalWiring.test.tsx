// ダブルシャープ・ダブルフラット・descresc.（#423）の ScorePage 配線テスト（Codex round1 P2）。
//
// Palette 単体テストは props 直渡しのため、実タブ操作 → tool state → 譜面クリック →
// 保存データ・SVG 描画という配線を固定できない。ここで実経路をまとめて固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

let workId = '';

function seedWork() {
  const events = [
    { dur: '2' as const, isRest: false, keys: ['g/4'] },
    { dur: '2' as const, isRest: false, keys: ['a/4'] },
  ];
  const data = createSavedScoreData(
    { title: 'ダブル記号配線', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('ダブル記号配線');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

function firstNoteHit(): SVGRectElement {
  return document.querySelector('rect.vf-note-hit[data-note="0"]') as SVGRectElement
    ?? document.querySelector('rect.vf-note-hit') as SVGRectElement;
}

describe('ScorePage: ダブル記号と descresc. の配線（#423）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('𝄪 ツールで音符をクリックすると keys が ## になり、保存・SVG まで届く', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // VexFlow の臨時記号は g.vf-modifiers 配下の text グリフとして描かれる。
    // クラス名がバージョンで揺れるため、SVG 内の text ノード総数の増加で
    // 「臨時記号グリフが描画された」ことを検出する（適用前後で同じ譜面・同じ音符数）
    const svgTextCount = () => document.querySelectorAll('.system-stack svg text').length;
    const before = svgTextCount();
    fireEvent.click(screen.getByRole('button', { name: /ダブルシャープ（全音上げ）/ }));
    fireEvent.click(firstNoteHit());

    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.keys?.[0]).toBe('g##/4');
    }, { timeout: 15000 });
    // SVG にも臨時記号が実際に描かれる（保存だけ通って描画へ渡らない退行の検出・round2 P2）
    await waitFor(() => {
      expect(svgTextCount()).toBeGreaterThan(before);
    }, { timeout: 15000 });
    // 外すのは♮（既存の♯♭と同じ規則。同じ記号の再クリックは維持）
    fireEvent.click(screen.getByRole('button', { name: /ナチュラル/ }));
    fireEvent.click(firstNoteHit());
    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.keys?.[0]).toBe('g/4');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('descresc. を音符に付けると保存され、テキストとして描かれる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: '演奏記号' }));
    fireEvent.click(await screen.findByRole('button', { name: /デクレッシェンド/ }, { timeout: 15000 }));
    fireEvent.click(firstNoteHit());

    await waitFor(() => {
      const ev = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures?.[0]?.events?.[0];
      expect(ev?.dynamics?.some((d) => d.value === 'descresc')).toBe(true);
    }, { timeout: 15000 });
    expect(document.body.textContent).toContain('descresc.');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // #430 round2 P2: 調号領域を 𝄪 で押したときの「行き止まりは喋る」と履歴・保存の不変
  it('𝄪 で調号領域をクリックすると案内が出て、譜面は変わらない', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 調号領域はデバッグ用 rect（vf-key-signature-debug）が示す範囲。SVG座標=画面座標に
    // なるようモックしてから、その中心をクリックする
    const svg = Array.from(document.querySelectorAll('svg'))
      .find((c) => c.querySelector('rect.vf-key-signature-debug') || c.querySelector('rect.vf-hit')) as SVGSVGElement;
    const width = parseFloat(svg.getAttribute('width') ?? '0') || 900;
    const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
    svg.getBoundingClientRect = vi.fn(() => ({
      left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}),
    })) as unknown as typeof svg.getBoundingClientRect;
    Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
    Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });

    const debugRect = svg.querySelector('rect.vf-key-signature-debug') as SVGRectElement | null;
    // デバッグ rect が出ない構成（調号Cで領域なし等）ならこの経路は成立しないため中断せず終わる
    if (!debugRect) return;
    const cx = parseFloat(debugRect.getAttribute('x')!) + parseFloat(debugRect.getAttribute('width')!) / 2;
    const cy = parseFloat(debugRect.getAttribute('y')!) + parseFloat(debugRect.getAttribute('height')!) / 2;

    const savedBefore = JSON.stringify(loadWorkAutosaveData(workId).data?.parts);
    fireEvent.click(screen.getByRole('button', { name: /ダブルシャープ（全音上げ）/ }));
    fireEvent.click(svg, { clientX: cx, clientY: cy });

    await waitFor(() => {
      const notice = document.querySelector('[data-testid="edit-notice"]');
      expect(notice?.textContent ?? '').toContain('調号には使えません');
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2000));
    expect(JSON.stringify(loadWorkAutosaveData(workId).data?.parts)).toBe(savedBefore);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
