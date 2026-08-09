// src/components/ScorePagePerScoreTypeSystemLayout.test.tsx
// Issue #211: 「段あたり小節数」「段数/ページ」を楽譜種別ごとに保持する。
// 受入条件1〜4（種別を切り替えると戻る／旧形式からの移行／リロード後の復元／
// レイアウトをリセットは現在の種別の値だけ）を、ScorePage を実際にマウントして確認する。
// 保存層そのものの単体テストは src/utils/systemLayoutPrefs.test.ts が担当。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  LEGACY_SYSTEMS_PER_PAGE_KEY,
  SYSTEM_LAYOUT_PREFS_STORAGE_KEY,
  parseSystemLayoutPrefs,
} from '../utils/systemLayoutPrefs';

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

function openScoreTab() {
  fireEvent.click(screen.getByRole('tab', { name: '楽譜設定' }));
}

function openLayoutTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'レイアウト' }));
}

/** 「楽譜設定」タブで楽譜の種類を切り替えてから「レイアウト」タブへ戻る */
function switchScoreType(label: string) {
  openScoreTab();
  fireEvent.click(screen.getByRole('button', { name: label }));
  openLayoutTab();
}

function measuresPerSystemInput() {
  return screen.getByRole('spinbutton', { name: '段あたり小節数' }) as HTMLInputElement;
}

function systemsPerPageInput() {
  return screen.getByLabelText('段数/ページ') as HTMLInputElement;
}

function savedPrefs() {
  return parseSystemLayoutPrefs(localStorageMock.getItem(SYSTEM_LAYOUT_PREFS_STORAGE_KEY));
}

describe('段組（段あたり小節数・段数/ページ）を楽譜種別ごとに保持する（Issue #211）', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('受入条件1: ピアノで「段あたり小節数=2」にしても編成譜は従来値のまま、ピアノへ戻すと2に戻る', () => {
    render(<ScorePage />);
    switchScoreType('ピアノ');
    fireEvent.change(measuresPerSystemInput(), { target: { value: '2' } });
    expect(measuresPerSystemInput().value).toBe('2');

    // 編成譜へ切り替えると、ピアノで設定した2は引き継がれない
    switchScoreType('編成譜');
    expect(measuresPerSystemInput().value).toBe('4');

    // 編成譜側で別の値にしても、ピアノへ戻せばピアノの値が復活する
    fireEvent.change(measuresPerSystemInput(), { target: { value: '1' } });
    expect(measuresPerSystemInput().value).toBe('1');

    switchScoreType('ピアノ');
    expect(measuresPerSystemInput().value).toBe('2');

    switchScoreType('編成譜');
    expect(measuresPerSystemInput().value).toBe('1');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入条件1: 「段数/ページ」も種別ごとに分かれる（単旋律の指定が編成譜へ漏れない）', () => {
    render(<ScorePage />);
    openLayoutTab();
    // 単旋律の推奨値は5段（Issue #49）。そこから手動で8段へ変える
    fireEvent.change(systemsPerPageInput(), { target: { value: '8' } });
    expect(systemsPerPageInput().value).toBe('8');

    // 編成譜は自分の推奨値のまま（単旋律の8は効かない）
    switchScoreType('編成譜');
    const ensembleRecommended = systemsPerPageInput().value;
    expect(ensembleRecommended).not.toBe('8');

    switchScoreType('単旋律');
    expect(systemsPerPageInput().value).toBe('8');

    // 保存された中身も種別ごとに分かれている
    expect(savedPrefs().single?.systemsPerPage).toBe(8);
    expect(savedPrefs().ensemble?.systemsPerPage).toBeUndefined();
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入条件2: 旧形式（単一キー）の保存値がある状態で開くと、全種別がその値から始まる', () => {
    localStorageMock.setItem(LEGACY_SYSTEMS_PER_PAGE_KEY, '3');
    render(<ScorePage />);
    openLayoutTab();

    expect(systemsPerPageInput().value).toBe('3');
    switchScoreType('ピアノ');
    expect(systemsPerPageInput().value).toBe('3');
    switchScoreType('弦楽四重奏');
    expect(systemsPerPageInput().value).toBe('3');
    switchScoreType('編成譜');
    expect(systemsPerPageInput().value).toBe('3');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入条件2: 移行しても旧キーは消さない（古いバージョンで開いても壊れないように）', () => {
    localStorageMock.setItem(LEGACY_SYSTEMS_PER_PAGE_KEY, '3');
    render(<ScorePage />);
    openLayoutTab();

    expect(localStorageMock.getItem(LEGACY_SYSTEMS_PER_PAGE_KEY)).toBe('3');
    // 変更後も旧キーは最後に指定した値へ追従する（旧バージョンから見た挙動を保つ）
    fireEvent.change(systemsPerPageInput(), { target: { value: '6' } });
    expect(localStorageMock.getItem(LEGACY_SYSTEMS_PER_PAGE_KEY)).toBe('6');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入条件3: 種別ごとの値がリロード後（再マウント後）も復元される', () => {
    render(<ScorePage />);
    switchScoreType('ピアノ');
    fireEvent.change(measuresPerSystemInput(), { target: { value: '2' } });
    fireEvent.change(systemsPerPageInput(), { target: { value: '2' } });
    switchScoreType('編成譜');
    fireEvent.change(measuresPerSystemInput(), { target: { value: '1' } });
    fireEvent.change(systemsPerPageInput(), { target: { value: '1' } });

    // リロード相当（localStorage は残したままアンマウント→再マウント）
    cleanup();
    render(<ScorePage />);
    openLayoutTab();

    switchScoreType('ピアノ');
    expect(measuresPerSystemInput().value).toBe('2');
    expect(systemsPerPageInput().value).toBe('2');

    switchScoreType('編成譜');
    expect(measuresPerSystemInput().value).toBe('1');
    expect(systemsPerPageInput().value).toBe('1');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('受入条件4: 「レイアウトをリセット」は他の楽譜種別の段組設定を巻き込まない', () => {
    render(<ScorePage />);
    switchScoreType('ピアノ');
    fireEvent.change(measuresPerSystemInput(), { target: { value: '2' } });
    fireEvent.change(systemsPerPageInput(), { target: { value: '2' } });
    switchScoreType('編成譜');
    fireEvent.change(measuresPerSystemInput(), { target: { value: '1' } });

    const before = savedPrefs();

    // リセット系4種は1つのメニューに集約されているため、開いてから押す（Issue #143）。
    // 現在の楽譜種別は編成譜。
    fireEvent.click(screen.getByTestId('layout-reset-menu-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'レイアウトをリセット' }));

    // 「レイアウトをリセット」が戻すのは余白・段の間隔・パート間隔であり、
    // 段組（段あたり小節数・段数/ページ）は現在の種別のぶんも他の種別のぶんも触らない
    expect(savedPrefs()).toEqual(before);
    expect(savedPrefs().piano).toEqual({ measuresPerSystem: 2, systemsPerPage: 2 });

    switchScoreType('ピアノ');
    expect(measuresPerSystemInput().value).toBe('2');
    expect(systemsPerPageInput().value).toBe('2');
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it('編成テンプレートを編成譜どうしで入れ替えても、段あたり小節数は変わらない', () => {
    render(<ScorePage />);
    switchScoreType('編成譜');
    fireEvent.change(measuresPerSystemInput(), { target: { value: '2' } });

    openScoreTab();
    fireEvent.change(screen.getByLabelText('編成テンプレート'), { target: { value: 'wind-band' } });
    openLayoutTab();

    expect(measuresPerSystemInput().value).toBe('2');
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
