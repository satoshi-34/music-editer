// src/utils/tempoMarkingPresets.ts
// テンポ表記（速度標語）の定番セット。入力欄の候補としてのみ使う補助データで、
// 自由入力を制限するものではない（Issue #457）。

/**
 * 定番の速度標語（遅い順）。
 *
 * 入力欄の候補（datalist）として出す用途だけを想定している。
 * 「候補は補助であり制約にしない」という方針なので、ここに無い語も従来どおり自由に入力できる。
 * 順番は音楽の慣習どおり「遅い → 速い」で並べてある（辞書順に並べ替えると
 * Adagio と Allegro が隣り合ってしまい、選ぶときにかえって迷うため）。
 */
export const TEMPO_MARKING_PRESETS = [
  'Grave',
  'Largo',
  'Lento',
  'Adagio',
  'Andante',
  'Andantino',
  'Moderato',
  'Allegretto',
  'Allegro',
  'Vivace',
  'Presto',
  'Prestissimo',
] as const;

/**
 * 入力欄（input）と候補リスト（datalist）を結ぶための id。
 * HTML の `list` 属性は id 参照なので、両者で同じ文字列を使う必要がある。
 */
export const TEMPO_MARKING_DATALIST_ID = 'tempo-marking-presets';
