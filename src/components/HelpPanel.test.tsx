// アプリ内ヘルプ（Issue #341）のパネル挙動テスト。
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HelpPanel from './HelpPanel';

describe('HelpPanel', () => {
  it('目的別ガイドとリファレンスの2層が表示される', () => {
    render(<HelpPanel onClose={vi.fn()} />);
    expect(screen.getByText('やりたいことから探す')).toBeTruthy();
    expect(screen.getByText('操作リファレンス（説明書）')).toBeTruthy();
    expect(screen.getByText('タイ／スラーを付けたい')).toBeTruthy();
  });

  it('検索で両層が絞り込まれ、README由来の項目もヒットする', () => {
    render(<HelpPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('ヘルプ内を検索'), { target: { value: '段またぎ' } });
    // 目的別ガイド側
    expect(screen.getByText('音を別の五線（隣の段）に表示したい')).toBeTruthy();
    // 無関係なガイドは消える
    expect(screen.queryByText('印刷したい／PDFにしたい')).toBeNull();
  });

  it('見つからない検索語では「見つからない」案内を出す（無言にしない）', () => {
    render(<HelpPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('ヘルプ内を検索'), { target: { value: 'zzzznohit' } });
    // ガイド側・リファレンス側の両方に「見つからない」案内が出る
    expect(screen.getAllByText(/見つかりませんでした/).length).toBe(2);
  });

  it('✕ 閉じるボタンと背景クリックで onClose が呼ばれる', () => {
    const onClose = vi.fn();
    const { container } = render(<HelpPanel onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('ヘルプを閉じる'));
    fireEvent.click(container.querySelector('.dropdown-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('目的別ガイドの「詳しく」で、該当リファレンス項目が開いた状態でスクロールされる', async () => {
    render(<HelpPanel onClose={vi.fn()} />);
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const guide = screen.getByText('タイ／スラーを付けたい').closest('details')!;
    fireEvent.click(guide.querySelector('summary')!);
    fireEvent.click(screen.getByText(/リファレンス「タイ／スラー」へ/));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    // 「正しい対象」が開いた状態になっている（閉じたままだと本文が見えない・Codex round1 P2）
    const target = Array.from(document.querySelectorAll('details[data-help-section]'))
      .find((d) => d.querySelector('summary')?.textContent === 'タイ／スラー') as HTMLDetailsElement;
    expect(target).toBeTruthy();
    expect(target.open).toBe(true);
    // スクロールもその対象（かその内部）へ向けて呼ばれている
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('モーダル内のキー入力は譜面（window のハンドラ）へ伝播しない・Escape で閉じる', () => {
    const onClose = vi.fn();
    const windowKeydown = vi.fn();
    window.addEventListener('keydown', windowKeydown);
    try {
      render(<HelpPanel onClose={onClose} />);
      const search = screen.getByLabelText('ヘルプ内を検索');
      // 検索欄の Backspace/Delete が裏の選択物を消さない（ConfirmDialog と同じ守り）
      fireEvent.keyDown(search, { key: 'Backspace' });
      fireEvent.keyDown(search, { key: 'Delete' });
      expect(windowKeydown).not.toHaveBeenCalled();
      // Escape はヘルプを閉じる
      fireEvent.keyDown(search, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(windowKeydown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowKeydown);
    }
  });
});
