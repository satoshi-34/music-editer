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

  // Codex round1 P1: 編集した名前が MusicXML 書き出しへ渡る（buildCurrentScoreData の instrumentation）
  it('編集した名前が MusicXML の part-name に出る', () => {
    const inst = getDefaultInstrumentationForScoreType('quartet');
    const customInst = {
      ...inst,
      parts: inst.parts.map((part) => part.id === 'cello'
        ? { ...part, name: 'Basso', abbreviation: 'B.' }
        : part),
    };
    const events = [{ dur: '1' as const, isRest: false, keys: ['c/3'] }];
    const data = createSavedScoreData(
      { title: '書き出し名', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'cello', clef: 'bass' as const, measures: [{ events, voices: [{ id: 'voice-1', events }] }] }],
      1, 1, 'quartet', 'C', [4, 4], customInst as never
    );
    const xml = scoreToMusicXml(data);
    expect(xml).toContain('<part-name>Basso</part-name>');
    expect(xml).not.toContain('<part-name>Violoncello</part-name>');
  });

  it('空白だけの名前は「未入力」扱いで、略称（または既定）で代用される', () => {
    openQuartetScore();
    const dialog = openPartNameEditor();
    const nameInput = within(dialog).getByRole('textbox', { name: 'Violin Iのパート名' });
    fireEvent.change(nameInput, { target: { value: '   ' } });
    // 正式名が空白のみ → フル名の位置にも略称（Vln. I）が出る（resolveInstrumentPartLabels）
    expect(renderedLabels()).not.toContain('   ');
    expect(renderedLabels()).toContain('Vln. I');
  });
});
