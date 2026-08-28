// 弧の端点と符頭の隙間（Issue #446）の ScorePage 配線テスト。
// 単体テスト（resolveArcEndpointY）だけでは「ScorePage の描画経路がその値を使うこと」を
// 検出できないため、保存作品の復元 → 実描画された path.vf-arc の端点Yを DOM で固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import { ARC_NOTEHEAD_GAP } from '../utils/arcStemAnchorUtils';
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

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

/** 4/4 の1小節: 同音 g/4 の4分×2 をタイで結ぶ + 2分休符（単旋律） */
function seedTieWork() {
  const events = [
    {
      dur: '4' as const, isRest: false, keys: ['g/4'],
      arcs: [{ fromKey: 'g/4', toKey: 'g/4', toMeasureIndex: 0, toEventIndex: 1, kind: 'tie' as const }],
    },
    { dur: '4' as const, isRest: false, keys: ['g/4'] },
    { dur: '2' as const, isRest: true, keys: ['b/4'] },
  ];
  const data = createSavedScoreData(
    { title: '弧の隙間', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
    1, 1, 'single'
  );
  const created = createWork('弧の隙間');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
}

describe('ScorePage: 弧の端点と符頭の隙間（#446 配線）', () => {
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

  it('保存作品の復元 → 描画されたタイの端点が符頭中心から ARC_NOTEHEAD_GAP だけ外側', async () => {
    seedTieWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('path.vf-arc')).toBeTruthy();
    }, { timeout: 15000 });

    // 端点Y: テーパー形状（閉パス）の d は "M x1 y1 ..." で始まり、始点は端点そのもの
    const arc = document.querySelector('path.vf-arc') as SVGPathElement;
    const d = arc.getAttribute('d') ?? '';
    const m = d.match(/^M\s*([-\d.]+)[ ,]([-\d.]+)/);
    expect(m).toBeTruthy();
    const y1 = Number(m![2]);

    // 符頭中心Y: 音符ヒット矩形の data-line0-y（五線の最上線Y）から求める。
    // g/4 はト音記号で上から3本目の線＝VexFlow line 3（1線 = 10）
    const hit = document.querySelector('rect.vf-note-hit[data-measure="0"]') as SVGRectElement;
    expect(hit).toBeTruthy();
    const line0Y = Number(hit.getAttribute('data-line0-y'));
    expect(Number.isFinite(line0Y)).toBe(true);
    const noteheadY = line0Y + 3 * 10;

    // 弧の向き（上/下）に依存しないよう絶対値で見る。手動オフセットなし＝一律の隙間
    expect(Math.abs(y1 - noteheadY)).toBeCloseTo(ARC_NOTEHEAD_GAP, 5);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
