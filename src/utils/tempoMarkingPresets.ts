// src/utils/tempoMarkingPresets.ts
// テンポ表記（速度標語）の定番セット。入力欄の候補としてのみ使う補助データで、
// 自由入力を制限するものではない（Issue #457）。
// Issue #458 からは「標語ごとの目安 BPM」もここに持たせ、再生テンポの正本にしている。

/**
 * 定番の速度標語と、その目安 BPM（遅い順）。
 *
 * 用途は2つある。
 * 1. 入力欄の候補（datalist）として出す（#457）
 * 2. 再生テンポへ翻訳する（#458。`tempoPlaybackUtils.resolveMeasureBpms` が参照する）
 *
 * 「候補は補助であり制約にしない」という方針なので、ここに無い語も従来どおり自由に入力できる
 * （その場合は表示だけで、再生テンポは変わらない）。
 * 順番は音楽の慣習どおり「遅い → 速い」で並べてある（辞書順に並べ替えると
 * Adagio と Allegro が隣り合ってしまい、選ぶときにかえって迷うため）。
 *
 * BPM は各標語の慣用的なテンポ範囲の代表値（真ん中あたり）を採った。
 * 厳密な定義は流派・時代で揺れるため「目安」であり、正確さが要る場面では
 * 数値の途中テンポ変更（♩=XXX）で上書きできる（そちらが優先される）。
 * 値はすべて `tempoRange.ts` の MIN_BPM〜MAX_BPM に収まっている必要がある
 * （外れると再生時に無言でクランプされ、標語と実際の速さが食い違うため）。
 */
export const TEMPO_MARKING_PRESET_ENTRIES = [
  { term: 'Grave', bpm: 40 },
  { term: 'Largo', bpm: 50 },
  { term: 'Lento', bpm: 56 },
  { term: 'Adagio', bpm: 66 },
  { term: 'Andante', bpm: 76 },
  { term: 'Andantino', bpm: 88 },
  { term: 'Moderato', bpm: 108 },
  { term: 'Allegretto', bpm: 116 },
  { term: 'Allegro', bpm: 132 },
  { term: 'Vivace', bpm: 160 },
  { term: 'Presto', bpm: 184 },
  { term: 'Prestissimo', bpm: 200 },
] as const;

/**
 * 候補リスト（datalist）用の標語だけの配列。
 *
 * 上の対応表から**導出**している。表と候補リストを別々に書くと、
 * 片方へ標語を足したときにもう片方が置き去りになる（＝候補には出るのに
 * テンポが変わらない語が生まれる）ため、正本は1つに保つ。
 */
export const TEMPO_MARKING_PRESETS: readonly string[] =
  TEMPO_MARKING_PRESET_ENTRIES.map((entry) => entry.term);

/**
 * 入力欄（input）と候補リスト（datalist）を結ぶための id。
 * HTML の `list` 属性は id 参照なので、両者で同じ文字列を使う必要がある。
 */
export const TEMPO_MARKING_DATALIST_ID = 'tempo-marking-presets';

/**
 * 速度標語の文字列から目安 BPM を引く。対応表に無ければ null。
 *
 * 照合は「前後の空白を落とした大文字小文字無視の完全一致」。
 * `Allegro con brio` のような語を足した自由入力は、意図した速さが読み取れないため
 * あえて一致させず、表示のみに留める（Issue #458 のトリアージ裁定）。
 */
export function getTempoMarkingBpm(term: string | undefined | null): number | null {
  if (typeof term !== 'string') return null;
  const normalized = term.trim().toLowerCase();
  if (normalized === '') return null;
  const found = TEMPO_MARKING_PRESET_ENTRIES.find((entry) => entry.term.toLowerCase() === normalized);
  return found ? found.bpm : null;
}
