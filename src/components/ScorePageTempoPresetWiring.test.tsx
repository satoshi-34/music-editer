// src/components/ScorePageTempoPresetWiring.test.tsx
// Issue #457: テンポ表記の定番候補（Andante・Allegro 等）の ScorePage 配線テスト。
//
// PianoSystemCanvasTempoPreset.test.tsx は props 直接注入なので、
// ScorePage → PianoStaff → PianoSystemCanvas の実経路（ツールバーでテンポ表記を選ぶ →
// 音符をクリック → 候補を選んで確定）が退行しても通ってしまう。ここでは作品を復元した
// 実経路で「候補が出る・選んで確定すると譜面に出る・保存データにも入る」ことを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { TEMPO_MARKING_PRESETS, TEMPO_MARKING_DATALIST_ID } from '../utils/tempoMarkingPresets';

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

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** 1小節に4分音符が並ぶ単旋律作品（レイヤー選択の影響を避けるため single） */
function seedWork() {
  const data = createSavedScoreData(
    { title: 'テンポ候補の配線テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{
      partId: 'piano',
      clef: 'treble',
      measures: [{
        events: [
          { dur: '4' as const, isRest: false, keys: ['c/5'] },
          { dur: '4' as const, isRest: false, keys: ['d/5'] },
          { dur: '4' as const, isRest: false, keys: ['e/5'] },
          { dur: '4' as const, isRest: false, keys: ['f/5'] },
        ],
      }],
    }],
    1,
    1,
    'single'
  );
  const created = createWork('テンポ候補の配線テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

describe('ScorePage: テンポ表記の定番候補の配線（Issue #457）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 700, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('演奏記号タブでテンポ表記を選び、候補から選んで確定すると譜面に出て保存される', async () => {
    seedWork();
    render(<ScorePage />);

    // 譜面が描かれるまで待つ
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 10000 });

    // ツールバー「演奏記号」タブ → テンポ表記ツール
    fireEvent.click(screen.getByRole('tab', { name: /演奏記号/ }));
    const tempoButton = await screen.findByRole('button', {
      name: 'テンポ表記（対象の音符をクリックして入力）',
    });
    fireEvent.click(tempoButton);

    // 1つ目の音符をクリックして入力欄を開く
    const hit = document.querySelector(
      'rect.vf-note-hit[data-measure="0"][data-note="0"]'
    ) as SVGRectElement;
    expect(hit).toBeTruthy();
    fireEvent.click(hit, {
      clientX: (Number(hit.getAttribute('data-note-left')) + Number(hit.getAttribute('data-note-right'))) / 2,
      clientY: Number(hit.getAttribute('y')) + 10,
    });

    // 候補リストが入力欄に紐づいて描画されている
    const input = await waitFor(() => {
      const el = document.querySelector(`input[list="${TEMPO_MARKING_DATALIST_ID}"]`) as HTMLInputElement;
      expect(el, 'テンポ表記の入力欄が候補リストに紐づいて開くこと').toBeTruthy();
      return el;
    });
    const options = Array.from(
      document.querySelectorAll(`datalist#${TEMPO_MARKING_DATALIST_ID} option`)
    ).map((o) => o.getAttribute('value'));
    expect(options).toEqual([...TEMPO_MARKING_PRESETS]);

    // 候補「Andante」を選んで確定する（候補の選択はブラウザが入力欄へ値を入れる操作）
    fireEvent.change(input, { target: { value: 'Andante' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 譜面（SVG）に描かれる
    await waitFor(() => {
      const drawn = Array.from(document.querySelectorAll('svg text')).map((t) => t.textContent);
      expect(drawn).toContain('Andante');
    });

    // 保存データ（自動保存）にも tempoMarking の文字列として入る
    await waitFor(() => {
      // 保存先のキー名（作品 ID を含む）に依存しないよう、localStorage 全体を文字列として見る
      const dump = Array.from({ length: localStorageMock.length }, (_, i) => localStorageMock.key(i))
        .map((key) => (key ? localStorageMock.getItem(key) : null))
        .filter((v): v is string => typeof v === 'string')
        .join('\n');
      expect(dump).toContain('"tempoMarking":"Andante"');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
