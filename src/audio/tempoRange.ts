// 再生テンポ（BPM）の有効範囲を1箇所にまとめたモジュール。
//
// 以前は PlaybackControls の入力欄・スライダー・TempoManager の検証が
// それぞれ 60〜200 を直書きしていたため、片方だけ広げると
// 「入力欄では入るのに保存で弾かれる」という食い違いが起きる形になっていた（Issue #240）。
// 範囲を変えるときは必ずこのファイルの2つの定数だけを触ること。

/**
 * 設定できる最小の BPM。
 * Grave（♩=40 前後）や Adagio sostenuto（月光第1楽章・♩=50 台）を
 * 下回っても余裕があるように 30 まで許す。
 */
export const MIN_BPM = 30;

/**
 * 設定できる最大の BPM。
 * Prestissimo（♩=200 超）まで届くように 240 とする。
 * 途中テンポ変更（measureMetaInputUtils.parseBpmInput）の上限とも揃えている。
 */
export const MAX_BPM = 240;

/**
 * 範囲外の値を有効範囲へ収める（クランプする）。
 * 数値でない値（空欄・文字列など）が来た場合は fallback をそのまま返す。
 *
 * 「無言で元の値に巻き戻す」のではなく端の値へ寄せるのは、
 * 利用者から見て「入力が効かなかった」ではなく「端まで届いた」と分かるようにするため。
 */
export function clampBpm(bpm: number, fallback: number): number {
  if (!Number.isFinite(bpm)) {
    return fallback;
  }
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** 範囲外の値を入れたときに画面へ出す案内文 */
export const TEMPO_RANGE_MESSAGE = `テンポは${MIN_BPM}〜${MAX_BPM}の範囲で設定してください`;
