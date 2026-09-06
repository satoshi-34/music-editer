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
import { MAX_VOICES_PER_LAYER } from '../utils/editorLayers';
import { describeVoiceLimitReached } from '../utils/scoreEditorNotices';
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

function seedSingleWork(): string {
  const parts: PartData[] = [
    { partId: 'single', clef: 'treble', measures: [fullMeasure(), fullMeasure()] },
  ];
  const data = createSavedScoreData(
    { title: '声部レイヤーテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    'single'
  );
  const created = createWork('声部レイヤーテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
  return created.data.id;
}

/** jsdom は実レイアウトを持たないので、クリック座標計算のために svg の寸法を補う */
function mockSvgLayout(svg: SVGSVGElement) {
  const width = parseFloat(svg.getAttribute('width') ?? '0') || TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect);
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
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

function addVoiceButton(): HTMLButtonElement {
  const group = screen.getByRole('group', { name: '編集レイヤー切り替え' });
  const button = Array.from(group.querySelectorAll('button'))
    .find(b => b.textContent?.trim() === '＋');
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

describe('声部レイヤーの一般化の配線（#417）', () => {
  let workId = '';
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
    workId = seedSingleWork();
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('声部が 1 本のとき V を押すと、巡回せずに理由を通知する（round2 P3・#318）', async () => {
    render(<ScorePage />);
    await waitFor(() => { expect(document.querySelector('rect.vf-hit')).toBeTruthy(); }, { timeout: 20000 });
    expect(layerChipNames()).toEqual(['声部1']);
    fireEvent.keyDown(window, { key: 'v' });
    await waitFor(() => {
      expect(screen.queryByTestId('edit-notice')?.textContent).toContain('声部は1つだけです');
    }, { timeout: 15000 });
    expect(currentLayerName()).toBe('声部1');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('単旋律譜でも声部を足して切り替えられ、入力した音符が声部3へ入る', async () => {
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 20000 });

    // 1. 単旋律譜にもレイヤーチップが出る（手の名前は付かない＝声部だけ）
    expect(layerChipNames()).toEqual(['声部1']);
    expect(currentLayerName()).toBe('声部1');

    // 2. 「＋」で声部2が増え、そのまま編集対象になる
    fireEvent.click(addVoiceButton());
    await waitFor(() => expect(layerChipNames()).toEqual(['声部1', '声部2']));
    expect(currentLayerName()).toBe('声部2');

    // 3. V キーは巡回。足しただけで何も書いていない末尾の声部は、そこから離れると
    //    チップからも消える（#417 Codex round1 P1-1「末尾の空声部は自動で掃除される」）。
    //    音符が入っていれば消えないことは step 5 以降で確かめる
    fireEvent.keyDown(window, { key: 'v' });
    await waitFor(() => expect(currentLayerName()).toBe('声部1'));
    await waitFor(() => expect(layerChipNames()).toEqual(['声部1']));

    // 4. 上限（4声）まで足すと「＋」が押せなくなり、理由が title に出る
    fireEvent.click(addVoiceButton());
    await waitFor(() => expect(currentLayerName()).toBe('声部2'));
    fireEvent.click(addVoiceButton());
    await waitFor(() => expect(currentLayerName()).toBe('声部3'));
    fireEvent.click(addVoiceButton());
    await waitFor(() => expect(layerChipNames()).toHaveLength(MAX_VOICES_PER_LAYER));
    // disabled にはしない（Codex round1 P2-7）。disabled だとクリックもフォーカスも
    // 受け付けず、上限の理由を伝える経路が無くなるため、aria-disabled + 通知にしてある
    expect(addVoiceButton()).not.toBeDisabled();
    expect(addVoiceButton().getAttribute('aria-disabled')).toBe('true');
    expect(addVoiceButton().getAttribute('title')).toBe(describeVoiceLimitReached(MAX_VOICES_PER_LAYER));
    // 押しても声部は増えず、理由が通知として出る（行き止まりが喋る・#318）
    fireEvent.click(addVoiceButton());
    await waitFor(() => expect(layerChipNames()).toHaveLength(MAX_VOICES_PER_LAYER));

    // 5. 声部3へ戻して音符を入れると、保存データの voices[2] に入る
    //    （activeVoice が SingleStaff → PianoSystemCanvas まで配線されている証拠）
    const voice3Chip = Array.from(
      screen.getByRole('group', { name: '編集レイヤー切り替え' }).querySelectorAll('button')
    ).find(b => b.textContent?.trim() === '声部3');
    expect(voice3Chip).toBeTruthy();
    // ツールチップで V キーの巡回を案内している（手の名前が付かない譜種の文言）
    expect(voice3Chip!.getAttribute('title')).toBe('声部3を編集レイヤーにする（V で声部を順に切替）');
    fireEvent.click(voice3Chip!);
    await waitFor(() => expect(currentLayerName()).toBe('声部3'));

    // 画面には（アイコン等の）別の svg も居るので、小節背景を持つ譜面の svg を選ぶ
    const background = document.querySelector('rect.vf-hit') as SVGRectElement | null;
    expect(background).toBeTruthy();
    mockSvgLayout(background!.closest('svg') as SVGSVGElement);
    const bgY = parseFloat(background!.getAttribute('y')!);
    const bgH = parseFloat(background!.getAttribute('height')!);
    // 1拍目（小節の左端寄り）をクリックして4分音符を1つ入れる
    fireEvent.click(background!, {
      clientX: parseFloat(background!.getAttribute('x')!) + 6,
      clientY: bgY + bgH / 2,
    });

    await waitFor(() => {
      const measures = loadWorkAutosaveData(workId).data?.parts?.[0]?.measures ?? [];
      const voice3 = measures[0]?.voices?.[2]?.events ?? [];
      expect(voice3.some(ev => !ev.isRest)).toBe(true);
      // 声部1（正本 events）は無傷のまま
      expect(measures[0]?.events).toHaveLength(4);
    }, { timeout: 20000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
