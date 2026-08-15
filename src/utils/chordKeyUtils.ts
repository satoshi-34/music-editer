// 和音（1つの NoteEvent が持つ keys 配列）の「同じ音が重なっている状態」を扱うための共通処理。
//
// なぜ必要か（Issue #281）:
// 同じ音高の符頭は画面上で完全に重なって1つに見えるため、利用者は重複に気づけない。
// 消したつもりの音が片方だけ残って「見た目が変わらない」ので、操作を重ねて別の事故を招く。
// クリックでの和音追加には昔から同音ガード（!keys.includes(newKey)）があったが、
// 矢印キーでの音高移動と、過去に重複が入ってしまった保存データには手当てが無かった。
//
// このファイルは「重複かどうかの判定」と「1音を取り除くときの後始末」だけを持つ純粋な関数の置き場で、
// 実際にどこで使うかは pitchShiftUtils（矢印キー移動）と storage / fileStorage（読込時の正規化）が決める。

import type { MeasureData, NoteEvent, PartData } from '../types/storage';

/** NoteEvent.microtones の1件ぶん（四分音の臨時記号は「和音の何番目の音に付くか」で持っている）。 */
type MicrotoneMark = NonNullable<NoteEvent['microtones']>[number];

/**
 * 和音の index 番目の音を「同じ音かどうか」で見分けるための識別子を作る。
 *
 * 音高の文字列（"a/3" など）だけでなく四分音（微分音）の有無まで含めるのは、
 * 同じ "a/3" でも片方に quarterSharp が付いていれば **鳴る高さが違う別の音**だからである。
 * ここを音高だけで比べると、四分音付きの音を素の音へ黙って吸収して消してしまう。
 */
function keyIdentity(keys: string[], microtones: MicrotoneMark[] | undefined, index: number): string {
  const microtone = microtones?.find((m) => m.keyIndex === index)?.type ?? '';
  return `${keys[index]}|${microtone}`;
}

/**
 * keys[index] とまったく同じ音（音高＋四分音）が他の位置にあるかを探す。
 *
 * @returns 見つかった位置。無ければ -1。複数あるときは最初に見つかった位置を返す。
 */
export function findDuplicateKeyIndex(
  keys: string[],
  microtones: MicrotoneMark[] | undefined,
  index: number
): number {
  if (index < 0 || index >= keys.length) return -1;
  const target = keyIdentity(keys, microtones, index);
  for (let i = 0; i < keys.length; i += 1) {
    if (i !== index && keyIdentity(keys, microtones, i) === target) return i;
  }
  return -1;
}

/**
 * 和音から1音を取り除いたときに、四分音の付き先（keyIndex）を新しい並びへ合わせ直す。
 *
 * microtones は「keys 配列の何番目か」で音を指しているため、keys から要素を1つ抜くと
 * それより後ろの臨時記号がすべて1つ隣の音へずれてしまう。取り除いた音に付いていた記号は捨て、
 * 後ろの記号は index を1つ繰り上げる。
 *
 * @returns 変化が無ければ引数をそのまま返す。結果が空になる場合は undefined（フィールドごと省く）。
 */
export function remapMicrotonesAfterKeyRemoval(
  microtones: MicrotoneMark[] | undefined,
  removedIndex: number
): MicrotoneMark[] | undefined {
  if (!microtones?.length) return microtones;
  const next = microtones
    .filter((m) => m.keyIndex !== removedIndex)
    .map((m) => (m.keyIndex > removedIndex ? { ...m, keyIndex: m.keyIndex - 1 } : m));
  if (next.length === microtones.length && next.every((m, i) => m === microtones[i])) return microtones;
  return next.length ? next : undefined;
}

/**
 * 和音の重複した音を1つに畳む（先に出てきた音を残す）。
 *
 * 休符は対象外。休符の keys は「音の高さ」ではなく画面上の置き場所を表しているだけで、
 * 重複を畳む意味が無いため。
 *
 * @returns 重複が無ければ引数のイベントをそのまま返す（参照が変わらないので、
 *   呼び出し側は「変わったかどうか」を === で判定できる）。
 */
export function dedupeChordKeys(ev: NoteEvent): NoteEvent {
  if (ev.isRest || ev.keys.length < 2) return ev;

  let keys = ev.keys;
  let microtones = ev.microtones;
  let changed = false;
  // 前から順に見て、すでに出てきた音と同じものを見つけたらその場で取り除く。
  // 取り除くと後ろの位置が1つずつ詰まるので、i は進めずに同じ位置をもう一度見る。
  for (let i = 0; i < keys.length; ) {
    const duplicateOf = findDuplicateKeyIndex(keys, microtones, i);
    if (duplicateOf >= 0 && duplicateOf < i) {
      microtones = remapMicrotonesAfterKeyRemoval(microtones, i);
      keys = keys.filter((_, keyIdx) => keyIdx !== i);
      changed = true;
      continue;
    }
    i += 1;
  }
  if (!changed) return ev;

  const next: NoteEvent = { ...ev, keys };
  if (microtones?.length) next.microtones = microtones;
  else delete next.microtones;
  return next;
}

/** 1声部ぶんのイベント列を正規化する。変化が無ければ引数の配列をそのまま返す。 */
function dedupeEvents(events: NoteEvent[]): NoteEvent[] {
  const next = events.map(dedupeChordKeys);
  return next.some((ev, i) => ev !== events[i]) ? next : events;
}

/** 1小節ぶんを正規化する。声部2以降（voices）も同じ規則で畳む。 */
function dedupeMeasure(measure: MeasureData): MeasureData {
  const events = dedupeEvents(measure.events ?? []);
  const voices = measure.voices?.map((voice) => {
    const voiceEvents = dedupeEvents(voice.events ?? []);
    return voiceEvents === voice.events ? voice : { ...voice, events: voiceEvents };
  });
  const voicesChanged = !!voices && voices.some((v, i) => v !== measure.voices![i]);
  if (events === measure.events && !voicesChanged) return measure;
  return { ...measure, events, ...(voices ? { voices } : {}) };
}

/**
 * 保存データ（全パート）の和音から同音の重複を取り除く。読込時の正規化として使う。
 *
 * 弧（タイ/スラー）は fromKey / toKey という**音高の文字列**で符頭を指しているので、
 * 重複を畳んでも参照先の音高は残ったままになり、リンクは切れない
 * （["a/3","a/3"] → ["a/3"] なので "a/3" を指す弧はそのまま有効）。
 *
 * @returns 変化が無ければ引数の配列をそのまま返す。
 */
export function normalizeDuplicateChordKeys(parts: PartData[]): PartData[] {
  const next = parts.map((part) => {
    const measures = part.measures.map(dedupeMeasure);
    return measures.some((m, i) => m !== part.measures[i]) ? { ...part, measures } : part;
  });
  return next.some((part, i) => part !== parts[i]) ? next : parts;
}
