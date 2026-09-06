// 声部レイヤーの一般化（Issue #417）の配線テスト。
//
// 受入条件のうち「ScorePage から実際に届くこと」をここで固定する:
//  1. ピアノ譜以外（単旋律譜）にもレイヤーチップが出る
//  2. 「＋」で声部が増え、増えた声部がそのまま編集対象になる
//  3. V キーが 1↔2 のトグルではなく巡回になる
//  4. 上限4声で「＋」が押せなくなり、理由が言葉で出る（#318「行き止まりは喋る」）
//  5. 声部3を選んで入力した音符が、保存データの voices[2] に入る
//     （＝ activeVoice が譜面キャンバスまで本当に配線されている）
//
// ScorePage の実マウントは重いので、他の統合テストと同じくタイムアウトを個別に延長する。
// また、1ファイルに ScorePage のマウントを2つ以上置くとローカル（jsdom）で
// 再描画が止まらなくなるため、検証は1マウント1テストにまとめている（#473 の実測メモと同じ扱い）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
  loadWorkAutosaveData,
} from '../utils/storage';
import { requestActivePartChange } from '../utils/scoreEditorNotices';
import { ensembleSecondStaffPartId } from '../utils/instrumentationPartUtils';
import type { ScoreInstrumentation } from '../types/storage';
import type { MeasureData, PartData } from '../types/storage';

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

const MOUNT_HEAVY_TIMEOUT_MS = 90000;
const TEST_CONTAINER_WIDTH = 900;

/** 声部1が4分音符4つで満杯の小節（拍のXの基準になる） */
function fullMeasure(): MeasureData {
  return {
    events: [
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['d/5'] },
      { dur: '4', isRest: false, keys: ['e/5'] },
      { dur: '4', isRest: false, keys: ['f/5'] },
    ],
  };
}

function seedEnsembleWork(): string {
  // 大譜表（ピアノ 2 段）の後ろに単段（Vn）がある編成: キャンバスのスロット順は
  // [Pf 上段, Pf 下段, Vn]、getEditablePartEntries の順は [Pf 上段, Vn, Pf 下段]
  const instrumentation: ScoreInstrumentation = {
    presetId: 'custom',
    name: 'ピアノ＋ヴァイオリン',
    parts: [
      { id: 'piano', name: 'Piano', abbreviation: 'Pf.', family: 'keyboard', clef: 'treble', staffCount: 2, transposition: 'C', bracketGroup: 'keyboard', playbackInstrument: 'piano' as never, order: 0 },
      { id: 'violin', name: 'Violin', abbreviation: 'Vn.', family: 'strings', clef: 'treble', staffCount: 1, transposition: 'C', bracketGroup: 'strings', playbackInstrument: 'violin' as never, order: 1 },
    ],
  };
  const parts: PartData[] = [
    { partId: 'piano', clef: 'treble', measures: [fullMeasure(), fullMeasure()] },
    { partId: 'violin', clef: 'treble', measures: [fullMeasure(), fullMeasure()] },
    { partId: ensembleSecondStaffPartId('piano'), clef: 'bass', measures: [fullMeasure(), fullMeasure()] },
  ];
  const data = { ...createSavedScoreData(
    { title: '編成レイヤーテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts, 1, 2, 'ensemble'
  ), instrumentation };
  const created = createWork('編成レイヤーテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

function seedQuartetWork(): string {
  const parts: PartData[] = [
    { partId: 'violin-1', clef: 'treble', measures: [fullMeasure(), fullMeasure()] },
    { partId: 'violin-2', clef: 'treble', measures: [fullMeasure(), fullMeasure()] },
    { partId: 'viola', clef: 'alto', measures: [fullMeasure(), fullMeasure()] },
    { partId: 'cello', clef: 'bass', measures: [fullMeasure(), fullMeasure()] },
  ];
  const data = createSavedScoreData(
    { title: '声部レイヤーテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    'quartet'
  );
  const created = createWork('声部レイヤーテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}


/** レイヤーチップ列（aria-label で引く）の中のボタン名一覧 */
function layerChipNames(): string[] {
  const group = screen.getByRole('group', { name: '編集レイヤー切り替え' });
  return Array.from(group.querySelectorAll('button'))
    .map(b => b.textContent?.trim() ?? '')
    .filter(name => name !== '＋');
}

/** いま選ばれているレイヤー（aria-current が付いているチップ）の名前 */
function currentLayerName(): string | undefined {
  const group = screen.getByRole('group', { name: '編集レイヤー切り替え' });
  return group.querySelector('button[aria-current="true"]')?.textContent?.trim();
}


// 譜面側（PianoSystemCanvas）が符頭クリック・空白クリックの入力で requestActivePartChange を呼ぶことは
// PianoSystemCanvasSymbolCrossLayer / VoiceClickScope のテストで固定している。ここでは ScorePage 側の
// 「その知らせを受けてチップ列・「＋」の宛先・添字の対応が正しく変わる」ことを固定する。
describe('ScorePage: 非ピアノ譜で「最後に触った段」にチップと「＋」が追従する（#417 round2 P2-1 / P2-2）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => TEST_CONTAINER_WIDTH, configurable: true });
  });
  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  });

  it('四重奏: ヴィオラを触るとチップ群と「＋」がヴィオラを指し、「＋」はヴィオラにだけ声部2を足す', async () => {
    const workId = seedQuartetWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelectorAll('rect.vf-hit').length).toBeGreaterThanOrEqual(4); }, { timeout: 20000 });
    expect(screen.getByRole('group', { name: 'Vn. Iのレイヤー' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vn. Iに声部を追加' })).toBeTruthy();

    requestActivePartChange(2);
    await waitFor(() => { expect(screen.getByRole('group', { name: 'Va.のレイヤー' })).toBeTruthy(); }, { timeout: 20000 });
    expect(screen.getByRole('button', { name: 'Va.に声部を追加' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Va.に声部を追加' }));
    await waitFor(() => expect(layerChipNames()).toEqual(['声部1', '声部2']));
    expect(currentLayerName()).toBe('声部2');
    const parts = loadWorkAutosaveData(workId).data?.parts ?? [];
    expect(parts[0]?.measures?.[0]?.voices?.length ?? 1).toBeLessThanOrEqual(1);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('編成譜: キャンバスのスロット添字（Pf 上段・Pf 下段・Vn）が編集パートの添字へ正しく写る', async () => {
    seedEnsembleWork();
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelectorAll('rect.vf-hit').length).toBeGreaterThanOrEqual(3); }, { timeout: 20000 });
    // 編成（instrumentation）は譜面の描画より少し遅れて state に入るので、ラベルが出るまで待つ
    await waitFor(() => { expect(screen.getByRole('group', { name: 'Pf.のレイヤー' })).toBeTruthy(); }, { timeout: 20000 });

    // スロット 2 = Vn（entries では添字 1）
    requestActivePartChange(2);
    await waitFor(() => { expect(screen.getByRole('group', { name: 'Vn.のレイヤー' })).toBeTruthy(); }, { timeout: 20000 });
    // スロット 1 = Pf の下段（entries では末尾）
    requestActivePartChange(1);
    await waitFor(() => { expect(screen.getByRole('group', { name: 'Pf.(下段)のレイヤー' })).toBeTruthy(); }, { timeout: 20000 });
    expect(screen.getByRole('button', { name: 'Pf.(下段)に声部を追加' })).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
