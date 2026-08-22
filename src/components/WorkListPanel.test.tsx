// src/components/WorkListPanel.test.tsx
// 作品一覧UI（Issue #181）の表示と操作のテスト。
// とくに「削除は確認なしに実行されない」（受入条件3）はここで固定する。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WorkListPanel from './WorkListPanel';
import type { WorkSummary } from '../types/storage';

// 2026-08-04 21:35 と 2026-08-01 09:05（ローカル時刻）
const UPDATED_NEW = new Date(2026, 7, 4, 21, 35).getTime();
const UPDATED_OLD = new Date(2026, 7, 1, 9, 5).getTime();

const WORKS: WorkSummary[] = [
  { id: 'work-new', title: '春の歌', updatedAt: UPDATED_NEW, createdAt: UPDATED_OLD },
  { id: 'work-old', title: '', updatedAt: UPDATED_OLD, createdAt: UPDATED_OLD }
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof WorkListPanel>> = {}) {
  const props = {
    works: WORKS,
    currentWorkId: 'work-new',
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onListHistory: vi.fn().mockReturnValue([]),
    onRestoreHistory: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
  render(<WorkListPanel {...props} />);
  return props;
}

describe('作品一覧パネル（Issue #181）', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('作品名と最終更新日時が並ぶ。タイトルが空の作品は「無題」と日時で区別できる', () => {
    renderPanel();

    expect(screen.getByText('春の歌')).toBeInTheDocument();
    expect(screen.getByText('無題')).toBeInTheDocument();
    expect(screen.getByText('2026/08/04 21:35')).toBeInTheDocument();
    expect(screen.getByText('2026/08/01 09:05')).toBeInTheDocument();
  });

  it('編集中の作品は「編集中」と示され、開くボタンが押せない', () => {
    renderPanel();

    expect(screen.getByText('編集中')).toBeInTheDocument();
    // 開くボタンの読み上げ名は「作品名＋最終更新日時」（削除ボタンと区別するため完全一致で指定する）
    expect(screen.getByRole('button', { name: '春の歌2026/08/04 21:35' })).toBeDisabled();
  });

  it('別の作品を選ぶと onSelect にその作品IDが渡る', () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '無題2026/08/01 09:05' }));

    expect(props.onSelect).toHaveBeenCalledWith('work-old');
  });

  it('「新規作成」で onCreate が呼ばれる', () => {
    const props = renderPanel();

    fireEvent.click(screen.getByTestId('work-list-create'));

    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  describe('削除の確認（受入条件3）', () => {
    beforeEach(() => {
      vi.spyOn(window, 'confirm');
    });

    it('確認ダイアログでキャンセルすると削除されない', () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      const props = renderPanel();

      fireEvent.click(screen.getByRole('button', { name: '春の歌 を削除' }));

      expect(window.confirm).toHaveBeenCalled();
      expect(props.onDelete).not.toHaveBeenCalled();
    });

    it('確認ダイアログでOKしたときだけ onDelete が呼ばれる', () => {
      vi.mocked(window.confirm).mockReturnValue(true);
      const props = renderPanel();

      fireEvent.click(screen.getByRole('button', { name: '春の歌 を削除' }));

      expect(props.onDelete).toHaveBeenCalledWith('work-new');
    });
  });

  describe('復元履歴（Issue #109 第3段）', () => {
    const GENERATIONS = [
      { timestamp: new Date(2026, 7, 4, 20, 0).getTime(), checksum: 'x', data: {} as never },
      { timestamp: new Date(2026, 7, 4, 18, 30).getTime(), checksum: 'x', data: {} as never },
    ];

    it('「履歴」で世代一覧が開き、無ければ説明が出る', () => {
      // 履歴があるのは work-new だけ、というモック（作品ごとに違う結果を返す）
      const props = renderPanel({
        onListHistory: vi.fn().mockImplementation((workId: string) => (workId === 'work-new' ? GENERATIONS : [])),
      });
      fireEvent.click(screen.getByLabelText('春の歌 の復元履歴'));
      expect(props.onListHistory).toHaveBeenCalledWith('work-new');
      expect(screen.getByText('2026/08/04 20:00')).toBeInTheDocument();
      expect(screen.getByText('2026/08/04 18:30')).toBeInTheDocument();
      // 世代が無い作品では説明文
      fireEvent.click(screen.getByLabelText('無題 の復元履歴'));
      expect(screen.getByText(/復元できる世代はまだありません/)).toBeInTheDocument();
    });

    it('「この時点に戻す」はアプリ内の確認ダイアログで実行したときだけ onRestoreHistory を呼ぶ', () => {
      // window.confirm は埋め込みブラウザで表示されないため使わない（ConfirmDialog 経由）
      const props = renderPanel({ onListHistory: vi.fn().mockReturnValue(GENERATIONS) });
      fireEvent.click(screen.getByLabelText('春の歌 の復元履歴'));
      fireEvent.click(screen.getAllByText('この時点に戻す')[0]);
      // ダイアログが開き、文言は「いまの内容も履歴に残る」ことを伝える
      const dialog = screen.getByRole('dialog', { name: '復元の確認' });
      expect(dialog.textContent).toContain('いまの内容も履歴に残る');
      // 「やめる」では呼ばれない
      fireEvent.click(screen.getByText('やめる'));
      expect(props.onRestoreHistory).not.toHaveBeenCalled();
      // もう一度開いて実行ボタンで確定すると呼ばれる
      fireEvent.click(screen.getAllByText('この時点に戻す')[0]);
      const confirmButton = screen.getAllByRole('button', { name: 'この時点に戻す' }).at(-1)!;
      fireEvent.click(confirmButton);
      expect(props.onRestoreHistory).toHaveBeenCalledWith('work-new', GENERATIONS[0].timestamp);
    });
  });

  it('作品が無いときは、まだ保存されていないことを説明する', () => {
    renderPanel({ works: [], currentWorkId: null });

    expect(screen.getByText(/保存された作品はまだありません/)).toBeInTheDocument();
  });
});
