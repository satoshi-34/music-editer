// src/components/PlaybackControls.test.tsx
// PlaybackControlsコンポーネントのテスト

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PlaybackControls, {
  INSTRUMENT_GROUPS,
  INSTRUMENT_LABELS,
  type PlaybackControlsProps
} from './PlaybackControls';
import { InstrumentType } from '../audio/SoundSource';
import { DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS } from '../audio/playbackSettings';

// デフォルトのプロパティ
const defaultProps: PlaybackControlsProps = {
  playbackState: 'stopped',
  currentPosition: { measureIndex: 0, beatPosition: 0, noteIndex: 0 },
  currentTempo: 120,
  currentInstrument: InstrumentType.PIANO,
  availableInstruments: [
    InstrumentType.PIANO,
    InstrumentType.ORGAN,
    InstrumentType.GUITAR
  ],
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onStop: vi.fn(),
  onSeek: vi.fn(),
  onTempoChange: vi.fn(),
  onInstrumentChange: vi.fn(),
  onInstrumentPreview: vi.fn(),
  onAudioRecovery: vi.fn(),
  soundRuntimeSettings: DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS
};

describe('PlaybackControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本的なレンダリング', () => {
    it('すべての制御要素が表示される', () => {
      render(<PlaybackControls {...defaultProps} />);

      // 再生制御ボタン
      expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();

      // テンポ制御
      expect(screen.getByLabelText('テンポ（BPM）')).toBeInTheDocument();
      expect(screen.getByLabelText('テンポスライダー')).toBeInTheDocument();

      // 音色選択
      expect(screen.getByLabelText('楽器選択')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '音色プレビュー' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '音声復旧' })).toBeInTheDocument();

      // 再生位置表示（テキストが複数要素に分かれている可能性を考慮）
      expect(screen.getByText((content, element) => {
        return element?.textContent === '1小節目 1音符目';
      })).toBeInTheDocument();
    });

    it('停止状態では再生ボタンが表示される', () => {
      render(<PlaybackControls {...defaultProps} playbackState="stopped" />);
      
      const playButton = screen.getByRole('button', { name: '再生' });
      expect(playButton).toBeInTheDocument();
      expect(playButton).not.toBeDisabled();
    });

    it('再生中状態では一時停止ボタンが表示される', () => {
      render(<PlaybackControls {...defaultProps} playbackState="playing" />);
      
      const pauseButton = screen.getByRole('button', { name: '一時停止' });
      expect(pauseButton).toBeInTheDocument();
      expect(pauseButton).not.toBeDisabled();
    });

    it('一時停止状態では再開ボタンが表示される', () => {
      render(<PlaybackControls {...defaultProps} playbackState="paused" />);
      
      const resumeButton = screen.getByRole('button', { name: '再開' });
      expect(resumeButton).toBeInTheDocument();
      expect(resumeButton).not.toBeDisabled();
    });

    it('読込中状態ではボタンが無効化される', () => {
      render(<PlaybackControls {...defaultProps} playbackState="loading" />);
      
      const loadingButton = screen.getByRole('button', { name: '読込中...' });
      expect(loadingButton).toBeDisabled();
      
      const stopButton = screen.getByRole('button', { name: '停止' });
      expect(stopButton).toBeDisabled();
    });
  });

  describe('再生制御', () => {
    it('再生ボタンクリックでonPlayが呼ばれる', () => {
      const onPlay = vi.fn();
      render(<PlaybackControls {...defaultProps} onPlay={onPlay} playbackState="stopped" />);
      
      const playButton = screen.getByRole('button', { name: '再生' });
      fireEvent.click(playButton);
      
      expect(onPlay).toHaveBeenCalledTimes(1);
    });

    it('一時停止ボタンクリックでonPauseが呼ばれる', () => {
      const onPause = vi.fn();
      render(<PlaybackControls {...defaultProps} onPause={onPause} playbackState="playing" />);
      
      const pauseButton = screen.getByRole('button', { name: '一時停止' });
      fireEvent.click(pauseButton);
      
      expect(onPause).toHaveBeenCalledTimes(1);
    });

    it('停止ボタンクリックでonStopが呼ばれる', () => {
      const onStop = vi.fn();
      render(<PlaybackControls {...defaultProps} onStop={onStop} playbackState="playing" />);
      
      const stopButton = screen.getByRole('button', { name: '停止' });
      fireEvent.click(stopButton);
      
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('停止状態では停止ボタンが無効化される', () => {
      render(<PlaybackControls {...defaultProps} playbackState="stopped" />);
      
      const stopButton = screen.getByRole('button', { name: '停止' });
      expect(stopButton).toBeDisabled();
    });

  });

  describe('テンポ制御', () => {
    it('テンポ入力フィールドに現在のテンポが表示される', () => {
      render(<PlaybackControls {...defaultProps} currentTempo={140} />);
      
      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
      expect(tempoInput.value).toBe('140');
    });

    it('テンポ入力の変更とブラーでonTempoChangeが呼ばれる', async () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} onTempoChange={onTempoChange} />);
      
      const tempoInput = screen.getByLabelText('テンポ（BPM）');
      
      // 値を変更
      fireEvent.change(tempoInput, { target: { value: '150' } });
      
      // フォーカスを外す
      fireEvent.blur(tempoInput);
      
      await waitFor(() => {
        expect(onTempoChange).toHaveBeenCalledWith(150);
      });
    });

    // Issue #240: 下限が 60 だったため、月光（♩=50台）のような遅い曲が設定できず、
    // しかも範囲外の入力が何の説明もなく巻き戻っていた。
    it('♩=56（旧下限の60未満）を入力すると保持され、onTempoChange に渡る', async () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} currentTempo={99} onTempoChange={onTempoChange} />);

      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;

      fireEvent.change(tempoInput, { target: { value: '56' } });
      fireEvent.blur(tempoInput);

      await waitFor(() => {
        expect(onTempoChange).toHaveBeenCalledWith(56);
      });
      expect(tempoInput.value).toBe('56');
    });

    it('新しい範囲の両端（30 / 240）をそのまま設定できる', async () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} onTempoChange={onTempoChange} />);

      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;

      fireEvent.change(tempoInput, { target: { value: '30' } });
      fireEvent.blur(tempoInput);
      await waitFor(() => {
        expect(onTempoChange).toHaveBeenCalledWith(30);
      });

      fireEvent.change(tempoInput, { target: { value: '240' } });
      fireEvent.blur(tempoInput);
      await waitFor(() => {
        expect(onTempoChange).toHaveBeenCalledWith(240);
      });
    });

    it('範囲を下回る値は下限へクランプされ、案内が表示される', async () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} currentTempo={120} onTempoChange={onTempoChange} />);

      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;

      fireEvent.change(tempoInput, { target: { value: '10' } });
      fireEvent.blur(tempoInput);

      await waitFor(() => {
        expect(tempoInput.value).toBe('30');
      });
      expect(onTempoChange).toHaveBeenCalledWith(30);
      expect(screen.getByRole('status')).toHaveTextContent('テンポは30〜240の範囲で設定してください（30 に合わせました）');
    });

    it('範囲を上回る値は上限へクランプされ、案内が表示される', async () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} currentTempo={120} onTempoChange={onTempoChange} />);

      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;

      fireEvent.change(tempoInput, { target: { value: '300' } });
      fireEvent.blur(tempoInput);

      await waitFor(() => {
        expect(tempoInput.value).toBe('240');
      });
      expect(onTempoChange).toHaveBeenCalledWith(240);
      expect(screen.getByRole('status')).toHaveTextContent('テンポは30〜240の範囲で設定してください（240 に合わせました）');
    });

    it('数字として読めない入力は元の値に戻り、案内が表示される', async () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} currentTempo={120} onTempoChange={onTempoChange} />);

      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;

      fireEvent.change(tempoInput, { target: { value: '' } });
      fireEvent.blur(tempoInput);

      await waitFor(() => {
        expect(tempoInput.value).toBe('120');
      });
      expect(onTempoChange).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent('テンポは30〜240の範囲で設定してください');
    });

    it('範囲内の値では案内が出ない', async () => {
      render(<PlaybackControls {...defaultProps} currentTempo={120} />);

      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;

      fireEvent.change(tempoInput, { target: { value: '56' } });
      fireEvent.blur(tempoInput);

      await waitFor(() => {
        expect(tempoInput.value).toBe('56');
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('入力欄とスライダーの許容範囲が一致する', () => {
      render(<PlaybackControls {...defaultProps} />);

      const tempoInput = screen.getByLabelText('テンポ（BPM）') as HTMLInputElement;
      const tempoSlider = screen.getByLabelText('テンポスライダー') as HTMLInputElement;

      expect(tempoInput.min).toBe('30');
      expect(tempoInput.max).toBe('240');
      expect(tempoSlider.min).toBe(tempoInput.min);
      expect(tempoSlider.max).toBe(tempoInput.max);
    });

    it('Enterキーでテンポ入力が確定される', () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} onTempoChange={onTempoChange} />);
      
      const tempoInput = screen.getByLabelText('テンポ（BPM）');
      
      fireEvent.change(tempoInput, { target: { value: '130' } });
      fireEvent.keyDown(tempoInput, { key: 'Enter' });
      
      // Enterキーでblurが発生することを確認
      expect(document.activeElement).not.toBe(tempoInput);
    });

    it('テンポスライダーの変更でonTempoChangeが呼ばれる', () => {
      const onTempoChange = vi.fn();
      render(<PlaybackControls {...defaultProps} onTempoChange={onTempoChange} />);
      
      const tempoSlider = screen.getByLabelText('テンポスライダー');
      fireEvent.change(tempoSlider, { target: { value: '160' } });
      
      expect(onTempoChange).toHaveBeenCalledWith(160);
    });
  });

  describe('音色制御', () => {
    it('音色選択に利用可能な楽器が表示される', () => {
      render(<PlaybackControls {...defaultProps} />);
      
      expect(screen.getByLabelText('楽器選択')).toBeInTheDocument();

      // オプションが正しく表示されることを確認
      expect(screen.getByRole('option', { name: 'ピアノ' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'オルガン' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'ギター' })).toBeInTheDocument();
    });

    it('クラリネットを木管グループの音色として表示できる', () => {
      const woodwindGroup = INSTRUMENT_GROUPS.find(group => group.label === '木管');

      expect(INSTRUMENT_LABELS[InstrumentType.CLARINET]).toBe('クラリネット');
      expect(woodwindGroup?.instruments).toContain(InstrumentType.CLARINET);

      render(
        <PlaybackControls
          {...defaultProps}
          currentInstrument={InstrumentType.CLARINET}
          availableInstruments={[InstrumentType.CLARINET]}
        />
      );

      const instrumentSelect = screen.getByLabelText('楽器選択') as HTMLSelectElement;
      expect(screen.getByRole('option', { name: 'クラリネット' })).toBeInTheDocument();
      expect(instrumentSelect.value).toBe(InstrumentType.CLARINET);
    });

    it('現在の楽器が選択されている', () => {
      render(<PlaybackControls {...defaultProps} currentInstrument={InstrumentType.ORGAN} />);
      
      const instrumentSelect = screen.getByLabelText('楽器選択') as HTMLSelectElement;
      expect(instrumentSelect.value).toBe(InstrumentType.ORGAN);
    });

    it('音色選択の変更でonInstrumentChangeが呼ばれる', () => {
      const onInstrumentChange = vi.fn();
      render(<PlaybackControls {...defaultProps} onInstrumentChange={onInstrumentChange} />);
      
      const instrumentSelect = screen.getByLabelText('楽器選択');
      fireEvent.change(instrumentSelect, { target: { value: InstrumentType.GUITAR } });
      
      expect(onInstrumentChange).toHaveBeenCalledWith(InstrumentType.GUITAR);
    });

    it('音声復旧ボタンのクリックでonAudioRecoveryが呼ばれる', () => {
      const onAudioRecovery = vi.fn();
      render(<PlaybackControls {...defaultProps} onAudioRecovery={onAudioRecovery} />);

      const recoveryButton = screen.getByRole('button', { name: '音声復旧' });
      fireEvent.click(recoveryButton);

      expect(onAudioRecovery).toHaveBeenCalledTimes(1);
    });

    it('音色プレビューボタンクリックでonInstrumentPreviewが呼ばれる', () => {
      const onInstrumentPreview = vi.fn();
      render(<PlaybackControls {...defaultProps} onInstrumentPreview={onInstrumentPreview} />);
      
      const previewButton = screen.getByRole('button', { name: '音色プレビュー' });
      fireEvent.click(previewButton);
      
      expect(onInstrumentPreview).toHaveBeenCalledWith(InstrumentType.PIANO);
    });

    it('onInstrumentPreviewが未定義の場合プレビューボタンが表示されない', () => {
      render(<PlaybackControls {...defaultProps} onInstrumentPreview={undefined} />);
      
      expect(screen.queryByRole('button', { name: '音色プレビュー' })).not.toBeInTheDocument();
    });
  });

  describe('SoundFontパック名の説明文（Issue #551）', () => {
    it('音色詳細を開くと MusyngKite 推奨の一言が説明文に出る', () => {
      render(<PlaybackControls {...defaultProps} />);

      // 説明文は「音色詳細」の中にあるので、まず開いてから確認する
      fireEvent.click(screen.getByRole('button', { name: '音色詳細を開く' }));

      // タグ構造に依存せず、推奨文そのものの存在を見る（round1 P3:
      // 「子要素なしの DIV」条件は <p> 化や強調 <span> の追加で壊れる）
      expect(screen.getByText(/ピアノの長い音/)).toHaveTextContent('迷ったら `MusyngKite` を推奨します。');

      // 説明文の追記だけで、パック名の入力欄（UI 構造）は増減していない
      expect(screen.getAllByLabelText('SoundFontパック名')).toHaveLength(1);
    });
  });

  describe('再生位置表示', () => {
    it('現在の再生位置が正しく表示される', () => {
      const position = { measureIndex: 2, beatPosition: 1.5, noteIndex: 3 };
      render(<PlaybackControls {...defaultProps} currentPosition={position} />);
      
      // テキストが複数の要素に分かれている可能性があるため、部分的にマッチ
      expect(screen.getByText((content, element) => {
        return element?.textContent === '3小節目 4音符目';
      })).toBeInTheDocument();
    });

    it('再生位置の変更が反映される', () => {
      const { rerender } = render(<PlaybackControls {...defaultProps} />);
      
      expect(screen.getByText((content, element) => {
        return element?.textContent === '1小節目 1音符目';
      })).toBeInTheDocument();
      
      const newPosition = { measureIndex: 1, beatPosition: 0, noteIndex: 2 };
      rerender(<PlaybackControls {...defaultProps} currentPosition={newPosition} />);
      
      expect(screen.getByText((content, element) => {
        return element?.textContent === '2小節目 3音符目';
      })).toBeInTheDocument();
    });
  });

  describe('アクセシビリティ', () => {
    it('すべてのボタンに適切なaria-labelが設定されている', () => {
      render(<PlaybackControls {...defaultProps} />);
      
      expect(screen.getByLabelText('再生')).toBeInTheDocument();
      expect(screen.getByLabelText('停止')).toBeInTheDocument();
      expect(screen.getByLabelText('テンポ（BPM）')).toBeInTheDocument();
      expect(screen.getByLabelText('テンポスライダー')).toBeInTheDocument();
      expect(screen.getByLabelText('楽器選択')).toBeInTheDocument();
      expect(screen.getByLabelText('音色プレビュー')).toBeInTheDocument();
    });

    it('ボタンアイコンにaria-hiddenが設定されている', () => {
      render(<PlaybackControls {...defaultProps} />);
      
      const icons = document.querySelectorAll('.button-icon');
      icons.forEach(icon => {
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });
});
