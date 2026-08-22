// 拍範囲スライス（部分コピペ 段2・Issue #333）の純関数層。
// 設計は .claude/specs/partial-copy-paste/design.md 段2 を正本とする。
//
// このファイルは「1つの小節セグメント（segStart〜segEnd 拍）× 1声部のイベント列」を
// 単位に扱う。小節またぎ・全パート束ねは呼び出し側（ScorePage）が
// 「端の小節は部分・中の小節は全体」の規則でセグメントに割ってから呼ぶ。
import type { HairpinMark, MeasureData, NoteEvent, TieArc } from '../types/storage';
import { getMeasureVoices, getEventDurationBeats, getVoiceEvents, withVoiceEventsUpdated } from './voiceMeasureUtils';
import { generateTupletId } from './tupletUtils';

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
 * 弧・松葉・旧形式タイ（tiedToNext）は v1 では持っていかない（設計メモの既知の制限。
 * tiedToNext を残すと、貼り先で無関係な「次のイベント」へタイが描かれてしまう）。
 */
export function extractVoiceSlice(events: NoteEvent[], segStart: number, segEnd: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  let beat = 0;
  for (const ev of events) {
    const dur = getEventDurationBeats(ev);
    if (beat >= segStart - EPS && beat + dur <= segEnd + EPS) {
      const { arcs: _arcs, hairpins: _hairpins, tiedToNext: _tiedToNext, ...rest } = ev;
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
 * スライス編集（休符置換・貼り付け）の結果。events に加えて、
 * 「元のイベント列のどの範囲（インデックス）を、何個のイベントへ置き換えたか」を返す。
 * イベント数が変わると、他の音符・他の小節から張られた弧（arcs.toEventIndex）・
 * 松葉（hairpins.endEvent）の指す先がずれるため、呼び出し側はこの情報で
 * remapVoiceRefsAfterSliceEdit を使って参照を直す（Codex round1 P1 対応）。
 */
export type VoiceSliceEdit = {
  events: NoteEvent[];
  /** 置き換えた元イベント範囲の先頭インデックス */
  removeStart: number;
  /** 同・終端（排他）。removeStart === removeEndExclusive なら削除ゼロ */
  removeEndExclusive: number;
  /** 置き換え後にその位置へ入ったイベント数（休符・貼り付けイベントの合計） */
  insertedCount: number;
};

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
): VoiceSliceEdit | null {
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
  return {
    events: [...before, ...rests, ...after],
    removeStart: before.length,
    removeEndExclusive: events.length - after.length,
    insertedCount: rests.length,
  };
}

/**
 * 貼り付けるイベント列の連符グループ id を、貼り付けのたびに新しく発番し直す。
 * 元の id のまま複製すると、同じクリップボードを隣接する拍へ2回貼ったとき
 * 双方のイベントが同一 id の連続区間になり、createVexFlowTuplets が
 * 1つの（長さの合わない）グループと解釈して連符化に失敗する。
 * instantiateTupletGroup（連符クリップボード）と同じ規則。
 */
function reissueTupletIds(events: NoteEvent[]): NoteEvent[] {
  const idMap = new Map<string, string>();
  return events.map((ev) => {
    if (!ev.tuplet) return ev;
    let next = idMap.get(ev.tuplet.id);
    if (!next) {
      next = generateTupletId();
      idMap.set(ev.tuplet.id, next);
    }
    return { ...ev, tuplet: { ...ev.tuplet, id: next } };
  });
}

/**
 * 1声部のイベント列の atBeat 位置へ、スライスを「選択幅（sliceWidthBeats）ぶん」
 * 上書きで貼り付ける。スライスのイベント合計が選択幅より短い（コピー元の後半が
 * 無音だった）場合も、幅いっぱいを上書きし、残りは休符で埋める（後続音符が
 * あるときのみ。末尾の空きは詰め物領域なので埋めない）。イベントが空のスライスは
 * 「選択幅ぶんの無音」として貼れる（＝その範囲の削除と同じ）。
 * 置き換え先に「境界をまたぐイベント」がある場合や小節の拍数を超える場合は null。
 */
export function pasteVoiceSlice(
  events: NoteEvent[],
  atBeat: number,
  sliceEvents: NoteEvent[],
  sliceWidthBeats: number,
  beatsPerMeasure: number,
  buildRests: (beats: number) => NoteEvent[],
): VoiceSliceEdit | null {
  const width = round(sliceWidthBeats);
  if (width <= EPS) return { events: [...events], removeStart: 0, removeEndExclusive: 0, insertedCount: 0 };
  if (atBeat + width > beatsPerMeasure + EPS) return null;

  const before: NoteEvent[] = [];
  const after: NoteEvent[] = [];
  let beat = 0;
  for (const ev of events) {
    const dur = getEventDurationBeats(ev);
    const evStart = beat;
    const evEnd = beat + dur;
    if (evEnd <= atBeat + EPS) {
      before.push(ev);
    } else if (evStart >= atBeat + width - EPS) {
      after.push(ev);
    } else if (evStart >= atBeat - EPS && evEnd <= atBeat + width + EPS) {
      // 置き換え対象（捨てる）
    } else {
      return null;
    }
    beat = evEnd;
  }
  const pasted = reissueTupletIds(sliceEvents.map((ev) => ({ ...ev, keys: [...ev.keys] })));
  // 選択幅のうちイベントで埋まらない後半（コピー元の無音）も上書き対象。
  // 後続に音符が残るときだけ休符で埋め、末尾の空きなら何も置かない（削除と同じ規則）
  const trailingGap = round(width - sliceBeats(sliceEvents));
  const trailingRests = after.length > 0 && trailingGap > EPS ? buildRests(trailingGap) : [];
  const occupied = round(before.reduce((sum, ev) => sum + getEventDurationBeats(ev), 0));
  // 手前に空きがある（貼り先が既存音符の続きより後ろ）なら休符で埋める。
  // ただし埋めた先に置くものが何も無い（無音スライスを末尾の空きへ貼る）なら埋めない
  const needsLeadingFill = pasted.length > 0 || trailingRests.length > 0 || after.length > 0;
  const leadingRests = needsLeadingFill && occupied < atBeat - EPS ? buildRests(round(atBeat - occupied)) : [];
  const inserted = [...leadingRests, ...pasted, ...trailingRests];
  return {
    events: [...before, ...inserted, ...after],
    removeStart: before.length,
    removeEndExclusive: events.length - after.length,
    insertedCount: inserted.length,
  };
}

/**
 * スライス編集でイベント数が変わった声部について、全小節の弧・松葉の「終点参照」を直す。
 *
 * - 消えた範囲（removeStart〜removeEndExclusive）を指していた弧・松葉は除去する
 *   （終点の音符ごと消えた/別物に置き換わったため）
 * - それより後ろを指していた参照は、イベント数の増減ぶんだけずらす
 *
 * 弧・松葉は別の小節の音符から張られていることがあるため、編集した小節だけでなく
 * 全小節を走査する（noteDeletionUtils の remapAllMeasuresAfterRemoval と同じ理由）。
 * 声部 v の arcs / hairpins の終点は「同じ声部 v のイベント列内の位置」を意味する
 * （voice2-arc-support/design.md §2 案A）ため、走査も同じ声部だけでよい。
 */
export function remapVoiceRefsAfterSliceEdit(
  measures: MeasureData[],
  voiceIndex: number,
  measureIndex: number,
  edit: VoiceSliceEdit,
): MeasureData[] {
  const removedCount = edit.removeEndExclusive - edit.removeStart;
  const delta = edit.insertedCount - removedCount;
  if (removedCount === 0 && delta === 0) return measures;
  return measures.map((measure) => {
    if (!measure) return measure;
    const events = getVoiceEvents(measure, voiceIndex);
    if (events.length === 0) return measure;
    let changed = false;
    const nextEvents = events.map((ev): NoteEvent => {
      let patched = ev;
      if (ev.arcs?.length) {
        const nextArcs = ev.arcs
          .filter((a) => !(a.toMeasureIndex === measureIndex
            && a.toEventIndex >= edit.removeStart && a.toEventIndex < edit.removeEndExclusive))
          .map((a): TieArc =>
            a.toMeasureIndex === measureIndex && a.toEventIndex >= edit.removeEndExclusive
              ? { ...a, toEventIndex: a.toEventIndex + delta }
              : a
          );
        if (nextArcs.length !== ev.arcs.length || nextArcs.some((a, i) => a !== ev.arcs![i])) {
          patched = { ...patched, arcs: nextArcs.length ? nextArcs : undefined };
        }
      }
      if (ev.hairpins?.length) {
        const nextHairpins = ev.hairpins
          .filter((h) => !(h.endMeasure === measureIndex
            && h.endEvent >= edit.removeStart && h.endEvent < edit.removeEndExclusive))
          .map((h): HairpinMark =>
            h.endMeasure === measureIndex && h.endEvent >= edit.removeEndExclusive
              ? { ...h, endEvent: h.endEvent + delta }
              : h
          );
        if (nextHairpins.length !== ev.hairpins.length || nextHairpins.some((h, i) => h !== ev.hairpins![i])) {
          patched = { ...patched, hairpins: nextHairpins.length ? nextHairpins : undefined };
        }
      }
      if (patched !== ev) changed = true;
      return patched;
    });
    if (!changed) return measure;
    return withVoiceEventsUpdated(measure, voiceIndex, () => nextEvents);
  });
}
