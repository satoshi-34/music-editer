// src/components/PlaybackControlsPanelOrganization.test.tsx
// 「再生・音色」タブの整理（Issue #562・設計メモ toolbar-organization §3(a)(b)(c)）のテスト。
//
// 固定したい仕様:
//   (a) 診断（音声復旧・最小テスト音）は常設をやめ、折りたたみの中へ。通知から1クリックで開ける
//   (b) 音色詳細の中は「音源」「音づくり」の2見出し。開閉は localStorage で覚える
//   (c) タブは「トランスポート / テンポ・位置 / 音」の3区画に分ける

import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PlaybackControls, { type PlaybackControlsProps } from './PlaybackControls';
import { InstrumentType } from '../audio/SoundSource';
import { DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS } from '../audio/playbackSettings';
import { PLAYBACK_PANEL_SECTION_KEYS } from '../utils/playbackPanelSections';

const baseProps: PlaybackControlsProps = {
  playbackState: 'stopped',
  currentPosition: { measureIndex: 0, beatPosition: 0, noteIndex: 0 },
  currentTempo: 120,
  currentInstrument: InstrumentType.PIANO,
  availableInstruments: [InstrumentType.PIANO, InstrumentType.ORGAN],
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onStop: vi.fn(),
  onSeek: vi.fn(),
  onTempoChange: vi.fn(),
  onInstrumentChange: vi.fn(),
  onInstrumentPreview: vi.fn(),
  onAudioRecovery: vi.fn(),
  onEmergencyBeep: vi.fn(),
  onSoundProfileChange: vi.fn(),
  onPlayFromMeasure: vi.fn(),
  soundRuntimeSettings: DEFAULT_PLAYBACK_SOUND_RUNTIME_SETTINGS,
};

/** 折りたたみの開閉は localStorage に残るので、テストごとに新品の状態から始める */
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('再生・音色タブ: 診断の集約（#562 案a）', () => {
  it('音声復旧と最小テスト音は常設されず、「音の調子がおかしいとき」を開くと出る', () => {
    render(<PlaybackControls {...baseProps} />);

    expect(screen.queryByRole('button', { name: '音声復旧' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '最小テスト音' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /音の調子がおかしいとき/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '音声復旧' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小テスト音' })).toBeInTheDocument();
    // 切り分けの第一歩なので、実際に鳴っている音源方式も一緒に出す
    // （既定は SoundFont。#551 で内蔵音源から変更された）
    expect(screen.getByText(/現在の音源方式: /)).toHaveTextContent('SoundFont（楽器サンプル再生）');
  });

  it('診断の中身が1つも無いときは折りたたみ自体を出さない（空振りさせない）', () => {
    render(<PlaybackControls {...baseProps} onAudioRecovery={undefined} onEmergencyBeep={undefined} />);

    expect(screen.queryByRole('button', { name: /音の調子がおかしいとき/ })).not.toBeInTheDocument();
  });

  it('無音検知の通知から1クリックで診断が開き、先頭のボタンへフォーカスが移る', () => {
    render(<PlaybackControls {...baseProps} audioHealthNotice="音声出力の異常が続いています。" />);

    // 通知が出ている間だけ現れる導線を1回押すだけで、診断が開くこと
    fireEvent.click(screen.getByRole('button', { name: '音の調子がおかしいときの操作を開く' }));

    const recoveryButton = screen.getByRole('button', { name: '音声復旧' });
    expect(recoveryButton).toBeInTheDocument();
    expect(document.activeElement).toBe(recoveryButton);
  });

  it('通知が無いときは診断への導線ボタンを出さない', () => {
    render(<PlaybackControls {...baseProps} />);

    expect(screen.queryByRole('button', { name: '音の調子がおかしいときの操作を開く' })).not.toBeInTheDocument();
  });
});

describe('再生・音色タブ: 音色詳細の2見出し（#562 案b）', () => {
  it('音色詳細の中が「音源」と「音づくり」に分かれ、それぞれ畳める', () => {
    render(<PlaybackControls {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: '音色詳細を開く' }));

    // 既定では両方開いている（見出しを入れたせいで既存のスライダーが隠れないこと）
    expect(screen.getByLabelText('音源方式')).toBeInTheDocument();
    expect(screen.getByLabelText('音の明るさ')).toBeInTheDocument();

    // 「音源」だけ畳んでも「音づくり」は残る
    fireEvent.click(screen.getByRole('button', { name: /^音源/ }));
    expect(screen.queryByLabelText('音源方式')).not.toBeInTheDocument();
    expect(screen.getByLabelText('音の明るさ')).toBeInTheDocument();

    // 「音づくり」も畳める（4スライダー・スウィング・確認音がまとめて隠れる）
    fireEvent.click(screen.getByRole('button', { name: /^音づくり/ }));
    expect(screen.queryByLabelText('音の明るさ')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('スウィング再生')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('臨時記号適用時に確認音を鳴らす')).not.toBeInTheDocument();
  });

  it('開閉の状態を localStorage に覚え、開き直しても再現する', () => {
    const { unmount } = render(<PlaybackControls {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: '音色詳細を開く' }));
    fireEvent.click(screen.getByRole('button', { name: /^音づくり/ }));

    expect(localStorage.getItem(PLAYBACK_PANEL_SECTION_KEYS.soundDetail)).toBe('true');
    expect(localStorage.getItem(PLAYBACK_PANEL_SECTION_KEYS.soundDesign)).toBe('false');

    unmount();
    render(<PlaybackControls {...baseProps} />);

    // 音色詳細は開いたまま・音づくりは畳んだままで復元される
    expect(screen.getByRole('button', { name: '音色詳細を閉じる' })).toBeInTheDocument();
    expect(screen.getByLabelText('音源方式')).toBeInTheDocument();
    expect(screen.queryByLabelText('音の明るさ')).not.toBeInTheDocument();
  });
});

describe('音色詳細の2見出しのセマンティクス（#562 round2 P2）', () => {
  it('音源・音づくりが見出しとして公開され、パネルは名前付きグループになる', () => {
    render(<PlaybackControls {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '音色詳細を開く' }));

    // 見出しナビゲーションで拾える（role=heading）
    expect(screen.getByRole('heading', { level: 4, name: /^音源/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /^音づくり/ })).toBeInTheDocument();
    // パネルは見出しを名前に持つ group（generic の div では名前が成立しない）
    expect(screen.getByRole('group', { name: /^音源/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^音づくり/ })).toBeInTheDocument();
  });
});

describe('再生・音色タブ: 3区画レイアウト（#562 案c）', () => {
  it('トランスポート / テンポ・位置 / 音 の3区画に分かれ、要素がそれぞれの区画に入る', () => {
    render(<PlaybackControls {...baseProps} totalMeasureCount={8} />);

    const transport = screen.getByRole('region', { name: 'トランスポート' });
    expect(within(transport).getByRole('button', { name: '再生' })).toBeInTheDocument();
    expect(within(transport).getByRole('button', { name: '停止' })).toBeInTheDocument();

    const tempo = screen.getByRole('region', { name: 'テンポ・位置' });
    expect(within(tempo).getByLabelText('テンポ（BPM）')).toBeInTheDocument();
    // 再生速度（%）は #588 で撤去済み。区画整理で紛れて復活していないことを固定する
    expect(within(tempo).queryByLabelText('再生速度（%）')).toBeNull();
    expect(within(tempo).getByLabelText('再生を開始する小節番号')).toBeInTheDocument();
    expect(within(tempo).getByText(/1小節目 1音符目/)).toBeInTheDocument();

    const sound = screen.getByRole('region', { name: '音' });
    expect(within(sound).getByLabelText('楽器選択')).toBeInTheDocument();
    expect(within(sound).getByRole('button', { name: '音色プレビュー' })).toBeInTheDocument();
    expect(within(sound).getByLabelText('再生音量')).toBeInTheDocument();
    expect(within(sound).getByRole('button', { name: '音色詳細を開く' })).toBeInTheDocument();
    expect(within(sound).getByRole('button', { name: /音の調子がおかしいとき/ })).toBeInTheDocument();
  });

  it('常設のボタンは9個ぶんの入口に収まる（診断2個を折りたたみ1個へ集約した効果）', () => {
    render(<PlaybackControls {...baseProps} totalMeasureCount={8} />);

    // 「常設」＝タブを開いた直後に見えている操作。#547 段0 の数え方（利用者がクリックできる要素）に合わせ、
    // 折りたたみの中身は数えない。診断2個が折りたたみ1個になったぶんだけ減る
    const alwaysVisible = screen.getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent);
    expect(alwaysVisible).not.toContain('音声復旧');
    expect(alwaysVisible).not.toContain('最小テスト音');
    expect(alwaysVisible).toContain('音色詳細を開く');
    expect(alwaysVisible.some(name => name?.includes('音の調子がおかしいとき'))).toBe(true);
  });
});
