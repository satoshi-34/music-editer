// 再生速度（%）の正本モジュール（Issue #544）。
//
// **現状（#588 以降）: この倍率を変える UI と設定は取り下げられており、呼び出し側は
// 常に 100%（等倍）を渡す。** 「テンポだけでよい」という運用者裁定によるもので、
// モジュールを残しているのは、#544 round1 で直した終了タイマー・タイ・ペダルの
// 整合（実効テンポ系の clampEffectiveBpm）がそれ自体として正しく、将来速度を
// 復活させる場合の土台にもなるため。`clampEffectiveBpm` は今も再生経路で使われている。
//
// 「テンポ」と「再生速度」は役割が違う:
// - テンポ（BPM）は**譜面の側**の情報。♩=N や速度標語として作品に書かれ、書き出しにも乗る
// - 再生速度は**聴き方**の設定。ゆっくり聴いて確認したいときに全体を一律で伸縮させるだけで、
//   譜面・保存データ・MusicXML/MIDI 書き出しには一切影響しない
//
// 倍率の掛け方をこのモジュールへ集約しているのは、実音・ハイライト・終了タイマー・
// タイの実時間が**同じ倍率**で動く必要があるため。別々に掛けると
// 「音は半分の速さなのにハイライトだけ元の速さ」というズレが起きる。

import { MIN_BPM, MAX_BPM } from './tempoRange';

/**
 * 設定できる最小の再生速度（%）。
 * 4分の1まで落とせれば、速いパッセージの音の並びを1音ずつ確かめられる。
 */
export const MIN_PLAYBACK_SPEED_PERCENT = 25;

/**
 * 設定できる最大の再生速度（%）。
 * 2倍まで上げられれば、長い曲の通し確認を早送りで済ませられる。
 */
export const MAX_PLAYBACK_SPEED_PERCENT = 200;

/** 既定の再生速度（%）。100 は「譜面に書かれたテンポそのまま」を意味する */
export const DEFAULT_PLAYBACK_SPEED_PERCENT = 100;

/**
 * 再生速度に倍率を掛けたあとの実効テンポが取り得る下限（BPM）。
 * 譜面に書けるテンポの下限（MIN_BPM）を最遅の再生速度で伸ばした値。
 */
export const MIN_EFFECTIVE_BPM = (MIN_BPM * MIN_PLAYBACK_SPEED_PERCENT) / 100;

/** 同じく上限（BPM）。譜面に書けるテンポの上限を最速の再生速度で縮めた値 */
export const MAX_EFFECTIVE_BPM = (MAX_BPM * MAX_PLAYBACK_SPEED_PERCENT) / 100;

/**
 * 範囲外の再生速度を有効範囲へ収める（クランプする）。
 * 数値として読めない値（空欄・文字列・NaN）が来たときは fallback をそのまま返す。
 *
 * テンポ（clampBpm）と同じく「無言で元の値へ巻き戻す」のではなく端へ寄せるのは、
 * 利用者から見て「操作が効かなかった」ではなく「端まで届いた」と分かるようにするため。
 */
export function clampPlaybackSpeedPercent(percent: number, fallback: number): number {
  if (!Number.isFinite(percent)) {
    return fallback;
  }
  return Math.min(MAX_PLAYBACK_SPEED_PERCENT, Math.max(MIN_PLAYBACK_SPEED_PERCENT, percent));
}

/**
 * 1つのテンポ（BPM）へ再生速度の倍率を掛ける。
 *
 * 100%（既定）のときは**元の値をそのまま返す**。掛け算を通すと 132 が
 * 132.00000000000003 のような値になり得て、「速度を触っていないのに従来と
 * 少しだけ違う再生になる」回帰を生むため（受入条件3の「100% で従来と同一」）。
 */
export function applyPlaybackSpeedToBpm(bpm: number, percent: number): number {
  const safePercent = clampPlaybackSpeedPercent(percent, DEFAULT_PLAYBACK_SPEED_PERCENT);
  if (safePercent === DEFAULT_PLAYBACK_SPEED_PERCENT) {
    return bpm;
  }
  return (bpm * safePercent) / 100;
}

/**
 * 小節ごとのテンポ列（resolveScoreMeasureBpms の結果）へ、まとめて倍率を掛ける。
 *
 * 全小節へ同じ倍率を掛けるだけなので、速度標語（Allegro 等）や途中テンポ変更で
 * 付いた**小節間の相対関係はそのまま保たれる**（受入条件1）。
 */
export function applyPlaybackSpeedToBpms(bpms: readonly number[], percent: number): number[] {
  const safePercent = clampPlaybackSpeedPercent(percent, DEFAULT_PLAYBACK_SPEED_PERCENT);
  if (safePercent === DEFAULT_PLAYBACK_SPEED_PERCENT) {
    return [...bpms];
  }
  return bpms.map((bpm) => applyPlaybackSpeedToBpm(bpm, safePercent));
}

/**
 * 「再生に実際に使うテンポ」として妥当な範囲へ収める。
 *
 * `clampBpm`（30〜240）は**譜面に書けるテンポ**の範囲なので、再生速度を掛けたあとの
 * 実効テンポ（例: ♩=200 を 200% で聴く＝400）をそのまま通すと端へ丸められ、
 * 「速度を上げても途中から速くならない」ことになる。ここでは倍率込みの範囲で受け止め、
 * 壊れた値（0・NaN）だけを弾く役目を引き継ぐ。
 */
export function clampEffectiveBpm(bpm: number, fallback: number): number {
  if (!Number.isFinite(bpm)) {
    return fallback;
  }
  return Math.min(MAX_EFFECTIVE_BPM, Math.max(MIN_EFFECTIVE_BPM, bpm));
}
