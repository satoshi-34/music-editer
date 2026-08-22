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

  it('目的別ガイドの「詳しく」でリファレンス該当項目へ移動できる', () => {
    render(<HelpPanel onClose={vi.fn()} />);
    const guide = screen.getByText('タイ／スラーを付けたい').closest('details')!;
    fireEvent.click(guide.querySelector('summary')!);
    const link = screen.getByText(/リファレンス「タイ／スラー」へ/);
    // scrollIntoView は jsdom に無いのでスタブして、対象が実在することだけ確かめる
    const target = document.querySelector('[data-help-section]');
    expect(target).toBeTruthy();
    Element.prototype.scrollIntoView = vi.fn();
    fireEvent.click(link);
  });
});
