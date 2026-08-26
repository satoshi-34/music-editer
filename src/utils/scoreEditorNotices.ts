// 譜面の編集で「何が起きたか」をユーザーへ知らせるための、ごく小さな通知の仕組み（Issue #238）。
//
// 背景: 音符の選択（青枠）が残ったまま Delete / Backspace が譜面へ届くと、
// 選択中の音符（連符ならグループごと）が**無言で**消えていた。
// ユーザーは後から気づいて「勝手に譜面が変わった」と誤解してしまう。
// そこで削除の実行時に「何を消したか」を数秒だけ画面へ出す。
//
// なぜ props ではなく window の CustomEvent なのか:
// 削除を実行するのは PianoSystemCanvas（1段 = 1インスタンス）だが、通知を出すのは
// 画面全体を持つ ScorePage である。両者のあいだには SingleStaff / PianoStaff /
// QuartetStaff / EnsembleStaff / PartExtractionStaff の5つのラッパーが挟まっており、
// コールバックを props で通すと5ファイルを機械的に書き換えることになる。
// PianoSystemCanvas には既に「選択はいつも1つだけ」を保証する window イベント
// （SELECTION_CLAIMED_EVENT）の前例があるため、同じ作法にそろえた。

import type { NoteEvent } from '../types/storage';
import { canReplaceTupletNoteWithRest, type TupletGroupPasteBlockReason } from './tupletUtils';

/** 削除など「編集で何が起きたか」を画面へ出すための通知イベント名 */
export const SCORE_EDIT_NOTICE_EVENT = 'music-editer-score-edit-notice';

/** 譜面側（PianoSystemCanvas）の選択を解除させるための要求イベント名 */
export const SCORE_SELECTION_CLEAR_EVENT = 'music-editer-score-selection-clear';

/** 譜面のクリックから「アクティブ声部を切り替えてほしい」と伝えるイベント名（Issue #258） */
export const SCORE_ACTIVE_VOICE_CHANGE_EVENT = 'music-editer-score-active-voice-change';

export interface ScoreActiveVoiceChangeDetail {
  /** 切り替え先の声部（0 = 上声/声部1、1 = 下声/声部2、… N 声対応で number・#244 段5-5） */
  voiceIndex: number;
  /**
   * 切り替え先のパート（#316 レイヤー選択）。省略時はパートを変えず声部だけ切り替える
   * （従来の声部トグル互換）。ピアノ譜では 0=右手・1=左手
   */
  partIndex?: number;
}

export interface ScoreEditNoticeDetail {
  /** 画面に出す本文。「〜しました」までを含む完成した文にすること */
  message: string;
}

/**
 * 「元に戻せます」の案内。Mac は Cmd、Windows/Linux は Ctrl なので、
 * README と同じく両方を併記する（実行環境を判定して出し分けるほどの情報ではない）。
 */
export const UNDO_HINT = '（Cmd/Ctrl+Z で元に戻せます）';

/** 編集の通知を出す。リスナー（ScorePage）が居なければ何も起きない。 */
export function notifyScoreEdit(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ScoreEditNoticeDetail>(SCORE_EDIT_NOTICE_EVENT, { detail: { message } })
  );
}

/**
 * 譜面上の選択（音符・スラー/タイ・松葉）を解除するよう要求する。
 *
 * タブ切り替え・ツール変更・再生開始のような「モードが変わる」タイミングで呼ぶ。
 * 選択が残ったままだと、そのあとの Delete が譜面に届いてしまうため
 * （Issue #238 の実害。#231 の「モード遷移でオーバーレイを閉じる」と同じ発想）。
 */
export function requestScoreSelectionClear(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SCORE_SELECTION_CLEAR_EVENT));
}

/**
 * アクティブ声部の切り替えを要求する（Issue #258）。
 *
 * 非アクティブ声部の音符をクリックしたときに譜面側から呼ぶ。声部の状態を持っているのは
 * ScorePage で、あいだに5つのラッパーが挟まっている事情は通知（notifyScoreEdit）と同じなので、
 * 同じ window の CustomEvent 方式にそろえている。
 */
export function requestActiveVoiceChange(voiceIndex: number, partIndex?: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ScoreActiveVoiceChangeDetail>(SCORE_ACTIVE_VOICE_CHANGE_EVENT, { detail: { voiceIndex, partIndex } })
  );
}

/**
 * 声部が自動で切り替わったことを知らせる文言（Issue #258）。
 *
 * #105 は「非アクティブ声部を気づかずに編集してしまう」ことを防ぐために、
 * アクティブ声部にしか当たり判定を作らない設計にした。本Issueでその制限を
 * 「選択のクリックは全声部・編集の入力はアクティブ声部だけ」へ意図的に変更したので、
 * 誤編集の防止は「切り替わったことが必ず画面に出る」この通知が引き継ぐ。
 */
export function describeActiveVoiceSwitched(voiceIndex: number): string {
  return `声部${voiceIndex + 1}に切り替えました`;
}

/**
 * レイヤー（パート×声部）ごと切り替わったことを知らせる文言（#316）。
 * パートが変わらない切り替えは describeActiveVoiceSwitched を使う。
 */
export function describeActiveLayerSwitched(partLabel: string, voiceIndex: number): string {
  return `${partLabel}・声部${voiceIndex + 1}に切り替えました`;
}

/** 調整オーバーレイの「削除」で記号を外したときの通知（Issue #385 続報・裁定B） */
export function describeSymbolDeleted(symbolLabel: string): string {
  return `${symbolLabel}を削除しました`;
}

/**
 * 選択レイヤーと違う五線（帯）の空白をクリックして音符を入れたときの案内
 * （裁定②案A・2026-08-23）。挿入先は常に選択レイヤーのパートで、レイヤーは
 * クリックでは変わらない。低い右手（月光型）を左手の帯の位置で入力する操作が
 * 正当なユースケースなので、警告ではなく「どこへ入ったか」の事実+代替手順を伝える。
 */
export function describeCrossBandInsert(targetPartLabel: string, voiceIndex: number, clickedPartLabel: string): string {
  return `${targetPartLabel}・声部${voiceIndex + 1}に入れました（${clickedPartLabel}へ入れるにはレイヤーボタンで切り替えてください）`;
}

/**
 * UI が対応していない声部（3声以降）への切り替えを求められたときの案内（#244 段5-5）。
 * データ・再生・書き出しは N 声対応だが、編集 UI（声部トグル）は2声まで。
 * 黙って無視すると「クリックしたのに何も起きない」行き止まりになる（#318）。
 */
export function describeVoiceSwitchUnavailable(voiceIndex: number): string {
  return `声部${voiceIndex + 1}の音符です（表示・再生・書き出しのみ対応）。編集ツールでの切り替えは声部1・2までです`;
}

/**
 * 削除される音符/休符から、通知に出す文言を組み立てる。
 *
 * 分岐は utils/noteDeletionUtils.ts の deleteEventFromMeasures と**同じ順序**にしてある。
 * 実際に消えるものと文言がずれると、かえって混乱させてしまうため。
 *
 * 連符の中は「その位置だけ休符になる」のか「グループごと消える」のかで結果がまるで違うので、
 * 判定は自前で書かずに削除側と同じ canReplaceTupletNoteWithRest（Issue #283）へ通す。
 * 同じ条件式を2か所へ書くと、片方だけ直したときに文言と結果が食い違う（#280 の再発防止）。
 *
 * @param event 削除対象のイベント（削除前の状態を渡すこと）
 * @param keyIndex 和音のうちクリックで選ばれていた符頭の位置。未指定ならイベント全体が対象
 * @param tupletContext 連符の判定に必要な前後関係（その声部の events と、対象の位置）。
 *   省略すると連符はすべて「グループ削除」の文言になるため、削除を実行する画面からは必ず渡すこと
 */
export function describeDeletedNoteEvent(
  event: NoteEvent,
  keyIndex?: number,
  tupletContext?: { events: NoteEvent[]; index: number }
): string {
  // 1. 和音の1音だけを取り除くケース（連符の中の和音でもこちらが優先される）
  if (
    !event.isRest &&
    keyIndex !== undefined &&
    keyIndex >= 0 &&
    keyIndex < event.keys.length &&
    event.keys.length > 1
  ) {
    return `和音の1音を削除しました${UNDO_HINT}`;
  }
  // 2. 連符の中のイベント
  if (event.tuplet) {
    // 2-a. 単音はその位置だけが連符内の休符になる（グループは残る）
    if (tupletContext && canReplaceTupletNoteWithRest(tupletContext.events, tupletContext.index)) {
      return `連符内の音符を休符にしました${UNDO_HINT}`;
    }
    // 2-b. それ以外はグループ全体が同じ長さの休符へ置き換わる
    return `${event.tuplet.numNotes}連符グループを削除しました${UNDO_HINT}`;
  }
  // 3. それ以外はイベントそのものが消える
  if (event.isRest) return `休符を削除しました${UNDO_HINT}`;
  if (event.keys.length > 1) return `和音を削除しました${UNDO_HINT}`;
  return `音符を削除しました${UNDO_HINT}`;
}

/**
 * 矢印キーの音高移動で、移動先に同じ音が既にあって1音にまとまったときの文言（Issue #281）。
 *
 * 同じ高さの符頭は完全に重なって1つに見えるため、重複を作らせない代わりに
 * 「音が1つ減った」ことは必ず知らせる。黙って音数が変わるのが #238 で問題になった形なので、
 * 削除と同じ通知の仕組みに乗せている。
 */
export function describeAbsorbedChordKey(): string {
  return `移動先に同じ高さの音があるため、和音の1音にまとめました${UNDO_HINT}`;
}

/**
 * コピー中の連符グループを休符へ貼れなかったときの文言（Issue #325・#318 の「行き止まりは喋る」）。
 *
 * 当たり判定を休符の列全体へ広げたことで、「押しても何も起きない」場面は
 * 「そもそも貼れない休符を押したとき」だけになった。その1本だけ残った行き止まりで、
 * 理由と次にどうすればよいかを必ず伝える。
 *
 * 理由の判定は貼り付け側とまったく同じ findTupletGroupPasteBlockReason（tupletUtils）を通す
 * ため、ここで条件を書き直さない（文言と結果がずれた #280 の再発防止）。
 */
export function describeTupletGroupPasteUnavailable(reason: TupletGroupPasteBlockReason): string {
  switch (reason) {
    case 'tooShort':
      return '拍が足りないため、この休符には連符グループを貼り付けできません（もっと長い休符をクリックするか、Escape でコピーを解除してください）';
    case 'insideTuplet':
      return '連符の中の休符には貼り付けできません（連符の外の休符をクリックするか、Escape でコピーを解除してください）';
    case 'emptyClipboard':
      return '貼り付けられる連符グループがありません（連符の音符を選んで Cmd/Ctrl+C でコピーしてください）';
    case 'notRest':
      return '音符の上には貼り付けできません（休符をクリックするか、Escape でコピーを解除してください）';
  }
}

/**
 * 小節の拍が埋まっていて音符・連符グループを置けなかったときの文言（Issue #318）。
 *
 * 「行き止まりは喋る」原則の適用。クリックしても何も起きない状態が続くと、
 * ユーザーには「アプリが壊れた」「クリック位置が悪い」としか見えず、
 * 正しい次の一手（次の小節へ置く／既存の音符を消す）へたどり着けない。
 * 拒否そのものは正しい挙動なので、理由と代替手順だけを添える。
 */
export function describeMeasureFull(): string {
  return 'この小節は拍がいっぱいで置けません（次の小節へ置くか、この小節の音符を減らしてください）';
}

/**
 * 段またぎ表示（⇵）の対象にならないものをクリックしたときの文言（Issue #318 / 発端は #315）。
 *
 * ボタンが押せる＝どの音符でも使える、と受け取られるため、
 * 「なぜこの音符では効かないのか」を必ず言う。
 */
export function describeCrossStaffUnavailable(reason: 'rest' | 'singleStaff'): string {
  if (reason === 'rest') {
    return '休符は段またぎ表示にできません（移したい音符の符頭をクリックしてください）';
  }
  // 無効化ツールチップ（Palette の ⇵ ボタン）と同じ言い回しにそろえる
  return '段またぎ表示は五線が2段以上ある譜面でのみ使えます';
}

/**
 * 段またぎ表示を切り替えたときの文言（Issue #318・運用者の追加提案2）。
 *
 * **表示先の五線と、その音符の所属（パート・声部）は別物**である。
 * 運用者が「下の五線へ移した音符は下声の所属になった」と誤解し、
 * 声部2が空である前提が崩れて #322 の症状を踏んだ実害があるため、
 * 移動を伝えるときは必ず「所属は変わらない」ことまで言い切る。
 */
export function describeCrossStaffToggled(
  direction: 'above' | 'below',
  turnedOn: boolean,
  voiceIndex: number
): string {
  if (!turnedOn) {
    return `元の五線の表示に戻しました（所属は声部${voiceIndex + 1}のまま変わりません）`;
  }
  const where = direction === 'below' ? '下' : '上';
  return `${where}の五線へ表示を移しました（所属は声部${voiceIndex + 1}のまま変わりません）`;
}

/**
 * 連符数字の表示切替（Issue #269）を、連符ではない音符へ試したときの文言（Issue #318）。
 */
export function describeTupletNumberToggleUnavailable(): string {
  return '連符ではないため数字の表示は切り替えられません（連符グループの音符か休符をクリックしてください）';
}

/**
 * 記号系ツール（強弱・カスタム記号・サイズ/位置調整）の種類（Issue #330）。
 *
 * 通知の文言へ「どのツールが効かなかったのか」を差し込むために使う。
 * ツールごとに文言を書き分けると同じ意味の文が5つ以上散らばり、
 * 片方だけ直したときに食い違う（#280 と同じ壊れ方）ので、1つのビルダーに集約している。
 */
export type SymbolTool =
  /** 強弱記号（p, f など）を付けるツール */
  | { type: 'dynamic' }
  /** アーティキュレーション（スタッカート等）を付けるツール */
  | { type: 'articulation' }
  /** 運指（指番号）を入力するツール。休符には描画されないので音符専用 */
  | { type: 'fingering' }
  /** カスタム記号を付け外しするツール。symbolName はユーザーが付けた記号の名前 */
  | { type: 'customSymbol'; symbolName: string }
  /** 特定のカスタム記号のサイズ・位置を調整するツール */
  | { type: 'customSymbolAdjust'; symbolName: string; adjust: 'resize' | 'offset' }
  /** 汎用のサイズ・位置調整ツール（⤢ / ✥）。音符に付いている記号から対象を選ぶ */
  | { type: 'symbolAdjust'; adjust: 'resize' | 'offset' };

/** サイズ調整・位置調整のどちらなのかを表す短い名前 */
function describeAdjustKind(adjust: 'resize' | 'offset'): string {
  return adjust === 'resize' ? 'サイズ調整' : '位置調整';
}

/** 通知の文中で「どのツールを使ったのか」を指す言い方を組み立てる */
function describeSymbolToolName(tool: SymbolTool): string {
  switch (tool.type) {
    case 'dynamic':
      return '強弱記号';
    case 'articulation':
      return 'アーティキュレーション';
    case 'fingering':
      return '運指（指番号）';
    case 'customSymbol':
      return `カスタム記号「${tool.symbolName}」`;
    case 'customSymbolAdjust':
      return `「${tool.symbolName}」の${describeAdjustKind(tool.adjust)}`;
    case 'symbolAdjust':
      // パレット上のボタン記号（⤢ / ✥）も添える。どのボタンの話かを一目で分かるようにするため
      return `記号の${describeAdjustKind(tool.adjust)}（${tool.adjust === 'resize' ? '⤢' : '✥'}）`;
  }
}

/**
 * 記号系ツールを対象外の音符・休符へ使ったときの文言（Issue #330・#318 の「行き止まりは喋る」）。
 *
 * これらのツールは「押しても何も起きない」場面が無言で終わっていた。
 * 拒否の条件そのものは基本的に変えず、理由と次の一手だけを添える。
 * なお「記号はすべて音符専用」ではない: 歌詞・コード記号・テンポ表記・発想標語・オッターバは
 * 休符にも付けられ、調整もできる（#398）。音符専用なのは運指・強弱・アーティキュレーション。
 *
 * @param tool 使おうとしたツール。文中に名前を差し込む
 * @param reason なぜ効かなかったのか
 *   - `rest`: 休符をクリックした（そのツールが扱う記号は音符専用）
 *   - `symbolNotAttached`: 調整しようとした記号が、その音符に付いていない
 *   - `noAdjustableSymbol`: 調整できる記号が1つも付いていない音符を押した
 *   - `noAdjustableSymbolOnRest`: 同上の休符版。休符にも歌詞・コード記号・テンポ表記・
 *     発想標語・オッターバは付けられるので、「休符だから使えない」ではなく
 *     「まだ何も付いていない」と言う（#398）
 */
export function describeSymbolToolUnavailable(
  tool: SymbolTool,
  reason: 'rest' | 'symbolNotAttached' | 'noAdjustableSymbol' | 'noAdjustableSymbolOnRest'
): string {
  switch (reason) {
    case 'rest': {
      // 「付ける」ツールと「調整する」ツールで自然な動詞が違うので、そこだけ出し分ける
      const verb = tool.type === 'dynamic' || tool.type === 'customSymbol' || tool.type === 'fingering'
        ? '付けられません' : '使えません';
      return `休符には${describeSymbolToolName(tool)}を${verb}（音符をクリックしてください）`;
    }
    case 'symbolNotAttached': {
      // ここで主語になるのはツール名ではなく「付いていない記号」そのもの
      const symbolLabel = 'symbolName' in tool ? `「${tool.symbolName}」` : 'この記号';
      const adjustLabel = 'adjust' in tool ? describeAdjustKind(tool.adjust) : '調整';
      return `この音符には${symbolLabel}が付いていません（先に記号を付けてから${adjustLabel}を使ってください）`;
    }
    case 'noAdjustableSymbol':
      return 'この音符には調整できる記号がありません（記号を付けてから ⤢ / ✥ を使ってください）';
    case 'noAdjustableSymbolOnRest':
      // 休符に付けられるのはテキスト系とオッターバだけなので、代替手順もそこへ限定して案内する
      return 'この休符には調整できる記号がありません（休符には歌詞・コード記号・テンポ表記・発想標語・オッターバを付けられます）';
  }
}

/** スラー/タイの削除に出す文言 */
export function describeDeletedArc(kind: 'tie' | 'slur'): string {
  return `${kind === 'tie' ? 'タイ' : 'スラー'}を削除しました${UNDO_HINT}`;
}

/** 松葉（クレッシェンド／デクレッシェンド）の削除に出す文言 */
export function describeDeletedHairpin(type: 'cresc' | 'dim'): string {
  return `${type === 'cresc' ? 'クレッシェンド' : 'デクレッシェンド'}（松葉）を削除しました${UNDO_HINT}`;
}

/**
 * 小節の背景クリックで連符数字をまとめて切り替えたときの文言（Issue #324）。
 *
 * 一度に何グループも変わる操作なので、「何が・いくつ変わったか」を必ず知らせる。
 * 画面を見れば数字の有無は分かるが、連符が段の外まで続く譜面では
 * 変わった範囲が視界に収まらないことがあるため。
 */
export function describeTupletNumbersToggledInMeasure(groupCount: number, hidden: boolean): string {
  return `この小節の連符数字を${groupCount}グループ${hidden ? '隠しました' : '表示しました'}${UNDO_HINT}`;
}

/**
 * 連符数字トグル中に、連符の無い小節の背景を押したときの文言（Issue #324・#318 の「行き止まりは喋る」）。
 *
 * 何も起きないだけだと「壊れている」のか「対象が無い」のかが利用者に分からないため、
 * 譜面を変えない代わりに理由を出す。
 */
export function describeNoTupletInMeasure(): string {
  return 'この小節には連符がないため、連符数字の一括切り替えはできません';
}

/**
 * クリックした拍まで手前を休符で埋めて音符を置いたときの文言（Issue #322）。
 *
 * 「置いたつもりの拍」と「実際に入った拍」がずれていないかは、譜面を見ただけでは
 * 気づきにくい（空の声部では特にそうで、1拍目に入っても不自然に見えない）。
 * 音符が増えるだけでなく休符も一緒に増える操作なので、何が起きたかを必ず知らせる。
 *
 * @param startBeat 置いた音符の開始拍（0 起点。表示は 1 起点へ直す）
 * @param voiceIndex アクティブ声部。多声の小節でだけ声部名を添える
 * @param isMultiVoice 声部が2つ以上ある小節か
 */
export function describeLeadingRestFill(
  startBeat: number,
  voiceIndex: number,
  isMultiVoice: boolean
): string {
  // 3.5拍目のような半端な位置もあるので、割り切れないときだけ小数を残す
  const beatLabel = Number((startBeat + 1).toFixed(2)).toString();
  const voiceLabel = isMultiVoice ? `声部${voiceIndex + 1}の` : '';
  return `${voiceLabel}${beatLabel}拍目に置き、手前の空いた拍を休符で埋めました${UNDO_HINT}`;
}

/** 選択した小節範囲をまとめて空にしたときの文言 */
/**
 * 拍範囲スライスの削除通知（#333 段2）。拍は1始まりで表示する。
 * endBeat は「排他的な終了境界」なので、開始拍と同じ「N拍目」表記に +1 して流用すると
 * 存在しない次の拍（4/4 で「5拍目」）が現れてしまう。終了側は
 * 小節末なら「小節末」、途中なら「N拍目の手前」と表現する（Codex round1 P2 対応）。
 */
export function describeClearedBeatRange(
  startMeasure: number,
  startBeat: number,
  endMeasure: number,
  endBeat: number,
  beatsPerMeasure: number,
): string {
  const from = `${startMeasure + 1}小節${formatBeatLabel(startBeat)}`;
  const to = `${endMeasure + 1}小節${formatBeatEndLabel(endBeat, beatsPerMeasure)}`;
  return `${from}〜${to}の範囲を休符にしました${UNDO_HINT}`;
}

function formatBeatLabel(beat: number): string {
  const rounded = Math.round(beat * 100) / 100;
  return `${rounded + 1}拍目`.replace('.0拍目', '拍目');
}

/** 排他的な終了境界の表示（小節末 / N拍目の手前） */
function formatBeatEndLabel(endBeat: number, beatsPerMeasure: number): string {
  if (endBeat >= beatsPerMeasure - 0.0001) return '末';
  return `${formatBeatLabel(endBeat)}の手前`;
}

/**
 * 拍範囲スライスのコピーを断る通知（#412）。
 * 範囲選択のあとにレイヤーを切り替えると、境界が新しいレイヤーの音符の切れ目に
 * 合わないことがある。黙って欠けたコピーを作らず、選び直しを案内する
 */
export function describeOttavaPlaced(kind: '8va' | '8vb' | '8vaEnd' | '8vbEnd'): string {
  // 括弧は開始と終了のペアが揃って初めて描画される。開始だけ置いた状態は
  // データに保存されるのに画面に何も出ず、「置けない」ように見えていた
  // （#318 の無言の行き止まり・実機で誤認 2026-08-26）。次の一手まで案内する
  switch (kind) {
    case '8va':
      return '8vaの開始を付けました（「8va終了」で範囲の最後の音符をクリックすると括弧が表示されます）';
    case '8vb':
      return '8vbの開始を付けました（「8vb終了」で範囲の最後の音符をクリックすると括弧が表示されます）';
    case '8vaEnd':
      return '8vaの終了を付けました';
    case '8vbEnd':
      return '8vbの終了を付けました';
  }
}

/** オッターバをトグルで外したときの通知 */
export function describeOttavaRemoved(kind: '8va' | '8vb' | '8vaEnd' | '8vbEnd'): string {
  return `${kind}を外しました`;
}

export function describeSliceCopyUnavailable(): string {
  return '選択範囲がこのレイヤーの音符の切れ目に合っていません（レイヤーを替えた場合は、範囲を選び直してからコピーしてください）';
}

/** 拍範囲スライスのコピー通知（#333 段2） */
export function describeSliceCopied(totalBeats: number): string {
  const rounded = Math.round(totalBeats * 100) / 100;
  return `${rounded}拍ぶんの範囲をコピーしました（小節選択ツールで貼り先を選んで Cmd/Ctrl+V）`;
}

/**
 * 小節の貼り付けで、コピー範囲の外を指していた弧・松葉を落としたときの通知。
 *
 * タイ/スラー・ヘアピンの終点は絶対小節インデックスなので、貼り付け先へ付け替える。
 * ただし終点がコピー範囲の外にある場合、その音符が貼り付け先にも同じ形で存在する
 * 保証がないため落とす。黙って消すと「コピーしたのに一部だけ消えた」に見えるので伝える。
 */
export function describeArcsDroppedOnPaste(count: number): string {
  return `貼り付け時に、コピー範囲の外へつながっていたスラー・タイ・松葉 ${count}件は付けませんでした（終点の音符が貼り付け先にないため）`;
}

/** 拍範囲スライスの貼り付け不成立の通知（#318「行き止まりは喋る」） */
export function describeSlicePasteUnavailable(reason: 'noSelection' | 'noFit' | 'boundary' | 'noEffect' | 'misaligned'): string {
  switch (reason) {
    case 'noSelection':
      return '貼り先が選ばれていません。小節選択ツールで貼り付け先の位置を選んでください';
    case 'noFit':
      return '貼り先の小節に収まらないため貼り付けませんでした（小節の拍数を超えます）';
    case 'boundary':
      return '貼り先の音符を途中で分断してしまうため貼り付けませんでした（音符の切れ目に合う位置を選んでください）';
    case 'noEffect':
      return '貼り付けても譜面が変わらないため、何もしませんでした（コピー内容も貼り先も無音か、対応するパートが無い譜面です）';
    case 'misaligned':
      return '複数小節にまたがるコピーは、内容が途切れないよう、コピー元と同じ小節内の位置にだけ貼り付けられます（貼り先の拍位置を合わせて選び直してください）';
  }
}

/** 旧手動保存の取り込み（#109 第4段）の結果通知 */
export function describeLegacyImportResult(result: 'done' | 'notFound' | 'readFailed' | 'blocked' | 'saveFailed'): string {
  switch (result) {
    case 'done':
      return '以前の手動保存を新しい作品として取り込みました（元のデータはそのまま残っています）';
    case 'notFound':
      return '取り込める以前の手動保存データが見つかりませんでした';
    case 'readFailed':
      return '以前の手動保存データを読み込めませんでした（データが壊れている可能性があります。元のデータには触れていません）';
    case 'blocked':
      return 'いまの内容を保存できなかったため、取り込みを中止しました（ブラウザ保存の空き容量を確認してください）';
    case 'saveFailed':
      return '取り込んだ内容を保存できませんでした（画面には表示されています。ブラウザ保存の空き容量を確認してください）';
  }
}

/** 復元履歴（#109 第3段）: 編集中の内容を保存できず復元を中止したことを知らせる（#318） */
export function describeWorkHistoryRestoreBlocked(): string {
  return '編集中の内容を保存できなかったため、復元を中止しました（ブラウザ保存の空き容量を確認してください）';
}

/** 復元履歴（#109 第3段）: 選んだ世代へ戻したことを知らせる */
export function describeWorkHistoryRestored(timestamp: number): string {
  const when = new Date(timestamp).toLocaleString('ja-JP');
  return `${when} の内容に戻しました（戻す前の内容も作品一覧の「履歴」に残っています）`;
}

/** 途中再生（#108）: 選択小節から再生を始めたことを知らせる */
export function describePlaybackFromMeasure(startMeasure: number): string {
  return `${startMeasure + 1}小節目から再生します（先頭から聴くには Escape で小節の選択を外してください）`;
}

/** 拍範囲スライスの削除で消すものが無かったときの通知（#318。履歴も積まない） */
export function describeSliceClearNoop(): string {
  return '選択範囲に音符が無いため、消すものがありませんでした';
}

/**
 * 拍範囲スライスの削除が不成立だったときの通知（#318「行き止まりは喋る」）。
 * 選択後の Undo などで譜面が変わり、境界が音符の切れ目に合わなくなったケース。
 * 一部の声部だけ消す部分適用はしない（貼り付けと同じ全計画→全適用の規則）。
 */
export function describeSliceDeleteUnavailable(): string {
  return '選択範囲が音符の切れ目に合わなくなったため削除しませんでした（範囲を選び直してください）';
}

/**
 * 拍範囲スライスを選択中は使えない小節単位の操作を、理由つきで断る通知（#318）。
 * 黙って効かないのではなく「なぜ効かないか・どうすればよいか」を必ず伝える。
 */
export function describeSliceMeasureOpUnavailable(op: 'transpose' | 'move' | 'measurePaste' | 'insertRemove'): string {
  const back = '小節全体を選択し直してください（Escape で解除して小節をクリック）';
  switch (op) {
    case 'transpose':
      return `拍の範囲を選択中は移調できません。${back}`;
    case 'move':
      return `拍の範囲を選択中は矢印キーでの選択移動はできません。${back}`;
    case 'measurePaste':
      return `拍の範囲を選択中は小節単位の貼り付けはできません。拍範囲をコピーし直すか、${back}`;
    case 'insertRemove':
      return `拍の範囲を選択中は小節の挿入・削除はできません。${back}`;
  }
}

export function describeClearedMeasures(start: number, end: number): string {
  const count = end - start + 1;
  // 小節番号は 0 始まりの内部インデックスなので、画面表記の 1 始まりへ直して伝える
  const range = count === 1 ? `${start + 1}小節目` : `${start + 1}〜${end + 1}小節目`;
  return `${range}の音符を削除しました${UNDO_HINT}`;
}
