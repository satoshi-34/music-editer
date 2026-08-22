import type { MeasureData, NoteEvent, PartData, VoiceData } from '../types/storage';

export type PlaybackMeasureEventWithStart = NoteEvent & {
  /**
   * 小節頭から何拍目で鳴り始めるか。
   * 単声部では省略できるが、複数声部では同時発音位置をそろえるために使う。
   */
  startBeat?: number;
};

const DURATION_TO_BEATS: Record<NoteEvent['dur'], number> = {
  '1': 4,
  '2': 2,
  '4': 1,
  '8': 0.5,
  '16': 0.25,
  '32': 0.125,
  '64': 0.0625,
};

function cloneNoteEvent(event: NoteEvent): NoteEvent {
  return {
    ...event,
    keys: [...event.keys],
    arcs: event.arcs ? [...event.arcs] : undefined,
    dynamics: event.dynamics ? [...event.dynamics] : undefined,
    articulations: event.articulations ? [...event.articulations] : undefined,
  };
}

export function cloneVoiceData(voice: VoiceData): VoiceData {
  return {
    ...voice,
    events: voice.events.map(cloneNoteEvent),
  };
}

/**
 * 小節データを複製する。
 * multi-voice 対応後は voices も落とさずコピーしないと、
 * 編集のたびに 2 声目だけ消える事故が起きやすいためここでまとめて扱う。
 */
export function cloneMeasureData(measure?: MeasureData): MeasureData {
  return {
    ...(measure ?? {}),
    events: (measure?.events ?? []).map(cloneNoteEvent),
    voices: measure?.voices?.map(cloneVoiceData),
  };
}

export function createEmptyMeasure(): MeasureData {
  return { events: [] };
}

// 表示専用の空の段（Issue #41「空の段でページを満たす」）用に、count個ぶんの
// 空小節をまとめて作る。呼び出し元でローカルにだけ保持し、保存データには
// 一切書き込まない前提（PianoSystemCanvas に渡す data を毎回この関数で
// 新規生成することで、実データ配列と参照が混ざらないようにする）。
export function createEmptyMeasures(count: number): MeasureData[] {
  return Array.from({ length: count }, () => createEmptyMeasure());
}


/**
 * 移行期間中の正規 read（#244 段5-3）。
 * voices[0]（鏡）を優先し、voices を持たない events-only の小節は events へフォールバックする。
 * dual-write（段5-1）と保存/読込の同期により「voices[0] が存在するなら常に events と等しい」が
 * 不変条件（段5-2 のテストで固定済み）なので、この切替は挙動を変えない。
 * フォールバックの除去は段5-4（保存形式の移行＝全小節が voices を持つ）以後。
 */
export function getPrimaryVoiceEvents(measure?: MeasureData): NoteEvent[] {
  return measure?.voices?.[0]?.events ?? measure?.events ?? [];
}

/**
 * 既存実装では measure.events が編集の正本なので、
 * voices[0] がある小節でも primary voice は measure.events を優先して扱う。
 */
export function getMeasureVoices(measure?: MeasureData): VoiceData[] {
  if (!measure) {
    return [{ id: 'voice-1', events: [] }];
  }

  if (!measure.voices || measure.voices.length === 0) {
    return [{ id: 'voice-1', events: measure.events ?? [] }];
  }

  // 読みは voices[0]（鏡）を優先する（#244 段5-3）。不変条件により events と同値
  return measure.voices.map((voice, index) => (
    index === 0
      ? { ...voice, events: getPrimaryVoiceEvents(measure) }
      : voice
  ));
}

/**
 * 保存前に primary voice の events を measure.events とそろえる。
 * こうしておくと、古い編集ロジックが events だけを書き換えても
 * 保存データの voices[0] が古いまま残る事故を防げる。
 */
export function syncPrimaryVoiceFromEvents(measure: MeasureData): MeasureData {
  if (!measure.voices || measure.voices.length === 0) {
    return measure;
  }

  return {
    ...measure,
    voices: measure.voices.map((voice, index) => (
      index === 0
        ? { ...voice, events: measure.events.map(cloneNoteEvent) }
        : cloneVoiceData(voice)
    )),
  };
}

export function syncMeasuresPrimaryVoiceFromEvents(measures: MeasureData[]): MeasureData[] {
  return measures.map((measure) => syncPrimaryVoiceFromEvents(cloneMeasureData(measure)));
}

/**
 * 全小節に voices[0] を実体化する（#244 段5-4・保存形式の移行）。
 * voices を持たない events-only の小節へ、正本（events）の鏡となる voice-1 を作る。
 * すでに voices を持つ小節はそのまま（鏡の同期は syncMeasuresPrimaryVoiceFromEvents の仕事）。
 * 読込・保存の両境界で呼ぶことで「永続化データの全小節は voices を持つ」を保証する。
 * フォールバック（voices[0]?.events ?? events）の除去は、セッション内の小節生成
 * （createEmptyMeasure・表示用プレースホルダー・声部2全削除後の畳み込み）も
 * 実体化してからでないと安全にできないため、#244 の後続課題とする（設計メモ§14）。
 */
export function ensureMeasuresPrimaryVoiceMaterialized(measures: MeasureData[]): MeasureData[] {
  let changed = false;
  const next = measures.map((measure) => {
    if (measure.voices && measure.voices.length > 0) return measure;
    changed = true;
    return {
      ...measure,
      voices: [{ id: 'voice-1', events: (measure.events ?? []).map(cloneNoteEvent) }],
    };
  });
  return changed ? next : measures;
}

/**
 * 楽譜 JSON の読み書き境界で使う正規化の共通形（#244 段5-4・Codex 2巡目の共通化提案）。
 * 「鏡の同期（正本 events → voices[0]）」と「全小節への voices 実体化」を1回で行う。
 * 対象境界: localStorage 保存/読込・ファイル書き出し/読込・フィードバック JSON・
 * カスタムサンプル保存/読込・MusicXML 読込（読込側は組み立て時に実体化）。
 */
export function normalizeMeasuresForPersistence(measures: MeasureData[]): MeasureData[] {
  return ensureMeasuresPrimaryVoiceMaterialized(syncMeasuresPrimaryVoiceFromEvents(measures));
}

/**
 * 指定した声部（voiceIndex）の events 配列を取得する。
 * voiceIndex 0 は primary voice なので measure.events を正本として返す。
 * voiceIndex 1 以降は measure.voices[voiceIndex] が無ければ空配列を返す
 * （まだ何も入力されていない状態を表す）。
 */
export function getVoiceEvents(measure: MeasureData, voiceIndex: number): NoteEvent[] {
  if (voiceIndex <= 0) {
    // 読みは voices[0]（鏡）を優先する（#244 段5-3）。不変条件により events と同値
    return getPrimaryVoiceEvents(measure);
  }
  return measure.voices?.[voiceIndex]?.events ?? [];
}

/**
 * 声部を編集するための入力UI（声部切り替えトグル）から呼ばれる更新ヘルパー。
 * voiceIndex 0 のときは既存互換のため measure.events を直接書き換える。
 * voiceIndex 1 以降は measure.voices を必要な数だけ作りながら、
 * 対象の声部だけ events を更新した新しい MeasureData を返す。
 *
 * 2声部目（voices[1]）は「下声」として使われることが多いため、
 * 新規作成時はデフォルトで符幹を下向き（stemDirection: 'down'）にする。
 * こうしておくと、ユーザーが声部を切り替えて入力しただけで
 * 上声・下声が符幹の向きで見分けられるようになる。
 */
export function withVoiceEventsUpdated(
  measure: MeasureData,
  voiceIndex: number,
  updater: (events: NoteEvent[]) => NoteEvent[],
): MeasureData {
  if (voiceIndex <= 0) {
    const nextEvents = updater(measure.events ?? []);
    // no-op（updater が同一参照を返した）なら元の measure をそのまま返す（#244 段5-4・
    // Codex 4巡目対応）。ここで鏡を実体化すると、参照変更なしの全小節走査
    // （remapAllMeasuresAfterRemoval 等）が未編集小節まで JSON 差分にしてしまい、
    // findFirstDifferingMeasureIndex による段割り安定化（Issue #67）が全再計画になる。
    // 「変化が無ければ引数をそのまま返す」は Issue #245 からの既存の約束でもある。
    if (nextEvents === measure.events) {
      return measure;
    }
    // dual-write（#244 段5-1）: 正本 events を書き換えたら voices[0] も同期する。
    // 段5-4（保存形式の移行）からは、voices を持たない小節にも書き込み時に器を作る —
    // 読込・保存の両境界で全小節に voices を実体化するようになったため、
    // 編集経路だけ events-only を温存する理由が無くなった（設計メモ§14）。
    if (!measure.voices || measure.voices.length === 0) {
      return {
        ...measure,
        events: nextEvents,
        voices: [{ id: 'voice-1', events: nextEvents.map(cloneNoteEvent) }],
      };
    }
    return {
      ...measure,
      events: nextEvents,
      voices: measure.voices.map((voice, index) => (
        index === 0
          ? { ...voice, events: nextEvents.map(cloneNoteEvent) }
          : voice
      )),
    };
  }

  const existingVoices = measure.voices?.map(cloneVoiceData) ?? [
    { id: 'voice-1', events: (measure.events ?? []).map(cloneNoteEvent) },
  ];
  while (existingVoices.length <= voiceIndex) {
    existingVoices.push({
      id: `voice-${existingVoices.length + 1}`,
      events: [],
      stemDirection: existingVoices.length === 1 ? 'down' : undefined,
    });
  }
  existingVoices[voiceIndex] = {
    ...existingVoices[voiceIndex],
    events: updater(existingVoices[voiceIndex].events),
  };
  return { ...measure, voices: existingVoices };
}

/**
 * 中身が空になった末尾の声部を畳んで、単声部の小節へ戻す（Issue #305）。
 *
 * なぜ必要か: 多声かどうかの判定は `getMeasureVoices(measure).length > 1` なので、
 * **中身が空でも器（voices[1]）が残っていれば多声小節**と数えられてしまう。
 * その状態では声部1の符幹が上向きに固定され、スラーも符幹先端側へアンカーされたままになり、
 * 「下声を全部消したのに2声部の残骸が残る」という見た目になる。
 * #112 の教訓「クリックで空の `voices[1]` を作らない」の対称形＝「消し切ったら残さない」がこれ。
 *
 * 畳み方の規則:
 * - 対象は**末尾から**連続する「イベント0件の声部」だけ。間に挟まった空の声部は畳まない。
 *   途中を抜くと後ろの声部の番号がずれ、その声部の弧が指す先（声部ローカルの索引）まで
 *   意味が変わってしまうため（`.claude/specs/voice2-arc-support/design.md` §2 案A）
 * - 声部1しか残らなくなったら `voices` キーごと削除して、最初から単声部で書いた小節と
 *   まったく同じ保存形式へ戻す（#294 の「戻すときはプロパティごと削除」と同じ考え方）
 * - 「声部2以降」という数え方にしてあるので、将来3声になっても同じ規則で畳める（#244）
 * - 声部1が空で声部2に中身がある小節は畳まない（末尾が空でないので自然にそうなる）。
 *   下声だけ先に書いている途中の小節を壊さないため
 *
 * 休符も「中身」として数える。ユーザーが明示的に置いた休符は消えていないので、
 * まだその声部を使っている＝多声のままが正しい（表示用の詰め物休符は保存データに入らない）。
 *
 * @returns 畳む必要が無ければ**引数の measure をそのまま返す**（呼び出し側が参照比較で
 *   「変わっていない」を判定できる・Issue #245 の約束）
 */
export function collapseEmptyTrailingVoices(measure: MeasureData): MeasureData {
  const voices = measure.voices;
  if (!voices || voices.length <= 1) return measure;

  let voiceCount = voices.length;
  while (voiceCount > 1 && (voices[voiceCount - 1].events?.length ?? 0) === 0) {
    voiceCount -= 1;
  }
  if (voiceCount === voices.length) return measure;

  if (voiceCount === 1) {
    // 単声部形式（measure.events だけ）へ戻す。events の正本は measure.events 側なので
    // （getMeasureVoices が voices[0] より優先して読む）、そちらを残す。
    const { voices: _removed, ...withoutVoices } = measure;
    return { ...withoutVoices, events: measure.events ?? voices[0].events ?? [] };
  }
  return { ...measure, voices: voices.slice(0, voiceCount) };
}

/**
 * 保存データ（全パート）から、中身の無い末尾の声部を畳む。読込時の正規化として使う。
 *
 * 空の声部を残したまま保存された既存データ（Issue #305 の修正より前に下声を消した譜面）は、
 * 開くたびに多声小節として描かれてしまう。読込の2経路（localStorage / ファイル）で
 * 同じ正規化を通し、「読み込んだデータに空の声部は無い」ことを保証する（#281・#282 と同じ2層構え）。
 *
 * @returns 変化が無ければ引数の配列をそのまま返す。
 */
export function normalizeEmptyVoicesInParts(parts: PartData[]): PartData[] {
  const next = parts.map((part) => {
    const measures = part.measures.map(collapseEmptyTrailingVoices);
    return measures.some((m, i) => m !== part.measures[i]) ? { ...part, measures } : part;
  });
  return next.some((part, i) => part !== parts[i]) ? next : parts;
}

/**
 * 付点による拍数の倍率。
 * 付点1個 = 1.5倍（元の長さ + その半分）、複付点(2個) = 1.75倍（元の長さ + 半分 + 4分の1）。
 */
export function dotsMultiplier(dots?: 1 | 2): number {
  if (dots === 1) return 1.5;
  if (dots === 2) return 1.75;
  return 1;
}

/**
 * 音価（と付点）から「4分音符=1拍」の基準拍数を計算する共通ヘルパー。
 * 複数ファイルに同じ倍率計算が重複しないよう、ここに集約する。
 */
export function getDurationBeats(dur: NoteEvent['dur'], dots?: 1 | 2): number {
  const base = DURATION_TO_BEATS[dur] ?? 1;
  return base * dotsMultiplier(dots);
}

/**
 * 連符による拍数の倍率。
 * 例: 3連符（3個の音符を2個ぶんの時間に詰める）は notesOccupied/numNotes = 2/3 倍。
 * tuplet が無い通常の音符は 1 倍のまま。
 */
export function tupletBeatsMultiplier(tuplet?: { numNotes: number; notesOccupied: number }): number {
  if (!tuplet || !tuplet.numNotes) return 1;
  return tuplet.notesOccupied / tuplet.numNotes;
}

/**
 * 単一イベントの長さを「4分音符=1拍」の基準拍へ変換する。
 * 再生位置の見える化でも同じ計算を使うため、共通関数として公開する。
 * 連符（tuplet）が付いている場合は、実際に占める時間（notesOccupied/numNotes 倍）まで反映する。
 */
export function getEventDurationBeats(event: NoteEvent): number {
  return getDurationBeats(event.dur, event.dots) * tupletBeatsMultiplier(event.tuplet);
}

/**
 * 2声部が共存する小節での符幹の向きを決める純ロジック。
 *
 * 標準的な浄書ルール（バッハのアルマンドのような2声部書法）では、
 * 声部1（上声）は常に符幹上向き、声部2（下声）は常に符幹下向きになる。
 * ここを VexFlow の自動判定に任せると、音高によって符幹の向きがばらつき、
 * どちらの声部の音符か読み取りづらくなってしまう。
 *
 * - 声部が1つしか無い小節（voices.length <= 1）では、
 *   従来通りの自動判定に任せたいので、ここでは何も上書きしない
 *   （stemDirection を明示しないことで既存の見た目を壊さない = リグレッション防止）。
 * - 声部が2つ以上ある小節でだけ、voices[0] を 'up'、voices[1] 以降を 'down' に強制する。
 *   既存データに個別の stemDirection が保存されていても、2声部共存時はここで上書きする。
 */
export function resolveVoiceStemDirections(voices: VoiceData[]): VoiceData[] {
  if (voices.length <= 1) {
    return voices;
  }
  return voices.map((voice, index) => ({
    ...voice,
    stemDirection: index === 0 ? 'up' : 'down',
  }));
}

/**
 * 音価の大きい順に並べた「休符分割の候補」一覧。
 * buildTrailingRestEventsForBeats の貪欲分割で、大きい音価から順に使う。
 */
const GREEDY_REST_DURATIONS: Array<{ dur: NoteEvent['dur']; beats: number }> = [
  { dur: '1', beats: 4 },
  { dur: '2', beats: 2 },
  { dur: '4', beats: 1 },
  { dur: '8', beats: 0.5 },
  { dur: '16', beats: 0.25 },
  { dur: '32', beats: 0.125 },
  { dur: '64', beats: 0.0625 },
];

/**
 * 指定した拍数を、休符イベントの配列へ貪欲に分割する。
 * 例: 1.5拍 → 付点は使わず「4分休符 + 8分休符」のように大きい音価から埋める
 * （付点休符への分割は複雑になるため、今回はシンプルな貪欲分割にとどめる）。
 */
export function buildTrailingRestEventsForBeats(
  beats: number,
  restKeyForDuration: (duration: NoteEvent['dur']) => string
): NoteEvent[] {
  const rests: NoteEvent[] = [];
  let remaining = beats;
  // 無限ループ防止（理論上は64分音符まで使えば十分収束する）。
  let guard = 0;
  while (remaining > 0.0001 && guard < 100) {
    guard += 1;
    const candidate = GREEDY_REST_DURATIONS.find((d) => d.beats <= remaining + 0.0001);
    if (!candidate) break;
    rests.push({ dur: candidate.dur, isRest: true, keys: [restKeyForDuration(candidate.dur)] });
    remaining -= candidate.beats;
  }
  return rests;
}

/**
 * 多声（voices が複数ある）小節で、ある声部の音価合計が拍子ぶんに満たないとき、
 * 表示用に末尾へ補う休符イベントを計算する。
 *
 * - 保存データ（measure.events / measure.voices）は一切書き換えない。
 *   これは「見た目だけの補完」であり、呼び出し側（描画コード）が
 *   実データに追加せず、レンダリング用のコピーへ結果を足すことを想定している。
 * - 拍子ぶんちょうど埋まっている、またはオーバーしている声部には空配列を返す
 *   （既存の正しく埋まっている多声小節の見た目を変えないため）。
 */
export function computeVoiceDisplayPadding(
  events: NoteEvent[],
  totalBeats: number,
  restKeyForDuration: (duration: NoteEvent['dur']) => string,
): NoteEvent[] {
  const occupiedBeats = events.reduce((sum, event) => sum + getEventDurationBeats(event), 0);
  const remainingBeats = totalBeats - occupiedBeats;
  if (remainingBeats <= 0.0001) {
    return [];
  }
  return buildTrailingRestEventsForBeats(remainingBeats, restKeyForDuration);
}

export function getMeasureDurationBeats(measure: MeasureData): number {
  const voices = getMeasureVoices(measure);
  if (voices.length <= 1) {
    return getPrimaryVoiceEvents(measure).reduce((sum, event) => sum + getEventDurationBeats(event), 0);
  }

  return voices.reduce((maxBeats, voice) => {
    const voiceBeats = voice.events.reduce((sum, event) => sum + getEventDurationBeats(event), 0);
    return Math.max(maxBeats, voiceBeats);
  }, 0);
}

/**
 * 複数声部を「小節内の開始拍つきイベント列」へ変換する。
 * 再生エンジン側はこの startBeat を使って、同じ小節の中で
 * 上声と下声を同時に鳴らせるようになる。
 */
export function flattenMeasureForPlayback(measure: MeasureData): PlaybackMeasureEventWithStart[] {
  const voices = getMeasureVoices(measure);
  if (voices.length <= 1) {
    return getPrimaryVoiceEvents(measure).map((event) => ({ ...cloneNoteEvent(event) }));
  }

  const flattened: Array<PlaybackMeasureEventWithStart & { voiceIndex: number }> = [];
  voices.forEach((voice, voiceIndex) => {
    let currentBeat = 0;
    voice.events.forEach((event) => {
      flattened.push({
        ...cloneNoteEvent(event),
        startBeat: currentBeat,
        voiceIndex,
      });
      currentBeat += getEventDurationBeats(event);
    });
  });

  flattened.sort((left, right) => {
    const beatDiff = (left.startBeat ?? 0) - (right.startBeat ?? 0);
    if (Math.abs(beatDiff) > 0.0001) {
      return beatDiff;
    }
    return left.voiceIndex - right.voiceIndex;
  });

  return flattened.map(({ voiceIndex, ...event }) => event);
}
