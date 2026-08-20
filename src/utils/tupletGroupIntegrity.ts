import type { MeasureData, NoteEvent, PartData } from '../types/storage';

/**
 * 連符グループ（同じ tuplet.id を共有するイベントの並び）の「連続性」を守るための道具箱。
 *
 * このアプリでは連符グループを「同じ tuplet.id が**連続**して並ぶ区間」として扱う
 * （描画の createVexFlowTuplets、削除・コピーの findTupletGroupRange がどちらもこの数え方）。
 * ところが Issue #282 で、同じ id が別の id を挟んで分断された保存データが見つかった:
 *
 * ```
 * 索引: 0  1  2 | 3  4  5 | 6  7  ...  11
 * id  : A  A  A | B  B  B | C  C  D D D  C   ← グループ C が D に分断されている
 * ```
 *
 * この状態になると「グループ全体」を数える処理が断片しか掴めず、連符の囲み（3 の数字と括弧）が
 * 描かれない・グループ削除やコピーが一部の音しか拾わない、といった破綻が起きる。
 *
 * ここには次の3つを置いている。
 * - 検出: findNonContiguousTupletGroupIds（テストや保存前チェックで使える純関数）
 * - 修復: normalizeTupletGroupContinuity（読込時に呼ぶ）
 * - 予防: snapInsertIndexOutOfTupletGroup（挿入位置がグループの内側へ入らないようにする）
 *
 * 依存を型だけに絞ってあるのは、保存・読込まわり（storage.ts / fileStorage.ts）から
 * 気軽に呼べるようにするため（描画系のモジュールを保存経路へ持ち込まない）。
 */

/** 連符の種類（3連符なら numNotes=3・notesOccupied=2）。 */
type TupletSpec = { numNotes: number; notesOccupied: number };

/** events[index] が属する連符グループの範囲（同じ id が連続する区間）。 */
export type TupletRunRange = { start: number; end: number };

function specOf(event: NoteEvent | undefined): TupletSpec | null {
  const tuplet = event?.tuplet;
  if (!tuplet) {
    return null;
  }
  return { numNotes: tuplet.numNotes, notesOccupied: tuplet.notesOccupied };
}

function sameSpec(a: TupletSpec | null, b: TupletSpec | null): boolean {
  return a != null && b != null && a.numNotes === b.numNotes && a.notesOccupied === b.notesOccupied;
}

/**
 * events[index] を含む「同じ tuplet.id が連続する区間」を返す。
 * 連符ではない位置なら null。
 *
 * findTupletGroupRange（tupletUtils）はこの関数をそのまま使う。
 * 「グループ＝連続する同一 id」という数え方をアプリ全体で1か所にまとめておくため。
 */
export function findTupletRunRange(events: readonly NoteEvent[], index: number): TupletRunRange | null {
  const tupletId = events[index]?.tuplet?.id;
  if (!tupletId) {
    return null;
  }
  let start = index;
  let end = index;
  while (start > 0 && events[start - 1]?.tuplet?.id === tupletId) start -= 1;
  while (end < events.length - 1 && events[end + 1]?.tuplet?.id === tupletId) end += 1;
  return { start, end };
}

/**
 * events に含まれる連符グループの区間を、先頭から順にすべて返す（Issue #324）。
 *
 * 「グループ＝同じ id が連続する区間（run）」という数え方は findTupletRunRange と同じもので、
 * こちらは「1つの位置から探す」のではなく「小節まるごと数え上げる」用途に使う。
 * 小節一括の操作（連符数字の一括トグルなど）が独自に run を数え直すと、
 * 数え方が2系統に増えて片方だけ直る事故のもとになるため、ここへ寄せている。
 *
 * @returns 連符が1つも無ければ空配列
 */
export function collectTupletRunRanges(events: readonly NoteEvent[]): TupletRunRange[] {
  const ranges: TupletRunRange[] = [];
  let i = 0;
  while (i < events.length) {
    const id = events[i]?.tuplet?.id;
    if (!id) {
      i += 1;
      continue;
    }
    // ここから同じ id が続くあいだが1つの「区間（run）」。
    let end = i;
    while (end + 1 < events.length && events[end + 1]?.tuplet?.id === id) end += 1;
    ranges.push({ start: i, end });
    i = end + 1;
  }
  return ranges;
}

/**
 * 「同じ id が2か所以上に分かれて現れている」連符グループの id を返す（重複なし・出現順）。
 *
 * 保存前の検証や、fixture が壊れていないかの確認に使える純関数。
 * 正常なデータでは常に空配列を返す。
 */
export function findNonContiguousTupletGroupIds(events: readonly NoteEvent[]): string[] {
  const finishedIds = new Set<string>();
  const brokenIds: string[] = [];
  // 区間の数え上げは collectTupletRunRanges に任せる（同じ数え方を2か所に書かない）。
  for (const range of collectTupletRunRanges(events)) {
    // collectTupletRunRanges は id を持つ位置しか区間の先頭にしないので、ここでは必ず値がある。
    const id = events[range.start]?.tuplet?.id;
    if (!id) continue;
    if (finishedIds.has(id) && !brokenIds.includes(id)) {
      // 一度終わったはずの id がまた出てきた ＝ 途中で別のグループに分断されている。
      brokenIds.push(id);
    }
    finishedIds.add(id);
  }
  return brokenIds;
}

/**
 * 分断されたグループを直すときに使う新しい id を作る。
 *
 * 乱数や時刻を使わず、元の id から機械的に決める（決定的にする）のが肝心。
 * 保存データは measure.events と voices[0].events が同じ内容を二重に持っており、
 * 別々に正規化しても同じ結果になってくれないと、声部1の中身だけが食い違ってしまうため。
 */
function makeRepairedId(baseId: string, chunkIndex: number, usedIds: Set<string>): string {
  let candidate = `${baseId}--fix${chunkIndex}`;
  // 万一すでに使われていたら末尾に印を足して避ける（実データでは起こらないが念のため）。
  while (usedIds.has(candidate)) {
    candidate = `${candidate}x`;
  }
  return candidate;
}

/**
 * 連符グループの分断を直した events を返す（Issue #282 の読込時の防御）。
 *
 * 2段構えで直す。
 *
 * 1. **区切り直し**: 同じ連符の種類（3連符なら 3:2）が連続している区間の中に分断された id が
 *    あれば、その区間を先頭から numNotes 個ずつに割り直して id を振り直す。
 *    月光9小節目のように「グループの境目だけがずれている」データは、これで元の4グループへ戻る
 * 2. **id の重複はがし**: それでも同じ id が離れた場所に残っていたら（連符でない音符を挟んで
 *    分断されている場合など）、2回目以降の断片へ別の id を振って切り離す
 *
 * どちらの段でも **音符の並び・音価・拍数は一切変えない**。書き換えるのは tuplet.id だけなので、
 * 鳴り方は正規化の前後で同じ。変わるのは「どの音を1つの連符として括るか」だけ。
 *
 * - 区切り直した結果が元のグループとぴったり同じ区間は、元の id をそのまま残す
 *   （差分を最小にして、保存データの見た目の変化を抑えるため）
 * - 割り切れずに余った端数は、それだけで1グループとして別の id を振る
 * - 分断が無い events は引数の配列をそのまま返す（正常なデータには一切触れない）
 */
export function normalizeTupletGroupContinuity(events: NoteEvent[]): NoteEvent[] {
  if (findNonContiguousTupletGroupIds(events).length === 0) {
    return events;
  }

  const usedIds = new Set<string>();
  events.forEach((ev) => {
    if (ev.tuplet?.id) usedIds.add(ev.tuplet.id);
  });
  let repairCounter = 0;
  /** 断片へ振り直す id を1つ払い出す。 */
  const nextRepairedId = (baseId: string): string => {
    repairCounter += 1;
    const newId = makeRepairedId(baseId, repairCounter, usedIds);
    usedIds.add(newId);
    return newId;
  };
  const assignId = (target: NoteEvent[], at: number, id: string) => {
    const ev = target[at];
    target[at] = { ...ev, tuplet: { ...ev.tuplet!, id } };
  };

  // ---- 段1: 種類のそろった区間を numNotes 個ずつに区切り直す ----
  const result = [...events];
  let i = 0;
  while (i < result.length) {
    const spec = specOf(result[i]);
    if (!spec) {
      i += 1;
      continue;
    }
    // 同じ種類の連符が途切れずに並んでいるところまでを1つの区間として見る。
    // （3連符の隣に5連符が来たらそこで区間は終わり。混ぜて区切り直すと拍が合わなくなる）
    let spanEnd = i;
    while (spanEnd + 1 < result.length && sameSpec(specOf(result[spanEnd + 1]), spec)) spanEnd += 1;

    const spanEvents = result.slice(i, spanEnd + 1);
    const needsRepair = findNonContiguousTupletGroupIds(spanEvents).length > 0;
    // numNotes が壊れている（0 や小数）データは区切り幅が決まらないので触らない。
    const canChunk = Number.isInteger(spec.numNotes) && spec.numNotes > 0;

    if (needsRepair && canChunk) {
      for (let offset = 0; offset < spanEvents.length; offset += spec.numNotes) {
        const chunk = spanEvents.slice(offset, offset + spec.numNotes);
        const baseId = chunk[0].tuplet!.id;
        // 区切り直した結果がもともとの1グループとぴったり同じなら、id は据え置く。
        const originalRun = findTupletRunRange(spanEvents, offset);
        const isIntactGroup =
          chunk.every((ev) => ev.tuplet?.id === baseId) &&
          originalRun?.start === offset &&
          originalRun?.end === offset + chunk.length - 1;
        if (isIntactGroup) {
          continue;
        }
        const newId = nextRepairedId(baseId);
        chunk.forEach((_ev, k) => assignId(result, i + offset + k, newId));
      }
    }
    i = spanEnd + 1;
  }

  // ---- 段2: 段1で直しきれなかった「離れた同じ id」を切り離す ----
  const seenIds = new Set<string>();
  let j = 0;
  while (j < result.length) {
    const id = result[j]?.tuplet?.id;
    if (!id) {
      j += 1;
      continue;
    }
    let runEnd = j;
    while (runEnd + 1 < result.length && result[runEnd + 1]?.tuplet?.id === id) runEnd += 1;
    if (seenIds.has(id)) {
      // 一度出てきた id が再登場した ＝ 離れた断片。別グループとして id を振り直す。
      const newId = nextRepairedId(id);
      for (let k = j; k <= runEnd; k += 1) assignId(result, k, newId);
    } else {
      seenIds.add(id);
    }
    j = runEnd + 1;
  }

  return result;
}

/** 小節1つぶん（声部1の events と voices の両方）を正規化する。変化が無ければ引数をそのまま返す。 */
function normalizeMeasureTupletGroups(measure: MeasureData): MeasureData {
  const nextEvents = Array.isArray(measure.events)
    ? normalizeTupletGroupContinuity(measure.events)
    : measure.events;
  const voices = measure.voices;
  if (!Array.isArray(voices)) {
    return nextEvents === measure.events ? measure : { ...measure, events: nextEvents };
  }
  const nextVoices = voices.map((voice) => {
    if (!Array.isArray(voice?.events)) return voice;
    const normalized = normalizeTupletGroupContinuity(voice.events);
    return normalized === voice.events ? voice : { ...voice, events: normalized };
  });
  const changed = nextEvents !== measure.events || nextVoices.some((voice, i) => voice !== voices[i]);
  return changed ? { ...measure, events: nextEvents, voices: nextVoices } : measure;
}

/**
 * 譜面全体（全パート・全小節・全声部）の連符グループを正規化する。
 * 読込経路（localStorage / ファイルを開く）から呼ぶ入口。
 */
export function normalizeTupletGroupsInParts(parts: PartData[]): PartData[] {
  if (!Array.isArray(parts)) {
    return parts;
  }
  return parts.map((part) => {
    if (!Array.isArray(part?.measures)) {
      return part;
    }
    const measures = part.measures.map(normalizeMeasureTupletGroups);
    const changed = measures.some((m, i) => m !== part.measures[i]);
    return changed ? { ...part, measures } : part;
  });
}

/** 分断されたグループの見つかった場所（保存前の警告に使う）。 */
export type TupletContinuityIssue = {
  partIndex: number;
  measureIndex: number;
  /** 声部1の measure.events なら null、voices[n] なら n */
  voiceIndex: number | null;
  tupletIds: string[];
};

/**
 * 譜面全体から分断された連符グループを洗い出す（保存前の検証・テスト用の純関数）。
 * 正常なデータでは空配列を返す。
 */
export function collectTupletContinuityIssues(parts: PartData[]): TupletContinuityIssue[] {
  if (!Array.isArray(parts)) {
    return [];
  }
  const issues: TupletContinuityIssue[] = [];
  parts.forEach((part, partIndex) => {
    if (!Array.isArray(part?.measures)) return;
    part.measures.forEach((measure, measureIndex) => {
      const push = (voiceIndex: number | null, events: NoteEvent[] | undefined) => {
        if (!Array.isArray(events)) return;
        const tupletIds = findNonContiguousTupletGroupIds(events);
        if (tupletIds.length > 0) {
          issues.push({ partIndex, measureIndex, voiceIndex, tupletIds });
        }
      };
      push(null, measure?.events);
      if (Array.isArray(measure?.voices)) {
        measure.voices.forEach((voice, voiceIndex) => push(voiceIndex, voice?.events));
      }
    });
  });
  return issues;
}

/**
 * 新しいイベントを挿入する位置が、既存の連符グループの**内側**に入らないように寄せる（Issue #282 の予防層）。
 *
 * クリック位置から求めた挿入位置は「隣り合う音符のどちら寄りか」しか見ていないため、
 * 連符グループの2音目・3音目の手前が選ばれることがある。そこへ差し込むとグループが
 * 前半と後半に割れ、同じ id が離れて並ぶ（＝このファイルが直しているあの状態）ので、
 * グループの手前か直後の、近いほうへ寄せる。
 *
 * @param index 「この位置の手前に入れる」という意味の挿入位置（events.length なら末尾）
 */
export function snapInsertIndexOutOfTupletGroup(events: readonly NoteEvent[], index: number): number {
  const clamped = Math.max(0, Math.min(index, events.length));
  const range = findTupletRunRange(events, clamped);
  // グループの先頭の手前（= range.start）はグループの外なので、そのままでよい。
  if (!range || clamped === range.start) {
    return clamped;
  }
  const distanceToHead = clamped - range.start;
  const distanceToTail = range.end + 1 - clamped;
  return distanceToHead <= distanceToTail ? range.start : range.end + 1;
}
