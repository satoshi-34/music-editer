// src/utils/playbackPanelSections.ts
// 「再生・音色」タブの折りたたみ（開閉）状態の記憶（Issue #562・設計メモ toolbar-organization §3(b)）。
//
// なぜ純関数として切り出すのか:
// 「保存値の読み書き」「壊れた値のときに既定へ戻す」を PlaybackControls の中へ直接書くと、
// ブラウザを立ち上げないと確かめられない。ここに出しておけば単体テストで仕様を固定できる
// （localStorage を触る他の表示設定＝ toolbarPlacement.ts と同じ方針）。

/** 開閉状態を覚える折りたたみの種類 */
export type PlaybackPanelSectionId =
  /** 「音色詳細」全体 */
  | 'soundDetail'
  /** 音色詳細の中の「音源」（方式・パック名） */
  | 'soundSource'
  /** 音色詳細の中の「音づくり」（4スライダー・スウィング・確認音） */
  | 'soundDesign';

/** 記憶用の localStorage キー。他の表示設定と同じ `score-` 接頭辞にそろえる。 */
export const PLAYBACK_PANEL_SECTION_KEYS: Record<PlaybackPanelSectionId, string> = {
  soundDetail: 'score-playback-sound-detail-open',
  soundSource: 'score-playback-sound-source-open',
  soundDesign: 'score-playback-sound-design-open',
};

/**
 * 保存値が無いときの既定。
 * 「音色詳細」は従来どおり閉じた状態で始め、中の2見出しは開いた状態にする
 * （見出しを入れたせいで、これまで見えていたスライダーが初回から隠れるのを避けるため）。
 */
export const DEFAULT_PLAYBACK_PANEL_SECTION_OPEN: Record<PlaybackPanelSectionId, boolean> = {
  soundDetail: false,
  soundSource: true,
  soundDesign: true,
};

/**
 * 記憶している開閉状態を読む。
 * localStorage が使えない環境（プライベートブラウジング等）や、
 * 'true' / 'false' 以外の壊れた値が入っていても例外を投げずに既定値を返す。
 */
export function loadPlaybackPanelSectionOpen(sectionId: PlaybackPanelSectionId): boolean {
  try {
    const raw = localStorage.getItem(PLAYBACK_PANEL_SECTION_KEYS[sectionId]);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return DEFAULT_PLAYBACK_PANEL_SECTION_OPEN[sectionId];
  } catch {
    return DEFAULT_PLAYBACK_PANEL_SECTION_OPEN[sectionId];
  }
}

/** 開閉状態を記憶する。保存に失敗しても致命的ではないので握りつぶす。 */
export function savePlaybackPanelSectionOpen(sectionId: PlaybackPanelSectionId, open: boolean): void {
  try {
    localStorage.setItem(PLAYBACK_PANEL_SECTION_KEYS[sectionId], open ? 'true' : 'false');
  } catch {
    // quota超過・プライベートブラウジング等。今回の表示だけ切り替わっていればよい
  }
}
