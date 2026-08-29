// 「開く」ボタン群→隠しファイル入力の配線（#464）。
// Safari は display:none の file input へのプログラム .click() を無視することがあり、
// また拡張子のみの accept 指定を正しく解釈しないことがある（2026-08-28 実機で発生）。
// ScorePage 実マウントで「ボタンが対応する input の click を呼ぶ」
// 「display:none ではない」「a11y 上は隠れている」「accept に MIME 併記」を固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, within } from '@testing-library/react';
import ScorePage from './ScorePage';

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

describe('開くボタン群と隠しファイル入力の配線（#464）', () => {
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

  it('ボタンが対応する input の click を呼び、input は Safari 互換の隠し方になっている', async () => {
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));

    const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    expect(inputs.length).toBe(2);
    const jsonInput = inputs.find((i) => (i.getAttribute('accept') ?? '').includes('.json'))!;
    const xmlInput = inputs.find((i) => (i.getAttribute('accept') ?? '').includes('.musicxml'))!;
    expect(jsonInput).toBeTruthy();
    expect(xmlInput).toBeTruthy();

    for (const input of [jsonInput, xmlInput]) {
      // Safari 互換: display:none にしない（プログラム click が無視される）
      expect(getComputedStyle(input).display).not.toBe('none');
      // フォーカス順・読み上げからは除外する（見えないタブストップを作らない）
      expect(input.tabIndex).toBe(-1);
      expect(input.getAttribute('aria-hidden')).toBe('true');
    }
    // accept は拡張子だけでなく MIME も併記（Safari の拡張子のみ指定の解釈ゆらぎ対策）
    expect(jsonInput.getAttribute('accept')).toContain('application/json');
    expect(xmlInput.getAttribute('accept')).toContain('application/vnd.recordare.musicxml+xml');

    // ボタンクリック → 対応する input の click が呼ばれる（#464 続報:
    // Safari は select の change をファイルダイアログを開けるユーザー操作と
    // 認めないため、「開く」は select ではなくボタン群で提供する）
    const jsonClick = vi.spyOn(jsonInput, 'click');
    const xmlClick = vi.spyOn(xmlInput, 'click');
    const openGroup = screen.getByRole('group', { name: '開く' });
    fireEvent.click(within(openGroup).getByRole('button', { name: 'ファイル' }));
    expect(jsonClick).toHaveBeenCalledTimes(1);
    const xmlButton = within(openGroup).getByRole('button', { name: 'MusicXML (.mxl)' });
    fireEvent.click(xmlButton);
    expect(xmlClick).toHaveBeenCalledTimes(1);
    // title 属性で対応形式（.musicxml / .xml / .mxl）の説明が維持されること（#467 続報）
    const xmlButtonTitle = xmlButton.getAttribute('title') ?? '';
    expect(xmlButtonTitle).toContain('.musicxml');
    expect(xmlButtonTitle).toContain('.xml');
    expect(xmlButtonTitle).toContain('.mxl');
    // 「開く」が select として存在しない（Safari で無反応になる形へ戻さない）
    expect(screen.queryByRole('combobox', { name: '開く' })).toBeNull();
  }, 60000);

  it('旧・手動保存がある環境では「以前の手動保存」ボタンが出て、取り込みが動く', async () => {
    // 検出力の要（Codex round2 P2）: 起動時の自動移行が旧保存を復元してしまうと、
    // ボタンを押さなくても曲名が出て試験が素通りする。**別タイトルの現行作品**を
    // 先に用意して自動移行を経路から外し、「クリック前=現行作品／クリック後=旧保存の曲」
    // の切り替わりで onClick の配線そのものを検証する
    const { saveScoreData, createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } = await import('../utils/storage');
    const currentEvents = [
      { dur: '1' as const, isRest: false, keys: ['g/4'] },
    ];
    const currentWork = createSavedScoreData(
      { title: '現行の作品', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events: currentEvents, voices: [{ id: 'voice-1', events: currentEvents }] }] }],
      1, 1, 'single'
    );
    const created = createWork('現行の作品');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, currentWork);
    setLastOpenedWorkId(created.data.id);
    const events = [
      { dur: '4' as const, isRest: false, keys: ['c/5'] },
      { dur: '4' as const, isRest: false, keys: ['d/5'] },
      { dur: '4' as const, isRest: false, keys: ['e/5'] },
      { dur: '4' as const, isRest: false, keys: ['f/5'] },
    ];
    const legacy = createSavedScoreData(
      { title: '旧保存の曲', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'melody', clef: 'treble', measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
      1, 1, 'single'
    );
    expect(saveScoreData(legacy).success).toBe(true);

    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-hit')).toBeTruthy();
    }, { timeout: 15000 });
    // クリック前は現行作品が開いており、旧保存の曲名はまだ画面に無い
    expect(document.body.textContent).toContain('現行の作品');
    expect(document.body.textContent).not.toContain('旧保存の曲');

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    const openGroup = screen.getByRole('group', { name: '開く' });
    const legacyButton = within(openGroup).getByRole('button', { name: '以前の手動保存' });
    fireEvent.click(legacyButton);
    // クリック後に旧保存の曲へ切り替わり、取り込み完了の通知が出る
    await waitFor(() => {
      expect(document.body.textContent).toContain('旧保存の曲');
      expect(document.body.textContent).toContain('以前の手動保存を新しい作品として取り込みました');
    }, { timeout: 15000 });
  }, 60000);
});
