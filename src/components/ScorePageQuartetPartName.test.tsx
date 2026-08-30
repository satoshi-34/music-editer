// src/components/ScorePageQuartetPartName.test.tsx
// Issue #448: 楽器名・略称をユーザーが編集できるようにする。
//
// 編成譜（ensemble）は以前から「パート編集」で名前を書き換えられたが、
// 弦楽四重奏は QuartetStaff の既定名（QUARTET_PART_CONFIGS）固定だった。
// 「パート名編集」で書き換えた名前が、五線左の表示とパート譜表示の選択肢に
// 実際に反映されることを、ScorePage の実マウントで確かめる。
// レンダー手法は ScorePageVioloncelloName.test.tsx と同じ。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import ScorePage from './ScorePage';
import { waitFor } from '@testing-library/react';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import { scoreToMusicXml } from '../utils/musicXmlExport';
import { getDefaultInstrumentationForScoreType } from '../data/instrumentationPresets';

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

/** 譜面SVGに描かれているパート名（text 要素）をすべて集める */
function renderedLabels(): string[] {
  return Array.from(document.querySelectorAll('.system-stack svg text'))
    .map((el) => el.textContent ?? '')
    .filter(Boolean);
}

function openQuartetScore() {
  render(<ScorePage />);
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
  fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));
}

function openPartNameEditor(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'パート名編集' }));
  return screen.getByRole('dialog', { name: 'パート名編集' });
}

describe('弦楽四重奏の楽器名・略称を編集する（Issue #448）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('正式名を書き換えると、1段目のパート名表示がその名前になる', () => {
    openQuartetScore();
    expect(renderedLabels()).toContain('Violin I');

    const dialog = openPartNameEditor();
    const nameInput = within(dialog).getByRole('textbox', { name: 'Violin Iのパート名' });
    fireEvent.change(nameInput, { target: { value: 'Violino primo' } });

    const labels = renderedLabels();
    expect(labels).toContain('Violino primo');
    expect(labels).not.toContain('Violin I');
    // 書き換えていないパートは既定名のまま
    expect(labels).toContain('Viola');
  }, 30000);

  it('名前を書き換えても譜種は弦楽四重奏のまま（カスタム編成に化けない）', () => {
    openQuartetScore();
    const dialog = openPartNameEditor();
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Violin Iのパート名' }),
      { target: { value: 'Violino primo' } },
    );

    // 名前はパート構成を変えないので、編成テンプレートも譜種も動かないこと
    // （パート追加・削除と同じ更新経路を通すと「カスタム編成の編成譜」へ切り替わってしまう）
    const presetSelect = screen.getByRole('combobox', { name: '編成テンプレート' }) as HTMLSelectElement;
    expect(presetSelect.value).toBe('string-quartet');
    expect(screen.getByRole('button', { name: 'パート名編集' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'パート編集' })).toBeNull();
  }, 30000);

  it('パート名編集では段構成を変える操作（追加・削除・音部記号）を出さない', () => {
    openQuartetScore();
    const dialog = openPartNameEditor();

    // 4段固定のレイアウトなので、パートの増減や音部記号の変更は受け付けない
    expect(within(dialog).queryByRole('button', { name: '追加' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: '削除' })).toBeNull();
    expect(within(dialog).queryByRole('combobox', { name: 'Violin Iの音部記号' })).toBeNull();
    // 編集できるのは正式名と略称の2つだけ（4パート×2＝8個の入力欄）
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(8);
    expect(within(dialog).getByRole('textbox', { name: 'Violin Iの略称' })).toBeInTheDocument();
  }, 30000);

  it('書き換えた正式名は、パート譜表示の選択肢にも反映される', () => {
    openQuartetScore();
    const dialog = openPartNameEditor();
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Violoncelloのパート名' }),
      { target: { value: 'チェロ' } },
    );

    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    const partSelect = Array.from(document.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'チェロ'));
    expect(partSelect, 'パート譜セレクトに書き換え後の名前が並ぶ').toBeTruthy();
  }, 30000);

  it('編成譜では従来どおり「パート編集」（段構成も編集できる）のまま', () => {
    render(<ScorePage />);
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));

    fireEvent.click(screen.getByRole('button', { name: 'パート編集' }));
    const dialog = screen.getByRole('dialog', { name: '編成パート編集' });
    expect(within(dialog).getByRole('button', { name: '追加' })).toBeInTheDocument();
  }, 30000);

  // Codex round1: 保存・復元の配線（規約の createWork → saveWorkAutosaveData 型）
  it('保存作品に入っている編集済みパート名が、復元後の表示とパート譜選択肢に出る', async () => {
    const events = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
    const mk = () => ({ events, voices: [{ id: 'voice-1', events }] });
    const inst = getDefaultInstrumentationForScoreType('quartet');
    const customInst = {
      ...inst,
      parts: inst.parts.map((part) => part.id === 'violin-1'
        ? { ...part, name: 'Violino primo', abbreviation: 'V.p.' }
        : part),
    };
    const data = createSavedScoreData(
      { title: '保存名復元', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'violin-1', clef: 'treble' as const, measures: [mk()] },
        { partId: 'violin-2', clef: 'treble' as const, measures: [mk()] },
        { partId: 'viola', clef: 'alto' as const, measures: [mk()] },
        { partId: 'cello', clef: 'bass' as const, measures: [mk()] },
      ],
      1, 1, 'quartet', 'C', [4, 4], customInst as never
    );
    const created = createWork('保存名復元');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    await waitFor(() => {
      expect(renderedLabels()).toContain('Violino primo');
    }, { timeout: 15000 });
    // パート譜選択肢にも同じ名前（総譜と選択肢の一致）
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    const partSelect = Array.from(document.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'Violino primo'));
    expect(partSelect, 'パート譜セレクトに編集名').toBeTruthy();
  }, 60000);

  // Codex round3 P2: 旧既定の略称（Vln. I 等）で保存された未編集作品は、
  // 復元時に新既定（Vn. I 等）へ移行され、旧表記が画面に出ない
  it('旧既定の略称で保存された作品を開くと、新既定の略称（Vn. I）で表示される', async () => {
    const events = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
    const mk = () => ({ events, voices: [{ id: 'voice-1', events }] });
    const inst = getDefaultInstrumentationForScoreType('quartet');
    const legacyInst = {
      ...inst,
      parts: inst.parts.map((part) =>
        part.id === 'violin-1' ? { ...part, abbreviation: 'Vln. I' }
        : part.id === 'violin-2' ? { ...part, abbreviation: 'Vln. II' }
        : part.id === 'viola' ? { ...part, abbreviation: 'Vla.' }
        : part),
    };
    const data = createSavedScoreData(
      { title: '旧略称移行', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'violin-1', clef: 'treble' as const, measures: [mk(), mk()] },
        { partId: 'violin-2', clef: 'treble' as const, measures: [mk(), mk()] },
        { partId: 'viola', clef: 'alto' as const, measures: [mk(), mk()] },
        { partId: 'cello', clef: 'bass' as const, measures: [mk(), mk()] },
      ],
      2, 1, 'quartet', 'C', [4, 4], legacyInst as never
    );
    // 旧バージョン（3.5.0）で保存されたデータを再現する。3.6.0 以降のデータは
    // 「ユーザーが意図して旧表記へ編集した」とみなして移行しない（round4）
    (data as { version: string }).version = '3.5.0';
    const created = createWork('旧略称移行');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    await waitFor(() => {
      expect(renderedLabels()).toContain('Violin I');
    }, { timeout: 15000 });
    // 復元された編成の略称が移行済みであることを、パート名編集ダイアログの実値で確かめる
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    const dialog = openPartNameEditor();
    expect((within(dialog).getByRole('textbox', { name: 'Violin Iの略称' }) as HTMLInputElement).value).toBe('Vn. I');
    expect((within(dialog).getByRole('textbox', { name: 'Violaの略称' }) as HTMLInputElement).value).toBe('Va.');
  }, 60000);

  // round4 の負のテスト: 現行バージョン（3.6.0）で保存された Vln. I は
  // ユーザーの意図的な編集値なので、再読込しても移行されない
  it('現行版で Vln. I へ編集して保存した略称は、開き直しても保持される', async () => {
    const events = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
    const mk = () => ({ events, voices: [{ id: 'voice-1', events }] });
    const inst = getDefaultInstrumentationForScoreType('quartet');
    const editedInst = {
      ...inst,
      parts: inst.parts.map((part) =>
        part.id === 'violin-1' ? { ...part, abbreviation: 'Vln. I' } : part),
    };
    const data = createSavedScoreData(
      { title: '編集値保持', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        { partId: 'violin-1', clef: 'treble' as const, measures: [mk()] },
        { partId: 'violin-2', clef: 'treble' as const, measures: [mk()] },
        { partId: 'viola', clef: 'alto' as const, measures: [mk()] },
        { partId: 'cello', clef: 'bass' as const, measures: [mk()] },
      ],
      1, 1, 'quartet', 'C', [4, 4], editedInst as never
    );
    const created = createWork('編集値保持');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    await waitFor(() => {
      expect(renderedLabels()).toContain('Violin I');
    }, { timeout: 15000 });
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    const dialog = openPartNameEditor();
    expect((within(dialog).getByRole('textbox', { name: 'Violin Iの略称' }) as HTMLInputElement).value).toBe('Vln. I');
  }, 60000);

  // Codex round1 P1: 名前だけ編集した空の四重奏も自動保存される
  it('音符が空でも、パート名の編集は自動保存に残る', async () => {
    openQuartetScore();
    const dialog = openPartNameEditor();
    const nameInput = within(dialog).getByRole('textbox', { name: 'Violin Iのパート名' });
    fireEvent.change(nameInput, { target: { value: '第1ヴァイオリン' } });

    // 自動保存（1.5秒デバウンス）を待って localStorage の実体を確認する
    await waitFor(() => {
      const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)!);
      const workKey = keys.find((k) => k.includes('work') && k.includes('autosave'));
      expect(workKey).toBeTruthy();
    }, { timeout: 15000 });
    const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)!);
    const found = keys.some((k) => (window.localStorage.getItem(k) ?? '').includes('第1ヴァイオリン'));
    expect(found).toBe(true);
  }, 60000);

  // Codex round1 P1 → round2 P1: 編集した名前が MusicXML 書き出しへ渡る。
  // 完成済みデータを scoreToMusicXml へ直接渡すと ScorePage → buildCurrentScoreData →
  // exporter の配線（instrumentation を返り値に入れる箇所）を検証できないため、
  // ScorePageTimeSigSymbolExport.test.tsx と同じく実マウントで
  // 名前編集 → ファイルタブ → MusicXML 書き出し → Blob 本文まで通して固定する。
  it('画面で編集した名前が MusicXML 書き出しの part-name に出る（実マウント配線）', async () => {
    let exportedXml: string | null = null;
    const origCreateObjectURL = URL.createObjectURL;
    // ダウンロードの Blob を横取りして XML 本文を読む（jsdom は実ダウンロードできない）
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        const reader = new FileReader();
        reader.onload = () => { exportedXml = String(reader.result); };
        reader.readAsText(blob);
        return 'blob:mock';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      openQuartetScore();
      const dialog = openPartNameEditor();
      fireEvent.change(
        within(dialog).getByRole('textbox', { name: 'Violoncelloのパート名' }),
        { target: { value: 'Basso' } },
      );

      fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
      fireEvent.change(screen.getByLabelText('書き出し'), { target: { value: 'musicxml' } });
      // Issue #507: 書き出しはファイル名の確認ダイアログを経由する（既定名のままOK）
      fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
      await waitFor(() => {
        expect(exportedXml ?? '').toContain('<part-name>Basso</part-name>');
      }, { timeout: 15000 });
      expect(exportedXml ?? '').not.toContain('<part-name>Violoncello</part-name>');
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: origCreateObjectURL });
    }
  }, 60000);

  // Codex round2 P2: 空白だけの名前は書き出しでも「未入力」扱い（表示と同じ解決規則）
  it('空白だけの名前は MusicXML に空白のまま出ず、略称で代用される', () => {
    const inst = getDefaultInstrumentationForScoreType('quartet');
    const customInst = {
      ...inst,
      parts: inst.parts.map((part) => part.id === 'cello'
        ? { ...part, name: '   ', abbreviation: 'B.' }
        : part),
    };
    const events = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
    const data = createSavedScoreData(
      { title: '空白名書き出し', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'cello', clef: 'bass' as const, measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
      1, 1, 'quartet', 'C', [4, 4], customInst as never
    );
    const xml = scoreToMusicXml(data);
    expect(xml).not.toContain('<part-name>   </part-name>');
    expect(xml).toContain('<part-name>B.</part-name>');
  });

  it('空白だけの名前は「未入力」扱いで、略称（または既定）で代用される', () => {
    openQuartetScore();
    const dialog = openPartNameEditor();
    const nameInput = within(dialog).getByRole('textbox', { name: 'Violin Iのパート名' });
    fireEvent.change(nameInput, { target: { value: '   ' } });
    // 正式名が空白のみ → フル名の位置にも略称（Vn. I）が出る（resolveInstrumentPartLabels）
    expect(renderedLabels()).not.toContain('   ');
    expect(renderedLabels()).toContain('Vn. I');
  });
});
