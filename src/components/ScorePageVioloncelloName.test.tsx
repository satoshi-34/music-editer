// src/components/ScorePageVioloncelloName.test.tsx
// Issue #443: チェロの正式名を Cello → Violoncello にする（略称 Vc. は据え置き）。
//
// 名前の定義は「弦楽四重奏（QuartetStaff の QUARTET_PART_CONFIGS）」と
// 「編成テンプレート（instrumentationPresets）」の2系統に分かれているので、
// 新規作成した譜面が実際に Violoncello と表示されることを、譜種ごとに画面で確かめる。
// レンダー手法は ScorePagePartSpacing.test.tsx と同じ ScorePage の直接マウント。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import ScorePage from './ScorePage';
import { QUARTET_PART_CONFIGS } from './QuartetStaff';
import { createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId } from '../utils/storage';
import { waitFor } from '@testing-library/react';
import type { MeasureData } from '../types/storage';

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

function openScoreTab() {
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
}

describe('チェロの正式名は Violoncello（Issue #443）', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('新規の弦楽四重奏では、1段目のフル名が Violoncello になる（略称は Vc. のまま）', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));

    const labels = renderedLabels();
    expect(labels).toContain('Violoncello');
    // 旧名がそのまま残っていないこと（Violoncello の部分一致で見逃さないよう完全一致で見る）
    expect(labels).not.toContain('Cello');
    // 略称は変えない（受入条件: Vc. は現状維持）。2段目以降で使う値なので、
    // 実段が1つしかない新規譜面の描画には出てこない。定義側で確かめる
    expect(QUARTET_PART_CONFIGS[3].label).toBe('Vc.');
    expect(QUARTET_PART_CONFIGS[3].fullLabel).toBe('Violoncello');
    // 他のパート名は巻き込まれていない
    expect(labels).toContain('Violin I');
    expect(labels).toContain('Viola');
  }, 20000);

  it('新規の編成譜（既定=室内オーケストラ）のパート編集でも Violoncello になる', () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '編成譜' }));

    fireEvent.click(screen.getByRole('button', { name: /パート編集/ }));
    const dialog = screen.getByRole('dialog', { name: '編成パート編集' });
    expect(within(dialog).getByRole('textbox', { name: 'Violoncelloのパート名' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Celloのパート名' })).toBeNull();
  }, 20000);

  // Codex round1 P2: 保存作品の復元・パート譜セレクト・複数段の略称描画も実マウントで固定する

  it('保存済み編成の name: "Cello" は復元後も Cello のまま（保存名優先）', async () => {
    const events = [
      { dur: '4' as const, isRest: false, keys: ['c/3'] },
      { dur: '4' as const, isRest: false, keys: ['d/3'] },
      { dur: '4' as const, isRest: false, keys: ['e/3'] },
      { dur: '4' as const, isRest: false, keys: ['f/3'] },
    ];
    const mk = (): MeasureData => ({ events, voices: [{ id: 'voice-1', events }] });
    const data = createSavedScoreData(
      { title: '保存名優先', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [{ partId: 'cello-legacy', clef: 'bass', measures: [mk()] }],
      1, 1, 'ensemble', 'C', [4, 4],
      {
        presetId: 'custom', name: '旧名のまま',
        parts: [{
          id: 'cello-legacy', name: 'Cello', abbreviation: 'Vc.', family: 'strings',
          clef: 'bass', staffCount: 1, transposition: 'C', bracketGroup: 'strings',
          playbackInstrument: 'piano', order: 0,
        }],
      } as never
    );
    const created = createWork('保存名優先');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    await waitFor(() => {
      expect(renderedLabels().length).toBeGreaterThan(0);
    }, { timeout: 15000 });
    // 保存名 Cello が Violoncello に化けない（既存作品の保存名優先の実証）
    expect(renderedLabels()).toContain('Cello');
    expect(renderedLabels()).not.toContain('Violoncello');
  }, 30000);

  it('弦楽四重奏のパート譜セレクトに Violoncello が並び、選択すると見出しに出る', async () => {
    render(<ScorePage />);
    openScoreTab();
    fireEvent.click(screen.getByRole('button', { name: '弦楽四重奏' }));
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));

    const partSelect = Array.from(document.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.textContent === 'Violoncello'));
    expect(partSelect, 'パート譜セレクトに Violoncello').toBeTruthy();
    const vcOption = Array.from(partSelect!.options).find((o) => o.textContent === 'Violoncello')!;
    fireEvent.change(partSelect!, { target: { value: vcOption.value } });
    await waitFor(() => {
      expect(document.body.textContent).toContain('Violoncello');
    }, { timeout: 15000 });
    expect(document.body.textContent).not.toContain('Cello ');
  }, 30000);

  it('弦楽四重奏の2ページ目の先頭段では略称 Vc. が実際に描画される', async () => {
    const events = [
      { dur: '1' as const, isRest: false, keys: ['c/3'] },
    ];
    const mk = (): MeasureData => ({ events, voices: [{ id: 'voice-1', events }] });
    const part = (partId: string, clef: 'treble' | 'alto' | 'bass') =>
      ({ partId, clef, measures: Array.from({ length: 5 }, mk) });
    const data = createSavedScoreData(
      { title: '略称描画', subtitle: '', lyricist: '', composer: '', arranger: '' },
      [
        part('violin-1', 'treble'), part('violin-2', 'treble'),
        part('viola', 'alto'), part('cello', 'bass'),
      ],
      5, 1, 'quartet'
    );
    const created = createWork('略称描画');
    if (!created.success || !created.data) throw new Error('createWork failed');
    saveWorkAutosaveData(created.data.id, data);
    setLastOpenedWorkId(created.data.id);

    render(<ScorePage />);
    // 略称ラベル（Vc.）は2ページ目以降の先頭段に出る（1ページ目の先頭段はフル名）。
    // 4パート×5小節（5段=2ページ）の音符が描き終わるまで待つ
    await waitFor(() => {
      expect(document.querySelectorAll('rect.vf-note-hit').length).toBeGreaterThanOrEqual(20);
    }, { timeout: 20000 });
    await waitFor(() => {
      expect(renderedLabels()).toContain('Vc.');
    }, { timeout: 15000 });
    // 1ページ目の先頭段はフル名・2ページ目の先頭段は略称、の両方が実 DOM に出ている
    expect(renderedLabels()).toContain('Violoncello');
  }, 30000);
});
