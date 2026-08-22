// src/components/SaveLoadButtons.test.tsx
// 「ファイル」タブの基本操作コンポーネントのテスト。
// 手動「保存」「読込」ボタンとファイル保存/開くボタンは #109 第4段で廃止した
// （ブラウザ内保存は作品単位の自動保存+復元履歴、ファイル入出力は「書き出し」「開く」
// メニューへ統合）。ここに残るのは 新規作成・右下インジケータ・サンプル（開発用）だけ。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SaveLoadButtons, { type SaveLoadButtonsProps } from './SaveLoadButtons';

import '@testing-library/jest-dom';

const baseProps: SaveLoadButtonsProps = {
  isLoading: false,
};

describe('SaveLoadButtons Component Tests', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('新規作成ボタンはハンドラがあるときだけ描画され、読込中は押せない', () => {
    const onNewScore = vi.fn();
    const { rerender } = render(<SaveLoadButtons {...baseProps} onNewScore={onNewScore} />);
    const button = screen.getByTitle('新しい空の譜面を作成');
    fireEvent.click(button);
    expect(onNewScore).toHaveBeenCalledTimes(1);

    rerender(<SaveLoadButtons {...baseProps} onNewScore={onNewScore} isLoading={true} />);
    expect(screen.getByTitle('新しい空の譜面を作成')).toBeDisabled();

    rerender(<SaveLoadButtons {...baseProps} />);
    expect(screen.queryByTitle('新しい空の譜面を作成')).not.toBeInTheDocument();
  });

  it('廃止した手動「保存」「読込」「ファイル保存」「ファイルを開く」ボタンは描画されない', () => {
    render(<SaveLoadButtons {...baseProps} onNewScore={vi.fn()} />);
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
    expect(screen.queryByText('読込')).not.toBeInTheDocument();
    expect(screen.queryByText('ファイル保存')).not.toBeInTheDocument();
    expect(screen.queryByText('ファイルを開く')).not.toBeInTheDocument();
  });

  it('右下インジケータ: 自動保存の状態と、書き出し結果（成功=status/失敗=alert）を出し分ける', () => {
    const { rerender } = render(<SaveLoadButtons {...baseProps} autoSaveStatus="saved" />);
    expect(screen.getByTestId('save-status-indicator')).toHaveTextContent('✓ 自動保存済み');
    expect(screen.getByTestId('save-status-indicator')).toHaveAttribute('role', 'status');

    // 書き出しの結果は自動保存の表示より優先される
    rerender(
      <SaveLoadButtons
        {...baseProps}
        autoSaveStatus="saved"
        exportStatus={{ kind: 'error', message: '⚠ MusicXMLを書き出せませんでした' }}
      />
    );
    const indicator = screen.getByTestId('save-status-indicator');
    expect(indicator).toHaveTextContent('書き出せませんでした');
    // 失敗は読み上げに割り込ませる
    expect(indicator).toHaveAttribute('role', 'alert');
  });

  it('サンプル操作（開発用）はハンドラがあるときだけ描画される', () => {
    const onLoadSample = vi.fn();
    render(
      <SaveLoadButtons
        {...baseProps}
        onLoadSample={onLoadSample}
        onSaveCurrentAsSample={vi.fn()}
        canSaveCurrentAsSample={true}
      />
    );
    fireEvent.click(screen.getByTitle('選択したサンプル譜面を読み込み'));
    expect(onLoadSample).toHaveBeenCalledWith('fur-elise');

    cleanup();
    render(<SaveLoadButtons {...baseProps} />);
    expect(screen.queryByTitle('選択したサンプル譜面を読み込み')).not.toBeInTheDocument();
  });
});
