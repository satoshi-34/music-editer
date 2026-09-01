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

/** テンポ未保存の作品・壊れた保存値のときに使う既定テンポ（再生パネルの初期値と同じ） */
export const DEFAULT_GLOBAL_BPM = 120;

/**
 * 保存データ（`SavedScoreData.globalBpm`）から読んだ全体テンポを正規化する（Issue #543）。
 *
 * 「テンポとして使える数値か」の判定と範囲寄せをここに1本化する。
 * 壊れた値（欠落・文字列・NaN・0 以下）は `undefined` を返し、呼び出し側は
 * 「テンポ未保存の作品」＝従来どおりアプリ全体設定に従う、として扱う。
 * 0 を素通しすると `60 / 0 = Infinity` で再生が進まなくなるため、
 * clampBpm（有限な数はすべて範囲へ寄せる＝0 は 30 になる）に渡す前に弾く必要がある。
 */
export function normalizeSavedGlobalBpm(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return clampBpm(value, DEFAULT_GLOBAL_BPM);
}

/** 範囲外の値を入れたときに画面へ出す案内文 */
export const TEMPO_RANGE_MESSAGE = `テンポは${MIN_BPM}〜${MAX_BPM}の範囲で設定してください`;
