// src/components/InstrumentSelector.test.tsx
// InstrumentSelectorコンポーネントのテスト

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InstrumentSelector, { type InstrumentSelectorProps } from './InstrumentSelector';
import { InstrumentType } from '../audio/SoundSource';

// デフォルトのプロパティ
const defaultProps: InstrumentSelectorProps = {
  selectedInstrument: InstrumentType.PIANO,
  availableInstruments: [
    InstrumentType.PIANO,
    InstrumentType.ORGAN,
    InstrumentType.GUITAR,
    InstrumentType.STRINGS
  ],
  onInstrumentChange: vi.fn(),
  onPreview: vi.fn()
};

describe('InstrumentSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本的なレンダリング', () => {
    it('通常表示で必要な要素が表示される', () => {
      render(<InstrumentSelector {...defaultProps} />);

      expect(screen.getByText('音色選択')).toBeInTheDocument();
      expect(screen.getByLabelText('現在の楽器: ピアノ')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ピアノをプレビュー' })).toBeInTheDocument();
    });

    it('コンパクト表示で必要な要素が表示される', () => {
      render(<InstrumentSelector {...defaultProps} compact />);

      expect(screen.getByLabelText('楽器選択')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '音色プレビュー' })).toBeInTheDocument();
    });

    it('選択された楽器の情報が正しく表示される', () => {
      render(<InstrumentSelector {...defaultProps} selectedInstrument={InstrumentType.ORGAN} />);

      expect(screen.getByText('オルガン')).toBeInTheDocument();
      expect(screen.getByText('豊かな倍音のオルガンサウンド')).toBeInTheDocument();
    });

    it('読み込み中の楽器が正しく表示される', () => {
      render(
        <InstrumentSelector 
          {...defaultProps} 
          loadingInstruments={[InstrumentType.PIANO]}
        />
      );

      expect(screen.getByText('ピアノ (読込中...)')).toBeInTheDocument();
    });
  });

  describe('ドロップダウン操作', () => {
    it('ボタンクリックでドロップダウンが開く', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: '楽器選択メニュー' })).toBeInTheDocument();
      });
    });

    it('Enterキーでドロップダウンが開く', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.keyDown(button, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: '楽器選択メニュー' })).toBeInTheDocument();
      });
    });

    it('スペースキーでドロップダウンが開く', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.keyDown(button, { key: ' ' });

      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: '楽器選択メニュー' })).toBeInTheDocument();
      });
    });

    it('Escapeキーでドロップダウンが閉じる', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      fireEvent.keyDown(button, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    it('オーバーレイクリックでドロップダウンが閉じる', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const overlay = document.querySelector('.dropdown-overlay');
      expect(overlay).toBeInTheDocument();
      
      fireEvent.click(overlay!);

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });
  });

  describe('楽器選択', () => {
    it('楽器オプションクリックで選択される', async () => {
      const onInstrumentChange = vi.fn();
      render(<InstrumentSelector {...defaultProps} onInstrumentChange={onInstrumentChange} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const organOption = screen.getByText('オルガン').closest('.instrument-option');
      fireEvent.click(organOption!);

      expect(onInstrumentChange).toHaveBeenCalledWith(InstrumentType.ORGAN);
    });

    it('楽器オプションでEnterキー押下で選択される', async () => {
      const onInstrumentChange = vi.fn();
      render(<InstrumentSelector {...defaultProps} onInstrumentChange={onInstrumentChange} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const organOption = screen.getByText('オルガン').closest('.instrument-option');
      fireEvent.keyDown(organOption!, { key: 'Enter' });

      expect(onInstrumentChange).toHaveBeenCalledWith(InstrumentType.ORGAN);
    });

    it('選択後にドロップダウンが閉じる', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const organOption = screen.getByText('オルガン').closest('.instrument-option');
      fireEvent.click(organOption!);

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });
  });

  describe('プレビュー機能', () => {
    it('プレビューボタンクリックでonPreviewが呼ばれる', () => {
      const onPreview = vi.fn();
      render(<InstrumentSelector {...defaultProps} onPreview={onPreview} />);

      const previewButton = screen.getByRole('button', { name: 'ピアノをプレビュー' });
      fireEvent.click(previewButton);

      expect(onPreview).toHaveBeenCalledWith(InstrumentType.PIANO);
    });

    it('ドロップダウン内のプレビューボタンでonPreviewが呼ばれる', async () => {
      const onPreview = vi.fn();
      render(<InstrumentSelector {...defaultProps} onPreview={onPreview} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const organPreviewButton = screen.getByLabelText('オルガンをプレビュー');
      fireEvent.click(organPreviewButton);

      expect(onPreview).toHaveBeenCalledWith(InstrumentType.ORGAN);
    });

    it('プレビューボタンクリックでドロップダウンが閉じない', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const organPreviewButton = screen.getByLabelText('オルガンをプレビュー');
      fireEvent.click(organPreviewButton);

      // ドロップダウンが開いたままであることを確認
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('onPreviewが未定義の場合プレビューボタンが表示されない', () => {
      render(<InstrumentSelector {...defaultProps} onPreview={undefined} />);

      expect(screen.queryByRole('button', { name: /プレビュー/ })).not.toBeInTheDocument();
    });
  });

  describe('コンパクト表示', () => {
    it('コンパクト表示でセレクトボックスが表示される', () => {
      render(<InstrumentSelector {...defaultProps} compact />);

      const select = screen.getByLabelText('楽器選択') as HTMLSelectElement;
      expect(select).toBeInTheDocument();
      expect(select.value).toBe(InstrumentType.PIANO);
    });

    it('コンパクト表示でセレクト変更時にonInstrumentChangeが呼ばれる', () => {
      const onInstrumentChange = vi.fn();
      render(<InstrumentSelector {...defaultProps} onInstrumentChange={onInstrumentChange} compact />);

      const select = screen.getByLabelText('楽器選択');
      fireEvent.change(select, { target: { value: InstrumentType.GUITAR } });

      expect(onInstrumentChange).toHaveBeenCalledWith(InstrumentType.GUITAR);
    });

    it('コンパクト表示で読み込み中の楽器が表示される', () => {
      render(
        <InstrumentSelector 
          {...defaultProps} 
          loadingInstruments={[InstrumentType.ORGAN]}
          compact 
        />
      );

      expect(screen.getByText('🎼 オルガン (読込中...)')).toBeInTheDocument();
    });
  });

  describe('無効化状態', () => {
    it('無効化時にボタンが無効になる', () => {
      render(<InstrumentSelector {...defaultProps} disabled />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      expect(button).toBeDisabled();
    });

    it('無効化時にプレビューボタンが無効になる', () => {
      render(<InstrumentSelector {...defaultProps} disabled />);

      const previewButton = screen.getByRole('button', { name: 'ピアノをプレビュー' });
      expect(previewButton).toBeDisabled();
    });

    it('無効化時にドロップダウンが開かない', () => {
      render(<InstrumentSelector {...defaultProps} disabled />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('読み込み中の楽器のプレビューボタンが無効になる', async () => {
      render(
        <InstrumentSelector 
          {...defaultProps} 
          loadingInstruments={[InstrumentType.PIANO]}
        />
      );

      const previewButton = screen.getByRole('button', { name: 'ピアノをプレビュー' });
      expect(previewButton).toBeDisabled();
    });
  });

  describe('アクセシビリティ', () => {
    it('適切なARIA属性が設定されている', () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('ドロップダウン開時にaria-expandedが更新される', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toHaveAttribute('aria-expanded', 'true');
      });
    });

    it('楽器オプションに適切なrole属性が設定されている', async () => {
      render(<InstrumentSelector {...defaultProps} />);

      const button = screen.getByLabelText('現在の楽器: ピアノ');
      fireEvent.click(button);

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(4);
        
        const selectedOption = options.find(option => 
          option.getAttribute('aria-selected') === 'true'
        );
        expect(selectedOption).toBeInTheDocument();
      });
    });

    it('アイコンにaria-hiddenが設定されている', () => {
      render(<InstrumentSelector {...defaultProps} />);

      const icons = document.querySelectorAll('.instrument-icon, .dropdown-arrow');
      icons.forEach(icon => {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });
});