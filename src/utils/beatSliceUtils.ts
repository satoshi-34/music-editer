// 拍範囲スライス（部分コピペ 段2・Issue #333）の純関数層。
// 設計は .claude/specs/partial-copy-paste/design.md 段2 を正本とする。
//
// このファイルは「1つの小節セグメント（segStart〜segEnd 拍）× 1声部のイベント列」を
// 単位に扱う。小節またぎ・全パート束ねは呼び出し側（ScorePage）が
// 「端の小節は部分・中の小節は全体」の規則でセグメントに割ってから呼ぶ。
import type { MeasureData, NoteEvent } from '../types/storage';
import { getMeasureVoices, getEventDurationBeats } from './voiceMeasureUtils';

const EPS = 0.0001;

/**
 * スライス境界の候補（拍）を返す。
 *
 * 候補 = 「その小節の**全パート・全声部**がそこで切れる拍」∪ {0, beatsPerMeasure}。
 * さらに連符グループの内部（開始〜終了の間）は除外する（グループを割る選択を作らない）。
 * 共通境界が 0 と小節末しか無い小節では、実質「小節丸ごと」へスナップされる（安全側）。
 *
 * @param measuresAcrossParts 同じ小節番号の小節を全パートぶん並べた配列
 */
export function sliceBoundaryCandidates(
  measuresAcrossParts: Array<MeasureData | undefined>,
  beatsPerMeasure: number,
): number[] {
  // 各声部の「イベントが切れる拍」の集合を作り、全声部の共通部分を取る
  let common: Set<number> | null = null;
  for (const measure of measuresAcrossParts) {
    for (const voice of getMeasureVoices(measure)) {
      const cuts = new Set<number>([0]);
      let beat = 0;
      let tupletId: string | undefined;
      for (const ev of voice.events) {
        // 連符グループの途中は「切れる拍」に数えない
        if (!(tupletId && ev.tuplet?.id === tupletId)) {
          cuts.add(round(beat));
        }
        tupletId = ev.tuplet?.id;
        beat += getEventDurationBeats(ev);
      }
      cuts.add(round(beat));
      // 音符が置かれていない残りは休符扱い＝どこでも切れる（整数拍を候補に足す）
      for (let b = Math.ceil(beat - EPS); b <= beatsPerMeasure + EPS; b++) {
        cuts.add(b);
      }
      if (common === null) {
        common = cuts;
      } else {
        const prev: Set<number> = common;
        common = new Set<number>([...prev].filter((b) => cuts.has(b)));
      }
    }
  }
  const candidates = [...(common ?? new Set<number>([0]))].filter((b) => b >= -EPS && b <= beatsPerMeasure + EPS);
  if (!candidates.some((b) => Math.abs(b) < EPS)) candidates.push(0);
  if (!candidates.some((b) => Math.abs(b - beatsPerMeasure) < EPS)) candidates.push(beatsPerMeasure);
  return candidates.sort((a, b) => a - b);
}

function round(beat: number): number {
  // 1/3 拍（三連符）を安定して比較できる精度で丸める
  return Math.round(beat * 10000) / 10000;
}

/** ドラッグ座標から求めた拍を、最近傍の境界候補へスナップする */
export function snapToSliceBoundary(beat: number, candidates: number[]): number {
  if (candidates.length === 0) return 0;
  return candidates.reduce((best, c) => (Math.abs(c - beat) < Math.abs(best - beat) ? c : best), candidates[0]);
}

/**
 * 1声部のイベント列から segStart〜segEnd 拍のイベントを切り出す。
 * 境界はスナップ済み（イベントを割らない位置）である前提。境界をまたぐイベントが
 * あった場合は含めない（安全側。呼び出し側の通知は #318 準拠）。
 * 弧・松葉は v1 では持っていかない（設計メモの既知の制限）。
 */
export function extractVoiceSlice(events: NoteEvent[], segStart: number, segEnd: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  let beat = 0;
  for (const ev of events) {
    const dur = getEventDurationBeats(ev);
    if (beat >= segStart - EPS && beat + dur <= segEnd + EPS) {
      const { arcs: _arcs, hairpins: _hairpins, ...rest } = ev;
      out.push({ ...rest, keys: [...ev.keys] });
    }
    beat += dur;
    if (beat >= segEnd + EPS) break;
  }
  return out;
}

/** スライスの合計拍数（イベント列から数える） */
export function sliceBeats(events: NoteEvent[]): number {
  return round(events.reduce((sum, ev) => sum + getEventDurationBeats(ev), 0));
}

/**
 * 1声部のイベント列の segStart〜segEnd 拍を、同じ長さの休符へ置き換える。
 * 範囲内に「境界をまたぐイベント」がある場合は null（呼び出し側が中止+通知）。
 * 範囲より後ろに音符が無く、範囲が末尾を超えている場合は何も足さない
 * （末尾の空きはもともと表示用の詰め物休符で埋まる領域のため）。
 */
export function replaceVoiceSliceWithRests(
  events: NoteEvent[],
  segStart: number,
  segEnd: number,
  buildRests: (beats: number) => NoteEvent[],
): NoteEvent[] | null {
  const before: NoteEvent[] = [];
  const after: NoteEvent[] = [];
  let removedBeats = 0;
  let beat = 0;
  for (const ev of events) {
    const dur = getEventDurationBeats(ev);
    const evStart = beat;
    const evEnd = beat + dur;
    if (evEnd <= segStart + EPS) {
      before.push(ev);
    } else if (evStart >= segEnd - EPS) {
      after.push(ev);
    } else if (evStart >= segStart - EPS && evEnd <= segEnd + EPS) {
      removedBeats += dur;
    } else {
      // 境界をまたぐイベント＝スナップが効いていない呼び出し
      return null;
    }
    beat = evEnd;
  }
  // 後続の音符が無ければ、消した拍を休符で埋め直す必要は無い（詰め物領域）
  const rests = after.length > 0 ? buildRests(round(removedBeats)) : [];
  return [...before, ...rests, ...after];
}

/**
 * 1声部のイベント列の atBeat 位置へ、スライス（sliceEvents）を上書きで貼り付ける。
 * 置き換え先の atBeat〜atBeat+スライス拍数 に「境界をまたぐイベント」がある場合や、
 * 小節の拍数を超える場合は null（呼び出し側が中止+通知）。
 * 貼り先の該当範囲に何も無い（末尾の空き）場合は、手前を休符で埋めてから置く。
 */
export function pasteVoiceSlice(
  events: NoteEvent[],
  atBeat: number,
  sliceEvents: NoteEvent[],
  beatsPerMeasure: number,
  buildRests: (beats: number) => NoteEvent[],
): NoteEvent[] | null {
  const insertBeats = sliceBeats(sliceEvents);
  if (insertBeats <= EPS) return [...events];
  if (atBeat + insertBeats > beatsPerMeasure + EPS) return null;

  const before: NoteEvent[] = [];
  const after: NoteEvent[] = [];
  let beat = 0;
  for (const ev of events) {
    const dur = getEventDurationBeats(ev);
    const evStart = beat;
    const evEnd = beat + dur;
    if (evEnd <= atBeat + EPS) {
      before.push(ev);
    } else if (evStart >= atBeat + insertBeats - EPS) {
      after.push(ev);
    } else if (evStart >= atBeat - EPS && evEnd <= atBeat + insertBeats + EPS) {
      // 置き換え対象（捨てる）
    } else {
      return null;
    }
    beat = evEnd;
  }
  const occupied = round(before.reduce((sum, ev) => sum + getEventDurationBeats(ev), 0));
  // 手前に空きがある（貼り先が既存音符の続きより後ろ）なら休符で埋める
  const leadingRests = occupied < atBeat - EPS ? buildRests(round(atBeat - occupied)) : [];
  const pasted = sliceEvents.map((ev) => ({ ...ev, keys: [...ev.keys] }));
  return [...before, ...leadingRests, ...pasted, ...after];
}
