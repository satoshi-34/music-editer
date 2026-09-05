// タイトル書体・サイズ・太さ（#420）の ScorePage 配線テスト（Codex round1 P1）。
//
// titleFontOptions.test.ts は純関数だけを見る。ここでは実際の操作から
// タイトルブロックの CSS 変数が変わること、自動保存で往復すること、
// 新規作成で既定へ戻ること（round1 で見つかったリセット漏れ）を DOM で固定する。
//
// #576 で操作の入口が「楽譜設定タブの常設3項目」から
// 「タイトル欄を編集したときに出るコンテキストUI」へ移ったため、
// 開き方（フォーカス）と閉じ方（フォーカスが外れる）もここで固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';

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

let workId = '';

function seedWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '書体テスト', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single'
  );
  const created = createWork('書体テスト');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}

/** タイトルブロック（CSS変数の注入先）を探す */
function titleBlockStyle(): string {
  const el = document.querySelector('.score-title')?.closest('[style]') as HTMLElement | null;
  return el?.getAttribute('style') ?? '';
}

/**
 * タイトル欄（h1）へフォーカスを入れて書式のコンテキストUIを開く（#576）。
 * React の onFocus は focusin で受けているので focusIn を送る（jsdom の
 * contentEditable は element.focus() では activeElement にならないため）。
 */
function openTitleFormatPanel(): HTMLElement {
  const titleEl = document.querySelector('.score-title') as HTMLElement;
  fireEvent.focusIn(titleEl);
  return titleEl;
}

/**
 * タイトル欄からフォーカスを外す（＝編集をやめる）。
 * jsdom には innerText が無く、ScorePage の onBlur が読む値が undefined になって
 * タイトル文字列が消えてしまうため、送る前にその要素へだけ innerText を生やす
 * （ScoreHeadCreditLayout.test.tsx と同じ既存の対処）。
 */
function blurTitle(relatedTarget: Element): void {
  const titleEl = document.querySelector('.score-title') as HTMLElement;
  Object.defineProperty(titleEl, 'innerText', { value: titleEl.textContent ?? '', configurable: true });
  fireEvent.focusOut(titleEl, { relatedTarget });
}

describe('ScorePage: タイトル書体・サイズ・太さの配線（#420）', () => {
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

  it('タイトル編集時のコンテキストUIで CSS 変数が変わり、保存へ往復し、新規作成で既定へ戻る（#576）', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 楽譜設定タブからは撤去されている（#576 の受入条件）
    fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
    await screen.findByLabelText('調号', {}, { timeout: 15000 });
    expect(screen.queryByLabelText('タイトルの書体')).toBeNull();
    expect(screen.queryByLabelText('タイトルの文字サイズ')).toBeNull();
    expect(screen.queryByLabelText('タイトルの太さ')).toBeNull();

    // タイトル欄をクリック（＝フォーカス）すると、その場に書式のコントロールが出る
    openTitleFormatPanel();
    const sizeSlider = await screen.findByLabelText('タイトルの文字サイズ', {}, { timeout: 15000 });
    fireEvent.change(sizeSlider, { target: { value: '1.4' } });
    fireEvent.change(screen.getByLabelText('タイトルの太さ'), { target: { value: 'bold' } });

    // CSS 変数がタイトルブロックへ注入される
    await waitFor(() => {
      const style = titleBlockStyle();
      expect(style).toContain('--title-font-scale: 1.4');
      expect(style).toContain('--title-font-weight: 700');
    }, { timeout: 15000 });

    // 自動保存へ往復する
    await waitFor(() => {
      const data = loadWorkAutosaveData(workId).data;
      expect(data?.titleFontSize).toBe(1.4);
      expect(data?.titleFontWeight).toBe('bold');
    }, { timeout: 15000 });

    // パネル内のコントロールへフォーカスが移っても消えない（消えると操作できない）
    blurTitle(screen.getByLabelText('タイトルの書体'));
    expect(screen.queryByLabelText('タイトルの書体')).not.toBeNull();

    // タイトル欄の外へフォーカスが出るとパネルは消える（受入条件4）
    fireEvent.focusOut(screen.getByLabelText('タイトルの書体'), { relatedTarget: document.body });
    await waitFor(() => {
      expect(screen.queryByLabelText('タイトルの書体')).toBeNull();
    }, { timeout: 15000 });
    // 消えても値は残る（パネルは入口であって保存先ではない）
    expect(titleBlockStyle()).toContain('--title-font-scale: 1.4');

    // 開き直しても現在値が入っている
    openTitleFormatPanel();
    await waitFor(() => {
      expect((screen.getByLabelText('タイトルの太さ') as HTMLSelectElement).value).toBe('bold');
    }, { timeout: 15000 });

    // 新規作成で既定へ戻る（round1 のリセット漏れ: 書体だけ戻ってサイズ・太さが残る）
    blurTitle(document.body);
    fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
    fireEvent.click(await screen.findByRole('button', { name: /新規作成/ }, { timeout: 15000 }));
    // アプリ内確認ダイアログ（ConfirmDialog）の確定ボタンを押す
    const okButton = await screen.findByRole('button', { name: 'OK' }, { timeout: 15000 });
    fireEvent.click(okButton);
    await waitFor(() => {
      const style = titleBlockStyle();
      expect(style).not.toContain('--title-font-scale');
      expect(style).not.toContain('--title-font-weight');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('旧来の Noto 書体は太さ未指定なら 600（従来の見た目）のまま、明示の太字で 700 になる', async () => {
    seedWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    openTitleFormatPanel();
    const fontSelect = await screen.findByLabelText('タイトルの書体', {}, { timeout: 15000 });
    fireEvent.change(fontSelect, { target: { value: 'noto-serif-jp' } });

    // 未指定: 互換ウェイト 600 が注入される（配信に 700 を加えた影響で
    // 既存譜面が 600→700 に変わらないため。#420 Codex round1 P1）
    await waitFor(() => {
      expect(titleBlockStyle()).toContain('--title-font-weight: 600');
    }, { timeout: 15000 });

    // 明示の太字にすると 700
    fireEvent.change(screen.getByLabelText('タイトルの太さ'), { target: { value: 'bold' } });
    await waitFor(() => {
      expect(titleBlockStyle()).toContain('--title-font-weight: 700');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
