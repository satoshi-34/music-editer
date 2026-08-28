// パート譜表示中の段割り（Issue #174 段A）の統合テスト。
// 受入条件（Issue #174 コメント 2026-08-22 の設計案）:
// 1. パート譜表示では選択パート単体の音符幅で段割りが再計算される
// 2. 総譜の「段ごとの小節数の上書き」はパート譜の段割りに影響しない
// 3. 総譜表示へ戻すと従来どおりの段割り・上書き適用に戻る
// レンダー手法は ScorePagePartSymbolsWiring.test.tsx と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
import { ensembleSecondStaffPartId } from '../utils/instrumentationPartUtils';
import type { InstrumentPartDefinition, MeasureData, PartData, SavedScoreData } from '../types/storage';

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

const MEASURE_COUNT = 6;

/** 全音符1つだけの小節（幅が細い） */
function sparseMeasure(): MeasureData {
  return { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] };
}

/** 4分音符3つ（4拍目が空き）の小節。editMeasure が空き拍へ音符を足すための形 */
function editableMeasure(): MeasureData {
  return {
    events: [
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
      { dur: '4', isRest: false, keys: ['b/4'] },
    ],
  };
}

/** 16分音符16個の小節（幅が広い） */
function denseMeasure(): MeasureData {
  return { events: Array.from({ length: 16 }, () => ({ dur: '16' as const, isRest: false, keys: ['g/4'] })) };
}

/**
 * 弦楽四重奏の作品を仕込む。Violin I はスカスカ・Violin II は密集で、
 * さらに総譜には「1段目は1小節だけ」の手動上書きを付けておく。
 */
function seedQuartetWork() {
  const clefs: PartData['clef'][] = ['treble', 'treble', 'alto', 'bass'];
  const parts: PartData[] = (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
    partId,
    clef: clefs[i],
    measures: Array.from({ length: MEASURE_COUNT }, (_, measureIndex) => (
      // 5小節目（editMeasure の対象）は4拍目が空きの形にして、クリックで音符を足せるようにする
      partId === 'violin-1' ? (measureIndex === 4 ? editableMeasure() : sparseMeasure())
        : partId === 'violin-2' ? denseMeasure()
        : { events: [] }
    )),
  }));
  const data = createSavedScoreData(
    { title: '段割りテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    8,
    'quartet'
  );
  data.systemMeasureOverrides = [{ startMeasure: 0, count: 1 }];
  seedWork(data, '段割りテスト');
}

/** 作品を1件仕込んで最後に開いた作品にする */
function seedWork(data: SavedScoreData, title: string) {
  const created = createWork(title);
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

function makeInstrumentPart(overrides: Partial<InstrumentPartDefinition> & { id: string }): InstrumentPartDefinition {
  return {
    name: overrides.id,
    abbreviation: overrides.id,
    family: 'woodwind',
    clef: 'treble',
    staffCount: 1,
    transposition: 'C',
    bracketGroup: 'woodwinds',
    order: 0,
    ...overrides,
  };
}

/**
 * 編成譜（フルート=密集・ハープ=大譜表でスカスカ）の作品を仕込む。
 * ハープの2段目は ensembleSecondStaffPartId の別 PartData として保存される
 */
function seedEnsembleWork() {
  const parts: PartData[] = [
    { partId: 'flute', clef: 'treble', measures: Array.from({ length: MEASURE_COUNT }, (_, measureIndex) => (measureIndex === 4 ? editableMeasure() : denseMeasure())) },
    { partId: 'harp', clef: 'treble', measures: Array.from({ length: MEASURE_COUNT }, sparseMeasure) },
    { partId: ensembleSecondStaffPartId('harp'), clef: 'bass', measures: Array.from({ length: MEASURE_COUNT }, sparseMeasure) },
  ];
  const data = createSavedScoreData(
    { title: '編成段割りテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    8,
    'ensemble',
    'C',
    [4, 4],
    {
      presetId: 'custom',
      name: 'テスト編成',
      parts: [
        makeInstrumentPart({ id: 'flute', name: 'Flute', abbreviation: 'Fl.' }),
        makeInstrumentPart({ id: 'harp', name: 'Harp', abbreviation: 'Hp.', staffCount: 2, bracketGroup: 'strings', order: 1 }),
      ],
    }
  );
  seedWork(data, '編成段割りテスト');
}

/** クリック座標計算のための svg レイアウトモック（jsdom は実レイアウトを持たない） */
function mockSvgLayout(svg: SVGSVGElement) {
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, right: 700, bottom: height, width: 700, height, x: 0, y: 0, toJSON: () => ({}),
  })) as unknown as typeof svg.getBoundingClientRect;
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: 700 } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/**
 * 指定した絶対小節（editableMeasure で仕込んだ、4拍目が空きの小節）の空き拍へ
 * 既定ツールの4分音符を1つ足して「最後に編集した小節」を作る（Issue #67 の
 * 安定化が効き始める条件）。既存音符の上をクリックしても編集にならないため、
 * PartScoreEditing.test.tsx と同じく「最後の音符のヒット領域は小節右端まで広がる」
 * 性質を使って右端＝空き拍を叩き、音符が実際に増えたことまで検証する
 */
async function editMeasure(measureIndex: number) {
  const hit = document.querySelector(`rect.vf-note-hit[data-measure="${measureIndex}"][data-note="2"]`) as SVGRectElement | null;
  expect(hit).toBeTruthy();
  const svg = hit!.closest('svg') as SVGSVGElement;
  mockSvgLayout(svg);
  const y = parseFloat(hit!.getAttribute('y')!) + parseFloat(hit!.getAttribute('height')!) / 2;
  fireEvent.click(hit!, {
    clientX: parseFloat(hit!.getAttribute('x')!) + parseFloat(hit!.getAttribute('width')!) - 3,
    clientY: y,
  });
  // 4拍目に音符が増えた（= lastEditedMeasureIndex が立った）ことを確認する
  await waitFor(() => {
    expect(document.querySelector(`rect.vf-note-hit[data-measure="${measureIndex}"][data-note="3"]`)).toBeTruthy();
  }, { timeout: 15000 });
}

/** 最初の内容段（音符ヒット領域を持つ最初の svg）に含まれる小節の絶対インデックス集合 */
function firstSystemMeasures(): Set<string> {
  const svgs = Array.from(document.querySelectorAll('svg'));
  const first = svgs.find((svg) => svg.querySelector('rect.vf-note-hit'));
  expect(first).toBeTruthy();
  const values = Array.from(first!.querySelectorAll('rect.vf-note-hit'))
    .map((rect) => rect.getAttribute('data-measure'))
    .filter((value): value is string => value !== null);
  return new Set(values);
}

async function selectPartView(optionIdIncludes: string | null) {
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  const select = await screen.findByLabelText('パート譜表示') as HTMLSelectElement;
  if (optionIdIncludes === null) {
    fireEvent.change(select, { target: { value: '' } });
    return;
  }
  const option = Array.from(select.options).find((o) => o.value.includes(optionIdIncludes));
  expect(option).toBeTruthy();
  fireEvent.change(select, { target: { value: option!.value } });
}

describe('パート譜表示中の段割り（Issue #174 段A）', () => {
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

  it('受入1〜3: パート単体の自動段割り・総譜上書きの不適用・総譜へ戻すと復元', async () => {
    seedQuartetWork();
    render(<ScorePage />);

    // 復元を待つ（パート譜表示セレクトは四重奏でだけ出る）
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await screen.findByLabelText('パート譜表示');

    // 総譜: 手動上書き（1段目=1小節）が効いている
    const scoreView = firstSystemMeasures();
    expect(scoreView).toEqual(new Set(['0']));

    // Violin I（スカスカ）のパート譜: 上書きは適用されず、パート単体の幅で
    // 1段に複数小節が入る（受入1・2）
    await selectPartView('violin-1');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBeGreaterThan(1);
    }, { timeout: 15000 });
    const violin1Measures = firstSystemMeasures().size;

    // Violin II（密集）のパート譜: 選択パート自身の幅で計画されるため、
    // スカスカな Violin I より1段の小節数が少ない（段割りが選択パートに依存する証拠）
    await selectPartView('violin-2');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBeLessThan(violin1Measures);
    }, { timeout: 15000 });

    // 総譜へ戻すと上書きが再び適用される（受入3: パート譜表示が総譜レイアウトを汚さない）
    await selectPartView(null);
    await waitFor(() => {
      expect(firstSystemMeasures()).toEqual(new Set(['0']));
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('総譜で後方小節を編集した直後でも、パート譜は前ビューの段割りを引き継がない', async () => {
    // Issue #67 の安定化は「最後に編集した小節より前の段」を前回の段割りに固定する。
    // 表示切替でヒントを捨てないと、総譜の細かい改行（ここでは上書きの1小節/段）が
    // パート譜の前方段に残ってしまう（Codex round1 P3 で指摘されたリセットの固定）
    seedQuartetWork();
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await screen.findByLabelText('パート譜表示');

    // 総譜のまま後方（5小節目）を編集して lastEditedMeasureIndex を立てる
    await editMeasure(4);

    // パート譜へ切り替えると、安定化ではなくパート単体の計画で最初の段が組まれる
    await selectPartView('violin-1');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBeGreaterThan(1);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('編成譜: 大譜表パートのパート譜も単体で組まれ、表示中パートの削除で総譜の計画へ戻る', async () => {
    // 表示中パートを編成編集で削除すると partExtractionId は変わらないまま
    // 選択だけが null（総譜復帰）になる。生の ID だけを監視していると
    // 安定化ヒントが残り、削除直前のパート譜の段割りが総譜に漏れる（Codex round1 P2）
    seedEnsembleWork();
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await screen.findByLabelText('パート譜表示');

    // 総譜: 密集したフルートに合わせた改行（全6小節は1段に入らない）
    const scoreViewSize = firstSystemMeasures().size;
    expect(scoreViewSize).toBeLessThan(MEASURE_COUNT);

    // 大譜表（ハープ）のパート譜: スカスカなので全小節が1段に入る（2段展開の計画が動く）
    await selectPartView('harp');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBe(MEASURE_COUNT);
    }, { timeout: 15000 });

    // 編集可能なフルートのパート譜へ移り、後方小節を編集して安定化の条件を作る
    // （フルートは密集しているので、パート譜でも全小節は1段に入らない）
    await selectPartView('flute');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBeLessThan(MEASURE_COUNT);
    }, { timeout: 15000 });
    await editMeasure(4);

    // 表示中のフルートを編成編集で削除する → 総譜（ハープのみ）へ復帰
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    fireEvent.click(screen.getByRole('button', { name: 'パート編集' }));
    const deleteButtons = await screen.findAllByRole('button', { name: '削除' });
    fireEvent.click(deleteButtons[0]);

    // ハープだけの総譜はスカスカ＝全小節が1段に入るのが正しい計画。
    // 削除前のフルートのパート譜（細かい改行）が安定化で残っていると小さいままになる
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBe(MEASURE_COUNT);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('パート譜表示中に同じパートIDを持つファイルを開くと総譜へ戻る（読込後は必ず総譜）', async () => {
    // ファイル読込は applyLoadedScoreData と別の反映処理を持つため、
    // パート譜表示のリセット漏れがあると「同じIDが有効なまま表示が継続」する
    // （Codex round2 P2。四重奏→四重奏はパートIDが常に同じなので必ず再現する）
    seedQuartetWork();
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    await screen.findByLabelText('パート譜表示');
    await selectPartView('violin-1');
    await waitFor(() => {
      expect(firstSystemMeasures().size).toBeGreaterThan(1);
    }, { timeout: 15000 });

    // 別の四重奏 .score.json（同じパートID構成）を「開く」経路で読み込む
    const clefs: PartData['clef'][] = ['treble', 'treble', 'alto', 'bass'];
    const imported = createSavedScoreData(
      { title: '読込テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
      (['violin-1', 'violin-2', 'viola', 'cello'] as const).map((partId, i) => ({
        partId,
        clef: clefs[i],
        measures: Array.from({ length: MEASURE_COUNT }, sparseMeasure),
      })),
      1,
      8,
      'quartet'
    );
    const file = new File([JSON.stringify(imported)], 'imported.score.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"][accept^=".json"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });

    // 読み込んだ譜面は総譜（4パート）で表示される
    await waitFor(() => {
      const select = screen.getByLabelText('パート譜表示') as HTMLSelectElement;
      expect(select.value).toBe('');
    }, { timeout: 15000 });
    expect(document.body.textContent).toContain('読込テスト');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
