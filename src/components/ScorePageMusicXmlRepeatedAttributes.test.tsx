// Issue #526 の配線テスト（統合テスト）。
//
// 「変更の無い <attributes> を毎小節書き直す」外部書き出し風の MusicXML を、実際の
// 「ファイル」タブ → ファイル選択の経路で読み込み、**画面に描かれた段割り**が
// 1小節/段へ潰れないことを固定する。純関数側の検証は
// src/utils/musicXmlRepeatedAttributesLayout.test.ts が担当し、ここは
// 「読込 → ScorePage の段割り計画 → 描画」まで配線が通っていることを見る。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';

import ScorePage from './ScorePage';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';

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

const MOUNT_HEAVY_TIMEOUT_MS = 120000;

/** 読込前の作品（既定の4小節/段）。ここへ MusicXML を読み込ませる。 */
function seedEmptyWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '読込前', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 4, 'single'
  );
  const created = createWork('読込前');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

/**
 * 描画された段ごとの小節数。
 * 小節の当たり判定（rect.vf-hit）は「小節 × パート」ぶん出るので、
 * ピアノ大譜表（2パート）では 2 で割ると段あたりの小節数になる。
 */
function renderedMeasuresPerSystem(): number[] {
  return Array.from(document.querySelectorAll('svg'))
    .map((svg) => svg.querySelectorAll('rect.vf-hit').length)
    .filter((hits) => hits > 0)
    .map((hits) => hits / 2);
}

describe('ScorePage: 毎小節 attributes を書き直した MusicXML の段割り（#526）', () => {
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

  it('読み込んだ月光（大譜表・毎小節 attributes）が1小節/段へ潰れない', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 30000 });

    const xml = readFileSync(
      resolve(__dirname, '../../docs/qa/regression/moonlight-bars1-9-grandstaff.musicxml'), 'utf-8',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    const input = Array.from(document.querySelectorAll('input[type="file"]'))
      .find((i) => (i.getAttribute('accept') ?? '').includes('.mxl')) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, {
      target: { files: [new File([xml], 'moonlight.musicxml', { type: 'application/xml' })] },
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('月光 第1楽章');
    }, { timeout: 30000 });
    // 読込直後の再計画（段割り・ページ割り）が落ち着くのを待つ
    await waitFor(() => {
      expect(renderedMeasuresPerSystem().length).toBeGreaterThan(0);
    }, { timeout: 30000 });

    const measuresPerSystem = renderedMeasuresPerSystem();
    // 内容のある13小節（入力済み9＋末尾の空4）を受け持つ先頭5段。
    // 修正前は最低幅の水増しで [2, 2, 1, 2, 3] まで縮んでいた（3段目が1小節/段）。
    // 修正後は直接入力した同じ譜面（moonlight-bars1-9.score.json の段割り上書きを
    // 外したもの）と同じ [3, 2, 3, …] になる。
    expect(measuresPerSystem.slice(0, 4)).toEqual([3, 2, 3, 4]);
    // 受入条件1: 入力済み9小節を受け持つ段は、どれも2小節以上入っている
    expect(measuresPerSystem.slice(0, 4).every((count) => count >= 2)).toBe(true);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
