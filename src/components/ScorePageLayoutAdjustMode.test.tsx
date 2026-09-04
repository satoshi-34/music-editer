// レイアウトタブを「整えるモード」にする（Issue #571）の実マウント配線テスト。
//
// 受入条件（Issue #571 本文＋運用者裁定コメント）:
// 1. レイアウトタブを開くと、選択なしで段2以降の上端バンドが見える
// 2. その状態でバンドをドラッグすると段の選択→調整が1操作でできる（掴んだ段が選択される）
// 3. 音符・休符タブへ戻るとバンドが消える
// 4. 選択なしでも「段を選べば小節数・間隔を調整できる」ことが分かる
//    （五線の面が段の選択になり、そこから ◀▶ のパネルへ到達できる）
// 5. 当たり判定は3層: 帯＝間隔 / 面＝段の選択 / 角＝音符の大きさ（全体）
// 6. 角ハンドルは「この段だけ」と誤解させない（吹き出しに「（全体）」・スライダーと値が同期）
//
// レンダー手法は ScorePageSystemGapDrag.test.tsx と同じ直接マウント + autosave シード。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData,
  createWork,
  saveWorkAutosaveData,
  setLastOpenedWorkId,
} from '../utils/storage';
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

// ScorePage の全体マウントは重いので、他の ScorePage 統合テストと同じく個別に延長する
const MOUNT_HEAVY_TIMEOUT_MS = 60000;
const MEASURE_COUNT = 8;

/** 全音符1つだけの小節（幅が細く、段あたり小節数の自動計画が安定する） */
function sparseMeasure(): MeasureData {
  return { events: [{ dur: '1', isRest: false, keys: ['c/5'] }] };
}

function seedWork(measureCount: number = MEASURE_COUNT) {
  const parts: PartData[] = [
    { partId: 'melody', clef: 'treble' as const, measures: Array.from({ length: measureCount }, sparseMeasure) },
  ];
  const data = createSavedScoreData(
    { title: '整えるモードテスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    parts,
    1,
    2,
    'single'
  );
  const created = createWork('整えるモードテスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  const saved = saveWorkAutosaveData(created.data.id, data);
  if (!saved.success) throw new Error('saveWorkAutosaveData failed');
  setLastOpenedWorkId(created.data.id);
}

async function renderScore(measureCount: number = MEASURE_COUNT) {
  seedWork(measureCount);
  render(<ScorePage />);
  await waitFor(() => {
    expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
  }, { timeout: 15000 });
}

/** ツールバーのタブを切り替える（表示名は TOOLBAR_TAB_BUTTONS の正本） */
function openTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

/** 画面に出ている段（選択できるもの）の先頭小節を、上から順に並べて返す */
function systemStartMeasures(): number[] {
  return Array.from(document.querySelectorAll('[data-testid^="system-frame-"]'))
    .map((el) => Number((el as HTMLElement).dataset.testid!.replace('system-frame-', '')));
}

/** 段のラッパーに実際に効いている marginTop（＝段の間隔の反映結果） */
function frameMarginTop(startMeasure: number): string {
  return (screen.getByTestId(`system-frame-${startMeasure}`) as HTMLElement).style.marginTop;
}

/** 「音符の大きさ」スライダーのいまの値（%） */
function notationSizePercent(): number {
  return Number((screen.getByLabelText('音符の大きさ') as HTMLInputElement).value);
}

/** その先頭小節で始まる段が、いま何ページ目に描かれているか（0始まり・無ければ -1） */
function pageIndexOfSystem(startMeasure: number): number {
  return Array.from(document.querySelectorAll('.print-page'))
    .findIndex((page) => page.querySelector(`[data-testid="system-frame-${startMeasure}"]`) !== null);
}

/** 主ポインタの左ボタンで掴む（#536 の規約どおり isPrimary / button / pointerId をそろえる） */
function grab(handle: HTMLElement, clientX: number, clientY: number, pointerId: number = 1) {
  // pointerId を変えられるのは「2本目のポインタ」を作るため（round2 P2-1 のテスト）。
  // タッチとマウスのように種類が違うポインタは、どちらも isPrimary=true で同時に成立する
  fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId, pointerType: 'mouse', clientX, clientY });
}

describe('ScorePage: レイアウトタブ＝整えるモード（Issue #571）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    // jsdom は実レイアウトを持たないので、譜面の幅（小節幅の配分に使う）を固定する。
    // 高さ（offsetHeight）は 0 のままで、ドラッグ側は「実測できない＝等倍」として扱う
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('音符・休符タブでは掴みしろが出ない（譜面を書いている間の見た目は変えない）', async () => {
    await renderScore();
    expect(document.querySelector('.system-gap-drag-handle')).toBeNull();
    expect(document.querySelector('.system-select-surface')).toBeNull();
    expect(document.querySelector('.score-area.layout-adjust-mode')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('レイアウトタブを開くと、選択なしで段2以降の上端バンドが出る（受入1）', async () => {
    await renderScore();
    openTab('レイアウト');

    const starts = systemStartMeasures();
    expect(starts.length).toBeGreaterThan(1);
    await waitFor(() => {
      // 2段目以降には帯が出る（どの段も選択していない状態のまま）
      expect(screen.getByTestId(`system-gap-drag-${starts[1]}`)).toBeTruthy();
    });
    // ページの先頭の段には出ない（上に動かせる境界が無いため・#523 round1 P1 の維持）
    expect(screen.queryByTestId(`system-gap-drag-${starts[0]}`)).toBeNull();
    // 選択そのものは起きていない（パネルはまだ出ない）
    expect(document.querySelector('[data-testid^="system-layout-panel-"]')).toBeNull();
    // CSS が掴みしろを薄く見せる先（.layout-adjust-mode）も付いている
    expect(document.querySelector('.score-area.layout-adjust-mode')).toBeTruthy();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('音符・休符タブへ戻るとバンドが消える（受入3）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    await waitFor(() => {
      expect(screen.getByTestId(`system-gap-drag-${starts[1]}`)).toBeTruthy();
    });

    openTab('音符・休符');
    await waitFor(() => {
      expect(document.querySelector('.system-gap-drag-handle')).toBeNull();
    });
    expect(document.querySelector('.system-select-surface')).toBeNull();
    expect(document.querySelector('.score-area.layout-adjust-mode')).toBeNull();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('選択していない段のバンドを掴むと、その段が選ばれてそのまま間隔が変わる（受入2）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    const target = starts[1];
    const handle = await screen.findByTestId(`system-gap-drag-${target}`);

    // 掴んだ瞬間に段が選ばれる（＝小節数 ◀▶ のパネルもその場で出る）
    grab(handle as HTMLElement, 300, 200);
    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${target}`)).toBeTruthy();
    });

    // 掴んだまま下へ引くと、その境界＝この段の間隔が動く（選択のやり直しは要らない）
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 220 });
    await waitFor(() => {
      expect(frameMarginTop(target)).toBe('20px');
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 220 });
    expect(frameMarginTop(target)).toBe('20px');
    // パネルの数値も同じ state を見ている
    expect(screen.getByTestId(`system-gap-value-${target}`).textContent).toBe('+20px');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('五線の面をクリックすると段が選ばれ、小節数（◀▶）のパネルへ到達できる（受入4）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    const target = starts[0];

    const surface = await screen.findByTestId(`system-select-surface-${target}`);
    // 「何ができるのか」はホバーのヒントで伝える（行き止まりを黙って作らない）
    expect(surface.getAttribute('title')).toContain('小節数');
    fireEvent.click(surface);

    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${target}`)).toBeTruthy();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('選択中の段の右下角を斜めに引くと譜面全体の音符の大きさが変わり、Undo 1回で戻る（受入5・6）', async () => {
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    const target = starts[0];
    const before = notationSizePercent();

    // 角ハンドルは選択中の段にだけ出る（選択前は出ない）
    expect(screen.queryByTestId(`notation-size-drag-${target}`)).toBeNull();
    fireEvent.click(await screen.findByTestId(`system-select-surface-${target}`));
    const corner = await screen.findByTestId(`notation-size-drag-${target}`);

    // 外（右下）へ 50px + 50px 引くと +20%（(50+50)/2 × 0.4）
    grab(corner as HTMLElement, 400, 300);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 450, clientY: 350 });
    await waitFor(() => {
      expect(notationSizePercent()).toBe(before + 20);
    });
    // 吹き出しは「（全体）」を必ず出す（この段だけと誤解させないため・運用者裁定）。
    // 置き場所は◢の中ではなく画面（ScorePage が1つだけ出す）。◢は段割りの変化で
    // 消えることがあり、中に置くといちばん値が動いている最中に見えなくなるため
    const hint = screen.getByTestId('notation-size-drag-value');
    expect(hint.textContent).toBe(`音符の大きさ（全体）: ${before + 20}%`);

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 450, clientY: 350 });
    expect(notationSizePercent()).toBe(before + 20);
    expect(screen.queryByTestId('notation-size-drag-value')).toBeNull();

    // Undo はドラッグ全体で1件（#523 の規約に準拠）
    fireEvent.click(screen.getByTitle(/元に戻す/));
    await waitFor(() => {
      expect(notationSizePercent()).toBe(before);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('スライダーで変えた音符の大きさも Undo 1回で戻る（角ハンドルと同じ1操作＝1件）', async () => {
    // 大きさは Undo/Redo のスナップショットに入っているので、スライダー側でも
    // 操作ごとに履歴を積む必要がある。積まないと、スライダーで変えた値が
    // 無関係な Undo で古い値へ戻ってしまう（Issue #571）
    await renderScore();
    openTab('レイアウト');
    const slider = screen.getByLabelText('音符の大きさ') as HTMLInputElement;
    const before = notationSizePercent();

    fireEvent.pointerDown(slider, { button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.change(slider, { target: { value: String(before + 10) } });
    fireEvent.change(slider, { target: { value: String(before + 20) } });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    expect(notationSizePercent()).toBe(before + 20);

    // つまみを動かし続けた1回ぶんは履歴1件（何段階動かしても1回で戻る）
    fireEvent.click(screen.getByTitle(/元に戻す/));
    await waitFor(() => {
      expect(notationSizePercent()).toBe(before);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('角を引いて段がページをまたいでも、値が跳ね戻らない（round1 P1）', async () => {
    // 音符の大きさを変えると段割り・ページ割りが計算し直され、掴んでいた段が
    // 別のページの子へ移る。React から見ると親が変わる＝いったんアンマウントなので、
    // ドラッグの状態を◢側に持たせていた初版では、そこで「ドラッグ中止」と解釈されて
    // 値が掴む前へ跳ね戻り、積んだ Undo 履歴まで取り消されていた。
    // いまはドラッグの主が ScorePage 側に1つだけあるので、◢の出入りに左右されない。
    await renderScore(16);
    openTab('レイアウト');
    const starts = systemStartMeasures();
    // 1ページ目の最後のほうの段を掴む（大きくすると後ろのページへ押し出される段）
    const target = starts[4];
    const pageBefore = pageIndexOfSystem(target);
    expect(pageBefore).toBe(0);
    const before = notationSizePercent();

    fireEvent.click(await screen.findByTestId(`system-select-surface-${target}`));
    const corner = await screen.findByTestId(`notation-size-drag-${target}`);

    // 外へ 250px + 250px = +100%（上限 200% でクランプされる）
    grab(corner as HTMLElement, 400, 300);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 650, clientY: 550 });

    // 掴んだ段が別のページへ移った（＝◢の要素はいったん消えて描き直された）
    await waitFor(() => {
      expect(pageIndexOfSystem(target)).toBeGreaterThan(pageBefore);
    });
    // それでも値は引いたところに留まっている（初版はここで before へ戻っていた）
    expect(notationSizePercent()).toBe(200);

    // 離すまで引き続けられる（◢が描き直されたあとの pointermove も効く）。
    // 少し戻す向きに動かすと、上限に張り付いたままではなく値が追従する
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 500, clientY: 400 });
    await waitFor(() => {
      expect(notationSizePercent()).toBeLessThan(200);
    });
    expect(notationSizePercent()).toBeGreaterThan(before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 500, clientY: 400 });

    // 離したあとも確定値のまま（スナップバックしない）
    const settled = notationSizePercent();
    expect(settled).toBeGreaterThan(before);
    await waitFor(() => {
      expect(notationSizePercent()).toBe(settled);
    });

    // 履歴も取り消されていない。ドラッグ全体で1件なので「元に戻す」1回で掴む前へ戻る
    fireEvent.click(screen.getByTitle(/元に戻す/));
    await waitFor(() => {
      expect(notationSizePercent()).toBe(before);
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('段を選んだまま音符・休符タブへ戻ると角ハンドルも消える（round1 P2）', async () => {
    // 「他のタブでは譜面を書いている間の見た目を変えない」という約束は◢にも及ぶ。
    // 初版は表示条件が「選択中の段」だけだったので、選択を残したままタブを戻すと
    // ◢だけが譜面に残っていた。
    await renderScore();
    openTab('レイアウト');
    const target = systemStartMeasures()[0];
    fireEvent.click(await screen.findByTestId(`system-select-surface-${target}`));
    expect(await screen.findByTestId(`notation-size-drag-${target}`)).toBeTruthy();

    openTab('音符・休符');
    await waitFor(() => {
      expect(document.querySelector('.notation-size-drag-handle')).toBeNull();
    });
    // 選択そのものは残っていてよい（パネルは従来どおり選択中の段に出る）。
    // 消すのは整えるモード用の掴みしろだけ
    expect(document.querySelector('.system-select-surface')).toBeNull();

    // レイアウトタブへ戻せばまた出る（消しっぱなしにはしない）
    openTab('レイアウト');
    await waitFor(() => {
      expect(document.querySelector('.notation-size-drag-handle')).toBeTruthy();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('角ハンドルを掴んだだけ（動かさずに離す）では履歴も値も変わらない', async () => {
    await renderScore();
    openTab('レイアウト');
    const target = systemStartMeasures()[0];
    const before = notationSizePercent();
    fireEvent.click(await screen.findByTestId(`system-select-surface-${target}`));
    const corner = await screen.findByTestId(`notation-size-drag-${target}`);

    grab(corner as HTMLElement, 400, 300);
    // 遊び（3px）の中しか動かさない
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 401, clientY: 301 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 401, clientY: 301 });

    expect(notationSizePercent()).toBe(before);
    // 「元に戻す」が空振りしない（＝履歴が1件も増えていない）ことは、
    // ボタンが無効のままであることで確かめる
    expect((screen.getByTitle(/元に戻す/) as HTMLButtonElement).disabled).toBe(true);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('ドラッグ中は2本目のポインタが別の掴みしろを掴めない（round2 P2-1）', async () => {
    // Undo の退避先（layoutDragHistoryRef）は1つしか無いので、2つのドラッグが同時に
    // 走ると後発が退避を上書きし、片方の確定後にもう片方が中止されると確定済みの履歴まで
    // 巻き戻る。共有ロックで2本目を掴ませない（先着優先）ことで、その競合ごと防ぐ。
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    expect(starts.length).toBeGreaterThan(2);
    const first = starts[1];
    const second = starts[2];
    const firstHandle = await screen.findByTestId(`system-gap-drag-${first}`);
    const secondHandle = await screen.findByTestId(`system-gap-drag-${second}`);

    // 1本目が段2の帯を掴む（掴んだ段が選ばれる）
    grab(firstHandle as HTMLElement, 300, 200, 1);
    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${first}`)).toBeTruthy();
    });

    // 2本目が別の段の帯を掴もうとしても掴めない。掴めていれば onGrab で
    // 段の選択が移るはずなので、選択が1本目の段のままであることで確かめる
    grab(secondHandle as HTMLElement, 300, 400, 2);
    expect(screen.queryByTestId(`system-layout-panel-${second}`)).toBeNull();
    expect(screen.getByTestId(`system-layout-panel-${first}`)).toBeTruthy();

    // 2本目を動かしても、その段の間隔は変わらない（セッションが成立していない）
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 300, clientY: 460 });
    expect(frameMarginTop(second)).toBe('');

    // 1本目は最後まで引き続けられる（2本目に邪魔されない）
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 220 });
    await waitFor(() => {
      expect(frameMarginTop(first)).toBe('20px');
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 220 });

    // 離せばロックは外れる。次のドラッグは普通に掴める（掴めなくなったら退行）
    grab(secondHandle as HTMLElement, 300, 400, 3);
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 300, clientY: 430 });
    await waitFor(() => {
      expect(frameMarginTop(second)).toBe('30px');
    });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 300, clientY: 430 });
    // 1本目の確定ぶんも残っている（後発のドラッグに巻き込まれて消えない）
    expect(frameMarginTop(first)).toBe('20px');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('非先頭段を選んだまま音符・休符タブへ戻すと境界帯も消える（round2 P2-2）', async () => {
    // 「音符・休符タブでは帯も面も無い」（REGRESSION Z）は、段を選んでいる場合にも及ぶ。
    // 帯の表示条件に整えるモードが入っていなかったため、ページの先頭ではない段
    // （＝上に境界がある段）を選んだままタブを戻すと帯だけが譜面に残っていた。
    await renderScore();
    openTab('レイアウト');
    const starts = systemStartMeasures();
    const target = starts[1];

    // ページの先頭ではない段を選ぶ（この段には上端の境界帯が出る）
    fireEvent.click(await screen.findByTestId(`system-select-surface-${target}`));
    await waitFor(() => {
      expect(screen.getByTestId(`system-layout-panel-${target}`)).toBeTruthy();
    });
    expect(screen.getByTestId(`system-gap-drag-${target}`)).toBeTruthy();

    openTab('音符・休符');
    await waitFor(() => {
      expect(screen.queryByTestId(`system-gap-drag-${target}`)).toBeNull();
    });
    // 帯・面・◢ のどれも残らない
    expect(document.querySelector('.system-gap-drag-handle')).toBeNull();
    expect(document.querySelector('.system-select-surface')).toBeNull();
    expect(document.querySelector('.notation-size-drag-handle')).toBeNull();
    // 選択そのものとパネルは従来どおり残ってよい
    expect(screen.getByTestId(`system-layout-panel-${target}`)).toBeTruthy();

    // レイアウトタブへ戻せば帯もまた出る（消しっぱなしにはしない）
    openTab('レイアウト');
    await waitFor(() => {
      expect(screen.getByTestId(`system-gap-drag-${target}`)).toBeTruthy();
    });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
