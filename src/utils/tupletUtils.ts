import type { DurKey, NoteEvent } from '../types/storage';
import { defaultRestDisplayKeyForDuration, keyToLine, type ClefType } from '../components/clefUtils';
import { isValidNoteKeyString } from './noteKeyUtils';
import { collectTupletRunRanges, findTupletRunRange } from './tupletGroupIntegrity';
import { getDurationBeats } from './voiceMeasureUtils';

// StaffCanvas / PianoSystemCanvas の音価ツール一覧と同じ並び（大きい音価から順）。
const DURATION_TOOL_VALUES: DurKey[] = ['1', '2', '4', '8', '16', '32', '64'];

/**
 * 3連符（3個の音符を2個ぶんの時間に詰める連符）のデフォルト構成。
 * buildTupletGroupPlan の第5引数（tupletSpec）を省略したときに使う既定値で、
 * 呼び出し側を変更しなくても既存の3連符挙動がそのまま維持される。
 */
export const DEFAULT_TUPLET_NUM_NOTES = 3;
export const DEFAULT_TUPLET_NOTES_OCCUPIED = 2;

/**
 * パレットから選べる連符の種類（数字と比率のセット）。
 * `hint` はパレットのツールチップに足す補足で、保存データ（NoteEvent.tuplet）には入らない。
 */
export type TupletKind = { numNotes: number; notesOccupied: number; hint?: string };

/**
 * パレットに用意する連符の一覧（数字の小さい順に並べる）。
 * - 2連符 (2:3) / 4連符 (4:3) … 複合拍子（8分の6拍子など）用。Issue #472 で追加
 * - 3連符 (3:2) … 既存
 * - 5連符 (5:4) / 6連符 (6:4) / 7連符 (7:4) … 既存
 *
 * 比率（notesOccupied）は浄書の慣例に合わせている。2連符・4連符は
 * 「付点音価1つぶんの時間（同じ音価3個ぶん）に2個／4個を詰める」記譜なので
 * notesOccupied は両方 3 になる。2連符だけは numNotes < notesOccupied、
 * つまり1音あたりの長さが**伸びる**唯一の種類だが、拍数計算はどこも
 * `notesOccupied / numNotes` 倍で統一されているので特別扱いは要らない。
 *
 * 9連符 (9:8) は入れていない。MusicXML 書出の分割数（DIVISIONS=16）では
 * 8/9 倍が整数にならず、往復すると小節の合計拍がずれるため（Issue #519 と同じ原因）。
 */
export const TUPLET_KINDS: TupletKind[] = [
  { numNotes: 2, notesOccupied: 3, hint: '8分の6拍子など複合拍子向け。1音あたりの長さは1.5倍に伸びる' },
  { numNotes: 3, notesOccupied: 2 },
  { numNotes: 4, notesOccupied: 3, hint: '8分の6拍子など複合拍子向け' },
  { numNotes: 5, notesOccupied: 4 },
  { numNotes: 6, notesOccupied: 4 },
  { numNotes: 7, notesOccupied: 4 },
];

// 拍数の比較に使う許容誤差。連符は notesOccupied/numNotes という割り切れない倍率を
// 掛けるため、厳密な等号では「ちょうど収まる」判定が落ちることがある。
const BEATS_EPS = 0.000001;

let tupletIdCounter = 0;

/**
 * 連符グループを一意に識別する id を発行する。
 * StaffCanvas（単旋律譜）と PianoSystemCanvas（多段譜・複数パート）の
 * どちらから呼ばれても衝突しないよう、時刻＋乱数に加えてモジュール内カウンタも混ぜている。
 * カウンタはページを再読み込みすると 0 に戻るが、時刻・乱数と組み合わせるため実用上問題ない。
 */
export function generateTupletId(): string {
  tupletIdCounter += 1;
  return `tuplet-${Date.now()}-${tupletIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export type TupletGroupPlan = {
  /** 連符グループとして挿入する NoteEvent 配列（音符1つ＋連符内休符2つ） */
  groupEvents: NoteEvent[];
  /** グループ全体が占める実際の拍数（3連符なら音価そのままの拍数と同じ） */
  groupBeats: number;
};

/**
 * 3連符グループ（音符1＋連符内休符2、同一 tuplet id）を組み立てる。
 * StaffCanvas・PianoSystemCanvas の両方で同じ組み立て方をするための共通ロジック。
 *
 * @param duration 音価ツールで選ばれた音価
 * @param dots 付点（1個のみ対応。複付点は連符では未対応のため呼び出し側で弾く想定）
 * @param noteKeys 音符側イベントの keys（和音は非対応、単音のみ）
 * @param restKey 連符内休符の描画位置（音部記号ごとの既定休符位置）
 * @param tupletSpec 連符の種類（numNotes/notesOccupied）。省略時は3連符(3:2)。
 *   5連符なら {numNotes:5, notesOccupied:4} のように渡す
 *   （音符1つ＋連符内休符 numNotes-1 個のグループになる）。
 */
export function buildTupletGroupPlan(
  duration: DurKey,
  dots: 1 | undefined,
  noteKeys: string[],
  restKey: string,
  tupletSpec: TupletKind = { numNotes: DEFAULT_TUPLET_NUM_NOTES, notesOccupied: DEFAULT_TUPLET_NOTES_OCCUPIED }
): TupletGroupPlan {
  const { numNotes, notesOccupied } = tupletSpec;
  const tupletId = generateTupletId();
  const tupletInfo = { id: tupletId, numNotes, notesOccupied };

  const perNoteBeats = getDurationBeats(duration, dots) * (notesOccupied / numNotes);
  const groupBeats = perNoteBeats * numNotes;

  const notePart: NoteEvent = {
    dur: duration,
    isRest: false,
    keys: noteKeys,
    dots,
    tuplet: tupletInfo,
  };
  const restPart = (): NoteEvent => ({
    dur: duration,
    isRest: true,
    keys: [restKey],
    dots,
    tuplet: tupletInfo,
  });

  // 音符1つ＋連符内休符(numNotes-1)個。3連符なら休符2つ、5連符なら休符4つになる。
  const restParts = Array.from({ length: Math.max(numNotes - 1, 0) }, () => restPart());
  return { groupEvents: [notePart, ...restParts], groupBeats };
}

/**
 * 連符（tuplet）内の休符を音符へ置換できるか判定する。
 * 連符グループは音価バランスが崩れると描画・再生が破綻するため、
 * 「同じ音価ならそのまま置換／違えば何もしない（分割はしない）」という保守的な仕様にする。
 *
 * 戻り値の意味:
 * - undefined: そもそも連符内の休符ではない → 呼び出し側は通常の分割ロジックへフォールバックする
 * - null:      連符内だが音価が一致しないため置換できない（分割もしない）
 * - 配列:      置換後の NoteEvent（1件、tuplet 情報を引き継ぐ）
 */
export function buildTupletRestReplacement(
  restEvent: NoteEvent,
  key: string,
  durationTool: { duration: DurKey; dots?: 1 }
): NoteEvent[] | null | undefined {
  if (!restEvent.tuplet) {
    return undefined;
  }
  if (restEvent.dur !== durationTool.duration || (restEvent.dots ?? undefined) !== (durationTool.dots ?? undefined)) {
    // 連符内では音価が一致しない置換は行わない（分割すると連符が壊れるため）
    return null;
  }
  // tuplet 情報を引き継ぐことで、置換後も連符グループの一員として描画・再生される。
  return [{ dur: durationTool.duration, isRest: false, keys: [key], dots: durationTool.dots, tuplet: restEvent.tuplet }];
}

// 連符グループを消したあとの休符が「引き継いだ音高のせいで五線から遠く離れた位置」に
// 生まれるのを防ぐための範囲（Issue #226）。
// line は五線の最上線が 0、1つ下の線が 1 …（五線の最下線が 4）という数え方で、
// 加線1本ぶんが 1。上方向2加線 = -2、下方向2加線 = 6 までを「そのまま使ってよい範囲」とする。
//
// なぜ ±2 か: 音符の当たり判定・選択判定は「五線 ± 3加線」（PianoSystemCanvas の
// CHORD_LEDGER_TOP / BOT）なので、その内側に収めておけば、生まれた休符は必ず
// クリックで選択でき、0キーの標準位置リセットでも救出できる。
const REST_KEY_INHERIT_LINE_TOP = -2;
const REST_KEY_INHERIT_LINE_BOTTOM = 6;

/**
 * 消した音符の音高を、そのまま休符の表示位置として引き継いでよいかを判定する。
 * 五線から極端に離れた音（例: ト音記号の c#/2）を引き継ぐと、休符が別の五線の上に
 * 描かれたように見え、しかも選択できず修復もできない状態になる（Issue #226）。
 */
export function canInheritRestDisplayKey(clef: ClefType, key: string | undefined): key is string {
  // keyToLine は解釈できないキーに対して 2（五線中央）を返すため、
  // 先に文字列として妥当かを確かめないと「壊れたキーは範囲内」と誤判定してしまう。
  if (!isValidNoteKeyString(key)) {
    return false;
  }
  const line = keyToLine(clef, key);
  return line >= REST_KEY_INHERIT_LINE_TOP && line <= REST_KEY_INHERIT_LINE_BOTTOM;
}

export type PlainRestTupletReplacement = {
  /** 休符の位置へ差し込む連符グループ（音符1つ＋連符内休符 numNotes-1 個） */
  groupEvents: NoteEvent[];
  /** グループを差し込んだあと、休符として後ろに残る拍数（ちょうど収まるときは 0） */
  remainingBeats: number;
};

/**
 * 「連符ではない普通の休符」を連符グループで置き換える計画を立てる（Issue #224）。
 *
 * 連符グループを削除すると同じ長さの通常休符に戻る仕様のため、これが無いと
 * 「連符 → 休符」が一方通行になり、Undo 以外で連符を入れ直せなかった。
 *
 * 休符の拍数がグループの拍数より長い場合は、余りを呼び出し側で休符として置く。
 * （余りの休符をどの音価に割るかは音部記号ごとの標準位置が要るため、
 *   拍数だけを返してキャンバス側の buildRestEventsForBeats に任せている）
 *
 * @returns 置き換えられないとき（休符ではない／連符内の休符／拍が足りない）は null
 */
export function planTupletReplacementForRest(
  restEvent: NoteEvent,
  noteKeys: string[],
  durationTool: { duration: DurKey; dots?: 1 },
  restKey: string,
  tupletSpec: TupletKind
): PlainRestTupletReplacement | null {
  // 連符内の休符は buildTupletRestReplacement の保守的な仕様（同音価のみ置換）に任せる。
  // ここで扱うのは「連符ではない普通の休符」だけ。
  if (!restEvent.isRest || restEvent.tuplet) {
    return null;
  }
  const restBeats = getDurationBeats(restEvent.dur, restEvent.dots);
  const { groupEvents, groupBeats } = buildTupletGroupPlan(
    durationTool.duration,
    durationTool.dots,
    noteKeys,
    restKey,
    tupletSpec
  );
  // 浮動小数点の誤差で「ちょうど収まる」ケースを弾かないよう、比較には余裕を持たせる
  // （例: 8分3連の1個あたりは 1/3 拍になり、3個足しても厳密には 1 にならないことがある）。
  if (groupBeats > restBeats + BEATS_EPS) {
    return null;
  }
  return { groupEvents, remainingBeats: Math.max(restBeats - groupBeats, 0) };
}

/**
 * events[index] が属する連符グループの範囲（同じ tuplet.id が連続する区間）を返す。
 * グループの削除・コピーで同じ数え方を使うため関数として切り出してある。
 *
 * 実体は tupletGroupIntegrity の findTupletRunRange。「グループ＝同じ id が連続する区間」
 * という数え方を2系統に増やさないため、正規化（Issue #282）と同じ関数を共有している。
 *
 * @returns 連符でない（tuplet.id を持たない）ときは null
 */
export function findTupletGroupRange(
  events: NoteEvent[],
  index: number
): { start: number; end: number } | null {
  return findTupletRunRange(events, index);
}

/**
 * 連符グループの「数字を隠す」設定を切り替えた events を返す（Issue #269）。
 *
 * 同じ連符が続く曲では、連符数字（3 等）は最初のグループにだけ書き、以降は省略するのが
 * 浄書の慣行（Gould, Behind Bars）。その省略をグループ単位で手動指定できるようにする。
 *
 * hideNumber はグループ内の**全イベント**に付ける。描画は先頭イベントの tuplet 情報しか
 * 見ないが、先頭を削除しても設定が残るようにするためと、MusicXML 書出で
 * 「どのイベントが先頭か」に依存せず判定できるようにするため。
 *
 * 表示に戻すときは false を入れずにプロパティごと削除する。保存データに
 * `hideNumber: false` が残らないので、旧データ（省略時=表示）と同じ形に揃う。
 *
 * @returns 連符ではない位置を指していたら null（呼び出し側は何もしない）
 */
export function toggleTupletNumberVisibility(events: NoteEvent[], index: number): NoteEvent[] | null {
  const range = findTupletGroupRange(events, index);
  if (!range) {
    return null;
  }
  // 先頭イベントの現在値を基準に反転する（グループ内で値がばらついた壊れたデータでも、
  // 1回の操作でグループ全体が同じ値に揃う）。
  const nextHidden = !events[range.start]?.tuplet?.hideNumber;
  return events.map((ev, i) =>
    i < range.start || i > range.end ? ev : withTupletHideNumber(ev, nextHidden)
  );
}

/**
 * イベント1つの `tuplet.hideNumber` を書き換えた新しいイベントを返す（連符でなければそのまま）。
 *
 * 表示へ戻すときに `false` を入れずプロパティごと削除するのがこの関数の肝で、
 * グループ単位のトグルと小節一括のトグルで**同じ書き方**を使うために切り出してある
 * （同じ規則を2か所に書くと、片方だけ直したときに保存データの形がずれる）。
 */
function withTupletHideNumber(event: NoteEvent, hidden: boolean): NoteEvent {
  if (!event.tuplet) {
    return event;
  }
  const nextTuplet = { ...event.tuplet };
  if (hidden) {
    nextTuplet.hideNumber = true;
  } else {
    delete nextTuplet.hideNumber;
  }
  return { ...event, tuplet: nextTuplet };
}

/** 小節一括の連符数字トグルの結果（通知の文言を組み立てるために件数と向きも返す）。 */
export interface MeasureTupletNumberToggleResult {
  /** 適用後のイベント列 */
  events: NoteEvent[];
  /** 切り替えた連符グループの数 */
  groupCount: number;
  /** 適用後に「数字を隠す」側になったなら true */
  hidden: boolean;
}

/**
 * 小節内の**すべての**連符グループの数字表示をまとめて切り替える（Issue #324）。
 *
 * 月光第1楽章のように三連符が曲全体に続く譜面では、グループ単位のトグル（#294）だと
 * 30回以上クリックすることになる。小節の背景クリック1回で小節ぶんをまとめて切り替える。
 *
 * 向きは「1つでも表示中のグループがあれば全部隠す／全部隠れていれば全部出す」。
 * 混在した状態から押したときに一部だけ反転して余計にばらけるのを避け、
 * 「押すたびに小節全体の見た目がそろう」動きにするため。
 *
 * @returns 小節に連符が1つも無ければ null（呼び出し側は譜面を書き換えないこと）
 */
export function toggleAllTupletNumbersInMeasure(
  events: NoteEvent[]
): MeasureTupletNumberToggleResult | null {
  const ranges = collectTupletRunRanges(events);
  if (ranges.length === 0) {
    return null;
  }
  // 1つでも「表示中（hideNumber が無い）」のグループがあれば、隠す方向へそろえる。
  const nextHidden = ranges.some((range) => !events[range.start]?.tuplet?.hideNumber);
  // どの位置が連符グループに含まれるかを先に印を付けておく（毎回 range を線形探索しない）。
  const inGroup = new Array<boolean>(events.length).fill(false);
  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i += 1) {
      inGroup[i] = true;
    }
  }
  return {
    events: events.map((ev, i) => (inGroup[i] ? withTupletHideNumber(ev, nextHidden) : ev)),
    groupCount: ranges.length,
    hidden: nextHidden,
  };
}

/** イベント1つが実際に占める拍数（付点と連符の圧縮率の両方を反映する）。 */
function occupiedBeats(ev: NoteEvent): number {
  return getDurationBeats(ev.dur, ev.dots) * (ev.tuplet ? ev.tuplet.notesOccupied / ev.tuplet.numNotes : 1);
}

/** 連符グループ（イベント配列）が占める合計拍数。 */
export function tupletGroupBeats(groupEvents: NoteEvent[]): number {
  return groupEvents.reduce((sum, ev) => sum + occupiedBeats(ev), 0);
}

/**
 * 連符グループをクリップボードへ入れられる形で取り出す（Issue #234）。
 *
 * 弧（タイ／スラー）・松葉・レガシーの tiedToNext は「同じ声部の別イベントを
 * インデックスで指す」情報なので、コピーすると貼り付け先で別の音符を指してしまう。
 * そのため、この3つだけは落としてから複製する（音符自体に付く記号は残す）。
 *
 * @returns 連符グループでない位置を指していたら null
 */
export function copyTupletGroupForClipboard(events: NoteEvent[], index: number): NoteEvent[] | null {
  const range = findTupletGroupRange(events, index);
  if (!range) {
    return null;
  }
  return events.slice(range.start, range.end + 1).map((ev) => {
    // 保存データは JSON で表せる素のオブジェクトなので、入れ子ごと安全に複製できる
    // （コピー後に元の音符を編集しても貼り付け内容が変わらないようにするため）。
    const cloned: NoteEvent = JSON.parse(JSON.stringify(ev));
    delete cloned.arcs;
    delete cloned.hairpins;
    delete cloned.tiedToNext;
    return cloned;
  });
}

/**
 * クリップボードの連符グループから「これから貼り付ける実体」を作る。
 * グループ id は必ず新しく発番する（元のグループと id を共有すると、
 * 離れた場所の連符同士が1つのグループとみなされて描画・削除が壊れるため）。
 */
export function instantiateTupletGroup(groupEvents: NoteEvent[]): NoteEvent[] {
  const newId = generateTupletId();
  return groupEvents.map((ev) => {
    const cloned: NoteEvent = JSON.parse(JSON.stringify(ev));
    if (cloned.tuplet) {
      cloned.tuplet = { ...cloned.tuplet, id: newId };
    }
    return cloned;
  });
}

export type TupletGroupPaste = {
  /** 休符の位置へ差し込む連符グループ（新しいグループ id 付き） */
  groupEvents: NoteEvent[];
  /** グループを差し込んだあと、休符として後ろに残る拍数（ちょうど収まるときは 0） */
  remainingBeats: number;
};

/**
 * 連符グループを休符へ貼り付けられない理由（Issue #325 で通知の文言を出すために追加）。
 *
 * - `notRest` … 対象が音符（休符ではない）
 * - `insideTuplet` … 対象が連符の中の休符（貼ると連符が入れ子になって壊れる）
 * - `emptyClipboard` … コピー中のグループが空
 * - `tooShort` … 休符の拍数がグループより短い
 */
export type TupletGroupPasteBlockReason = 'notRest' | 'insideTuplet' | 'emptyClipboard' | 'tooShort';

/**
 * 連符グループを休符へ貼り付けられない理由を返す（貼り付けられるなら null）。
 *
 * planTupletGroupPasteIntoRest はこの関数の結果だけで可否を決める。**可否の判断元をここ1か所に
 * まとめておく**ことで、「貼れなかった理由の通知（Issue #325）」と実際の結果が食い違わない
 * （同じ条件式を2か所に書いて片方だけ直し、文言と結果がずれた #280 の再発防止）。
 */
export function findTupletGroupPasteBlockReason(
  restEvent: NoteEvent,
  clipboardGroup: NoteEvent[]
): TupletGroupPasteBlockReason | null {
  if (clipboardGroup.length === 0) return 'emptyClipboard';
  if (!restEvent.isRest) return 'notRest';
  // 連符内の休符へ貼ると連符が入れ子になって壊れるため、対象は「普通の休符」だけにする
  // （Issue #224 の buildTupletRestReplacement と同じ保守的な考え方）。
  if (restEvent.tuplet) return 'insideTuplet';
  const restBeats = getDurationBeats(restEvent.dur, restEvent.dots);
  const groupBeats = tupletGroupBeats(clipboardGroup);
  // 浮動小数点の誤差で「ちょうど収まる」ケースを弾かないよう、比較には余裕を持たせる。
  if (groupBeats > restBeats + BEATS_EPS) return 'tooShort';
  return null;
}

/**
 * コピー済みの連符グループを「連符ではない普通の休符」へ貼り付ける計画を立てる（Issue #234）。
 *
 * 分割規則は Issue #224（連符ツールで休符をクリック）と同じで、
 * 休符のほうが長ければ余りを拍数で返し、休符イベントの組み立ては呼び出し側に任せる
 * （余りをどの音価の休符に割るかは音部記号ごとの標準位置が要るため）。
 *
 * @returns 貼り付けられないとき（休符でない／連符内の休符／拍が足りない）は null
 */
export function planTupletGroupPasteIntoRest(
  restEvent: NoteEvent,
  clipboardGroup: NoteEvent[]
): TupletGroupPaste | null {
  if (findTupletGroupPasteBlockReason(restEvent, clipboardGroup)) {
    return null;
  }
  const restBeats = getDurationBeats(restEvent.dur, restEvent.dots);
  const groupBeats = tupletGroupBeats(clipboardGroup);
  return {
    groupEvents: instantiateTupletGroup(clipboardGroup),
    remainingBeats: Math.max(restBeats - groupBeats, 0),
  };
}

export type TupletGroupDeletion = {
  groupStart: number;
  groupEnd: number;
  replacement: NoteEvent[];
};

/**
 * 連符内の単音の Delete を「グループごと削除」ではなく
 * 「その位置だけを連符内の休符へ置き換える」にできるかを判定する（Issue #283）。
 *
 * 浄書では「♪♪♪ → ♪休♪」のようにグループを残して1つだけ休符にする形が普通に出てくる
 * （月光のような曲では連符内休符が頻出する）ため、単音の削除はこちらを既定にする。
 *
 * ここが**削除側と通知側の唯一の判断元**になる。同じ条件式を2か所に書くと、
 * 片方だけ直したときに「文言と実際の結果が食い違う」事故になる（#280 で実際に起きた形）。
 *
 * false を返す＝従来どおりグループ全体を通常の休符へ畳む、という意味になる:
 * - 連符ではない／グループの範囲を辿れない（壊れたデータ）
 * - 対象が休符（すでに休符なので置き換える意味が無い。グループごと削除の入口として従来どおり残す）
 * - 対象が和音（keys が2つ以上。和音は「1音だけ削除」が先に効くべきで、
 *   keyIndex 無しで丸ごと消す経路は従来の挙動を変えない）
 * - グループに残る音符がこれ1つだけ（全部休符になるなら、そこで初めて通常の休符へ畳む）
 */
export function canReplaceTupletNoteWithRest(events: NoteEvent[], index: number): boolean {
  const target = events[index];
  if (!target?.tuplet || target.isRest || target.keys.length !== 1) {
    return false;
  }
  const range = findTupletGroupRange(events, index);
  if (!range) {
    return false;
  }
  // 自分以外に音符が1つでも残るならグループを維持する。
  // 残らない（＝自分が最後の1音）なら、グループ全体を1つの通常休符へ畳む従来の経路へ落とす。
  return events
    .slice(range.start, range.end + 1)
    .some((event, offset) => range.start + offset !== index && !event.isRest);
}

/**
 * 連符内の音符を置き換える「連符内の休符」を作る（Issue #283）。
 *
 * 音価（dur / dots）と tuplet 情報をそのまま引き継ぐので、グループの音価バランスは変わらず、
 * 連符の囲み・数字・ビームもそのまま残る。
 *
 * 表示位置は**音価ごとの標準位置**にする。連符ツールが作る連符内休符
 * （buildTupletGroupPlan の restPart）とまったく同じ形にそろえるためで、
 * 消した音の音高を引き継がないぶん、五線から遠い音を消したときも
 * 休符が変な高さに残らない（Issue #226 と同じ問題を作らない）。
 *
 * 音符に付いていた弧・松葉・アーティキュレーション等は引き継がない。休符に付いたままだと
 * 「音が無いのに記号だけ残る」ことになるうえ、連符内の休符には弧を貼れない（Issue #234）ため。
 */
export function buildTupletInnerRest(event: NoteEvent, clef: ClefType): NoteEvent {
  return {
    dur: event.dur,
    isRest: true,
    keys: [defaultRestDisplayKeyForDuration(clef, event.dur)],
    dots: event.dots,
    tuplet: event.tuplet,
  };
}

/**
 * 連符内の1イベント（index）を削除するとき、同じ tuplet.id を持つ
 * 前後のイベントも含めたグループ全体を、同じ実長の「連符ではない」通常の休符に置き換える。
 * 部分削除だと連符の音価バランスが崩れて描画・再生が破綻するため、
 * 「グループごと削除」というシンプルな仕様を StaffCanvas と揃えている。
 *
 * 置き換え休符の描画位置は「消したグループの先頭の音の音高」を引き継ぐ。
 * ただし五線から極端に離れた音高（Issue #226）はそのまま使うと異常位置の休符になるため、
 * canInheritRestDisplayKey の範囲外なら音価ごとの標準位置へフォールバックする。
 *
 * @param events 対象小節のイベント配列
 * @param index 削除しようとしているイベントのインデックス（events[index].tuplet が存在すること）
 * @param clef そのパートの音部記号（引き継ぎ可否の範囲判定と、標準位置の算出に使う）
 */
export function planTupletGroupDeletion(
  events: NoteEvent[],
  index: number,
  clef: ClefType
): TupletGroupDeletion | null {
  const range = findTupletGroupRange(events, index);
  if (!range) {
    return null;
  }
  const { start: groupStart, end: groupEnd } = range;
  const groupEvents = events.slice(groupStart, groupEnd + 1);
  const totalBeats = tupletGroupBeats(groupEvents);
  const inheritedKey = groupEvents[0]?.keys[0];
  // 引き継げる音高なら全ての置き換え休符で同じ位置を使う（従来どおりの見た目）。
  // 引き継げない場合だけ、休符の音価ごとの標準位置へ落とす
  // （全休符は第4線ぶら下げ・2分休符以下は五線中央、と標準位置が音価で違うため関数で渡す）。
  const resolveRestKey = canInheritRestDisplayKey(clef, inheritedKey)
    ? () => inheritedKey
    : (duration: DurKey) => defaultRestDisplayKeyForDuration(clef, duration);
  const replacement = buildRestEventsForBeatsShared(totalBeats, resolveRestKey);
  return { groupStart, groupEnd, replacement };
}

/**
 * 指定拍数を、できるだけ大きい休符から順に分解する。
 * StaffCanvas/PianoSystemCanvas 双方の buildRestEventsForBeats と同じロジック
 * （連符グループ削除後の休符再構成にのみ使う共通版）。
 *
 * @param resolveRestKey 休符1個ぶんの描画位置を返す関数（音価によって標準位置が変わるため関数で受け取る）
 */
function buildRestEventsForBeatsShared(beats: number, resolveRestKey: (duration: DurKey) => string): NoteEvent[] {
  const rests: NoteEvent[] = [];
  let remaining = beats;
  for (const duration of DURATION_TOOL_VALUES) {
    const durationBeats = getDurationBeats(duration);
    while (remaining + 0.0001 >= durationBeats) {
      rests.push({ dur: duration, isRest: true, keys: [resolveRestKey(duration)] });
      remaining -= durationBeats;
    }
  }
  return rests;
}
