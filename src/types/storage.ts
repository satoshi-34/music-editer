// src/types/storage.ts
// TypeScript interfaces and data models for score storage

import type { KeySignature } from '../utils/noteKeyUtils';
import type { InstrumentType } from '../audio/SoundSource';
import type { ClefType } from '../components/clefUtils';
import type { PageSizeId } from '../utils/pageSize';
import type { SavedPageMargins } from '../utils/measureLayoutUtils';

export type DurKey = '1' | '2' | '4' | '8' | '16' | '32' | '64';
export type TimeSignature = [number, number];

/**
 * 拍子記号の見た目（Issue #422）。
 * 'numeric' は従来どおりの数字表記（4/4）、'symbol' は 4/4 を C、
 * 2/2 をアッラ・ブレーヴェ（縦線入りの C）で描く。
 * 拍子データ（TimeSignature）そのものは変えず、表示の指定だけを分けて持つ。
 */
export type TimeSignatureStyle = 'numeric' | 'symbol';
export type AbsoluteDynamicMarking = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
/**
 * 変化強弱の文字表記。
 * 'descresc' は 'dim' と同じ意味（だんだん弱く）の別表記で、
 * 月光ソナタなどの実譜で使われる。再生時の音量変化も dim と同じ扱いにする。
 */
export type RelativeDynamicMarking = 'cresc' | 'dim' | 'descresc';
export type DynamicMarkingValue = AbsoluteDynamicMarking | RelativeDynamicMarking;

/**
 * アーティキュレーション（奏法記号）。音符1つの「鳴らし方」を指示する。
 * - staccato（スタッカート, 点）: 短く切る
 * - accent（アクセント, >）: その音を強く
 * - tenuto（テヌート, −）: 音価いっぱい保つ
 * - marcato（マルカート, ^）: 強く＋やや短く、はっきり
 * - fermata（フェルマータ, 𝄐）: その音を長めに伸ばす
 */
export type ArticulationMarking = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata';
/** `ArticulationType` は `ArticulationMarking` の別名。どちらも同じ文字列 union を指す */
export type ArticulationType = ArticulationMarking;

/**
 * 装飾音記号の種類。詳しい説明は下の `NoteEvent.ornament` を参照。
 * VexFlow コードとの対応（ねじれあり）は `src/utils/ornamentUtils.ts` を参照。
 */
export type OrnamentType = 'trill' | 'mordent' | 'mordentInverted' | 'turn';

/**
 * サイズ・位置の配置調整（symbolAdjust）を適用できる標準記号の種類。
 * カスタム記号（customSymbols）はこれとは別の仕組み（scale/offsetX/offsetY を直接保持）のまま。
 * - fingering / lyrics / chordSymbol / tempoMarking / expressionMarking:
 *   テキスト描画のため font-size × scale と位置 + offset の両方に対応
 * - dynamics: VexFlow が生成する SVG グループへの transform でサイズ・位置に対応
 * - articulations: VexFlow の Articulation グリフに対する SVG transform で位置調整のみ対応（サイズは未対応）
 * - ornament: VexFlow の Ornament グリフに対する SVG transform で位置調整のみ対応（サイズは未対応）
 * - ottava: 8va/8vb ブラケット（破線＋テキスト）を手組み SVG で描画しており、
 *   offsetX/offsetY はブラケット全体（破線・終端の縦線・テキスト）に効き、scale はテキストの
 *   font-size と線の太さに効く。開始イベント（'8va'/'8vb'）の symbolAdjust にのみ保存する。
 * 対応範囲の詳細・除外理由は .claude/specs/extended-notation-features/design.md を参照。
 */
export type AdjustableSymbolKind =
  | 'fingering'
  | 'ornament'
  | 'dynamics'
  | 'articulations'
  | 'lyrics'
  | 'chordSymbol'
  | 'tempoMarking'
  | 'expressionMarking'
  | 'ottava';

// ── カスタム記号（現代音楽用）──────────────────────────────────────────

/**
 * カスタム記号を構成する図形プリミティブ。
 * 座標系: (0,0) = 音符への接続点（アンカー）、y がマイナスで上方向。
 */
export type ShapePrimitive =
  | { kind: 'circle'; cx: number; cy: number; r: number; filled: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; strokeWidth?: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; sweepAngle: number }
  // フリーハンドの1ストローク。points は逐次記録した頂点列（アンカー基準の論理座標）
  | { kind: 'path'; points: { x: number; y: number }[]; strokeWidth?: number };

/** ユーザーが定義したカスタム記号の定義 */
export interface CustomSymbolDef {
  id: string;
  name: string;
  shapes: ShapePrimitive[];
  /**
   * フリーハンド線（path）へ手ぶれ補正（平滑化）をかけて表示するか。
   * 省略時は false（補正なし）＝この機能より前に保存された記号は従来どおりの見た目になる。
   * 補正は描画のたびに元の points から計算するだけなので、元のストロークは常に保持され、
   * オフに戻せば描いたままの線に戻る（「震え自体が意図」の記号のための逃げ道）。
   */
  smoothing?: boolean;
}

/** 強弱記号。NoteEvent にぶら下げて「この音符から効き始める記号」を表す */
export interface DynamicMarking {
  value: DynamicMarkingValue;
}

/** タイまたはスラーの弧。開始 NoteEvent の arcs[] に格納する */
export interface TieArc {
  fromKey: string;         // 開始符頭の key（例: "e/4"）
  toKey: string;           // 終了符頭の key
  toMeasureIndex: number;  // 終了音符の絶対小節インデックス
  toEventIndex: number;    // 終了音符のイベントインデックス
  kind: 'tie' | 'slur';
  /** ユーザーがドラッグで調節したコントロールポイントの縦ズレ量（SVG px）。省略時は 0 */
  cpDyOffset?: number;
  /** 段またぎ第2セグメント（下段側）の曲率オフセット。省略時は 0 */
  cpDyOffset2?: number;
  /**
   * ユーザーがドラッグで調節した頂点（弧の一番高いところ）の左右位置。
   * 「頂点が中央からずれる量 ÷ 弧のスパン」の比率で、正 = 右。省略時は 0。
   * SVG px ではなく比率にしているのは、段割りが変わって弧の幅が伸び縮みしても
   * 見た目の寄せ具合が保たれるようにするため。可動範囲は APEX_X_RATIO_MAX。
   * 膨らみ（cpDyOffset）とは独立に保存する。
   */
  apexXRatio?: number;
  /** 段またぎ第2セグメント（下段側）の頂点の左右位置。省略時は 0 */
  apexXRatio2?: number;
  /** 向き手動反転フラグ。true のとき自動算出の upward を反転する */
  flipDirection?: boolean;
  /** 始点X/Y調節量（SVG px）。省略時は 0 */
  startDx?: number;
  startDy?: number;
  /** 終点X/Y調節量（SVG px）。省略時は 0 */
  endDx?: number;
  endDy?: number;
  /** 段またぎ上段セグメントの切れ目終点X/Y調節量（SVG px）。省略時は 0 */
  breakEndDx?: number;
  breakEndDy?: number;
  /** 段またぎ下段セグメントの切れ目始点X/Y調節量（SVG px）。省略時は 0 */
  breakStartDx?: number;
  breakStartDy?: number;
}

/**
 * クレッシェンド／ディミヌエンドの松葉（ヘアピン）記号。
 * TieArc と同じ考え方で、開始 NoteEvent の hairpins[] に「開始点」として保持し、
 * 終了音符へは絶対小節インデックス・イベントインデックスで参照する。
 * - 'cresc': だんだん強く（開く松葉 <）
 * - 'dim'  : だんだん弱く（閉じる松葉 >）
 * 段（システム）をまたぐケースは未対応（既知の制限。詳細は
 * .claude/specs/extended-notation-features/design.md を参照）。
 */
export interface HairpinMark {
  type: 'cresc' | 'dim';
  /** 終了音符の絶対小節インデックス（TieArc.toMeasureIndex と同じ考え方） */
  endMeasure: number;
  /** 終了音符のイベントインデックス（TieArc.toEventIndex と同じ考え方） */
  endEvent: number;
  /** 縦位置の微調整（SVG px）。省略時は0 */
  offsetY?: number;
}

export interface NoteEvent {
  dur: DurKey;
  isRest: boolean;
  /**
   * 付点の数。1 = 付点（1.5倍）、2 = 複付点（1.75倍）。省略時は付点なし。
   * 旧セーブデータとの互換のため必須フィールドにしない。
   */
  dots?: 1 | 2;
  /**
   * 音高キーの配列（VexFlow 形式: "c/4", "f#/3" など）
   * 単音: 1要素、和音: 2要素以上
   * isRest が true の場合は空配列または任意の値（無視される）
   */
  keys: string[];
  /** レガシー。既存セーブデータの読み込み互換用に残す */
  tiedToNext?: boolean;
  /** タイ／スラーの弧リスト。この音符から他音符への接続を保持する */
  arcs?: TieArc[];
  /** クレッシェンド／ディミヌエンドの松葉（ヘアピン）リスト。この音符から効き始める記号を保持する */
  hairpins?: HairpinMark[];
  /** 強弱記号。この音符から効き始める記号を保持する */
  dynamics?: DynamicMarking[];
  /**
   * アーティキュレーション（奏法記号）。この音符に付く記号のリスト。
   * スタッカート＋アクセントのように複数を同時に付けられるため配列で持つ。
   */
  articulations?: ArticulationMarking[];
  /**
   * この音符に付けるカスタム記号の参照リスト。
   * scale は配置1件ごとの拡大縮小率（省略時は等倍 1.0）。
   * offsetX / offsetY は配置1件ごとの縦横位置の微調整（省略時は0、単位はSVG論理px）。
   * 同じ記号を複数の音符に付けても、音符ごとに別々の大きさ・位置にできる。
   */
  customSymbols?: { symbolId: string; scale?: number; offsetX?: number; offsetY?: number }[];
  /**
   * 標準記号（運指・装飾・強弱など）の配置ごとの表示調整。
   * customSymbols と同じ考え方（この音符に付いた記号だけの微調整）を、
   * カスタム記号以外の標準記号にも広げたもの。
   * キーは記号の種類（AdjustableSymbolKind）で、値の scale/offsetX/offsetY は
   * customSymbols の scale/offsetX/offsetY と同じ意味・同じ許容範囲を持つ。
   * 省略時は scale=1, offsetX=0, offsetY=0 として扱う。
   * MusicXML には出力しない（このアプリ独自の表示調整のため）。
   */
  symbolAdjust?: Partial<Record<AdjustableSymbolKind, { scale?: number; offsetX?: number; offsetY?: number }>>;
  /** 歌詞テキスト（音符の下に表示） */
  lyrics?: string;
  /** コード記号（音符の上に表示。例: Am, G7, Dm/F） */
  chordSymbol?: string;
  /** テンポ表記（例: Allegro, ♩=120）。その音符の位置に太字テキストで表示 */
  tempoMarking?: string;
  /** 発想標語（例: espressivo, dolce）。斜体テキストで表示 */
  expressionMarking?: string;
  /**
   * 運指番号（指使い）。基本は '1'〜'5' の単一数字だが、
   * 和音の場合は '1,3,5' のようにカンマ区切りで複数指定でき、
   * 指替えは '5-1' のように表せる自由文字列として持つ（バリデーションは緩め・8文字以内）。
   * 音符の上に小さいフォントで表示する。
   */
  fingering?: string;
  /**
   * 前打音のリスト（装飾音符）。
   * slash=true でスラッシュ付き（アッチャカトゥーラ）、false でロングアッポジャトゥーラ。
   * keys は音高（VexFlow 形式: "d/5" など）。複数音の前打音も可。
   */
  graceNotes?: { keys: string[]; slash: boolean }[];
  /**
   * 装飾音記号の種類。1音符につき1種類のみ（既存のトリルと同じ排他仕様）。
   * 'trill': 主音符の上に tr と波線を描く。
   * 'mordent': モルデント（下隣接音と1往復）。波線＋縦線の記号。
   * 'mordentInverted': プラルトリラー（上隣接音と1往復）。波線のみの記号。
   *   ※ VexFlow / SMuFL のコード名とグリフの対応がねじれているため、
   *      実際の描画コードとの対応は src/utils/ornamentUtils.ts のコメントを参照。
   * 'turn': ターン（S字型の記号）。
   */
  ornament?: OrnamentType;
  /**
   * ペダル記号。
   * 'down': この音符からペダルを踏む（Ped 記号を表示）
   * 'up':   この音符でペダルを離す（✱ 記号を表示）
   */
  pedalMark?: 'down' | 'up';
  /**
   * オッターバ（8va / 8vb）記号。
   * '8va': 五線の上に 8va 括弧を開始する（1オクターブ上で実音表示）
   * '8vb': 五線の下に 8vb 括弧を開始する（1オクターブ下で実音表示）
   * '8vaEnd' / '8vbEnd': 対応する括弧の終端を示す
   */
  ottava?: '8va' | '8vb' | '8vaEnd' | '8vbEnd';
  /**
   * 連符情報。同じ id を持つ連続イベントが1つの連符グループを構成する。
   * numNotes 個ぶんの音符を notesOccupied 拍分の時間に詰め込む（例: 3連符なら numNotes=3, notesOccupied=2）。
   * 旧セーブデータとの互換のため省略可能にする。
   *
   * hideNumber: このグループの連符数字（3 等）を表示しないかどうか（Issue #269）。
   * 同じ連符が続く曲では最初のグループにだけ数字を書くのが浄書の慣行なので、
   * グループ単位で手動オフにできるようにしている。省略時（undefined）は従来どおり表示するため、
   * 既存の保存データの見た目は変わらない。
   */
  tuplet?: { id: string; numNotes: number; notesOccupied: number; hideNumber?: boolean };
  /**
   * 微分音（四分音）の臨時記号。和音の各音（keys配列のインデックス=keyIndex）ごとに1つ持つ。
   * 'quarterSharp': 半音の半分（+50セント）上げる、'quarterFlat': 半音の半分（-50セント）下げる。
   * 通常の ♯/♭/♮ とは排他（同じ keyIndex に両方は持たない）。3/4音は対象外。
   * 旧セーブデータとの互換のため省略可能にする。
   */
  microtones?: { keyIndex: number; type: 'quarterSharp' | 'quarterFlat' }[];
  /**
   * 小節の途中での音部記号（クレフ）変更（Issue #424）。
   * このイベントの**直前に小型のクレフ**を描き、以降はそのクレフが有効になる
   * （次のイベント単位の変更、または次の小節単位の変更 `MeasureData.clef` まで持続する）。
   * 実際の楽譜の慣習どおり小節をまたいでも持続する。
   *
   * 例: 月光第1楽章37小節では、右手が小節の途中でト音記号→ヘ音記号に切り替わる。
   * 小節単位の `MeasureData.clef` では「小節の頭から」しか変えられないため、この項目を使う。
   *
   * 省略時は従来どおり「その小節時点で有効なクレフ」を継続する。元に戻すときは値を
   * undefined 等にせず**プロパティごと削除**する（旧データと同じ形に戻り、保存内容が増えない）。
   * v1 では主声部（`MeasureData.events`）のイベントに付けたものだけを有効とする。
   */
  clefChange?: ClefType;
  /**
   * 段またぎ記譜（cross-staff）: この音符を**どの五線に描くか**だけを切り替える（Issue #309）。
   * 'below' = 1つ下のパートの五線、'above' = 1つ上のパートの五線。
   * ピアノ譜で「右手の低い音を、加線だらけを避けるため下の五線に描く」慣習のための項目。
   *
   * 変わるのは見た目の置き場所だけで、「どの声部の音か」（所属・リズム・再生）は一切変わらない。
   * 省略時は従来どおり自分のパートの五線に描く。元に戻すときは値を false 等にせず
   * **プロパティごと削除**する（旧データと同じ形に戻り、保存内容が増えない）。
   * 相手の五線が無いとき（端のパートで無効な向き・単段編成・パート譜表示）は、
   * データは保持したまま描画だけ自分の五線へフォールバックする。
   */
  renderStaff?: 'below' | 'above';
}

/**
 * 同じ小節内の別声部。
 * まずはピアノ譜の 2 voice を想定し、符幹の向きもここで持てるようにする。
 */
export interface VoiceData {
  id: string;
  stemDirection?: 'up' | 'down';
  events: NoteEvent[];
}

export interface MeasureData {
  /**
   * 既存実装との互換のため、primary voice は引き続き events にも保持する。
   * multi-voice 小節では「編集系は events を正本、描画系は voices も参照」として扱う。
   */
  events: NoteEvent[];
  /** ピアノ譜などで同じ小節に複数声部を置きたいときの追加データ */
  voices?: VoiceData[];
  /** 小節の左側に開始リピート（||:）を表示する */
  repeatStart?: boolean;
  /** 小節の右側に終了リピート（:||）を表示する */
  repeatEnd?: boolean;
  /**
   * 1番括弧 / 2番括弧の所属番号。
   * 連続する同じ番号の小節をまとめて、上に終止括弧として描画する。
   */
  ending?: 1 | 2;
  /**
   * この小節から適用するテンポ（BPM）。
   * 省略時は直前の小節のテンポ、または楽譜全体のグローバルテンポを継続する。
   * 60〜240 の範囲で設定する。
   */
  bpm?: number;
  /**
   * この小節から適用する拍子。
   * 省略時は直前の小節の拍子、または楽譜全体のグローバル拍子を継続する。
   * 4/4 から 3/8 への変更などを小節単位で記録する。
   */
  timeSignature?: TimeSignature;
  /**
   * この小節から適用する調号。
   * 省略時は直前の小節の調号、または楽譜全体のグローバル調号を継続する。
   * ト長調からヘ長調への変更などを小節単位で記録する。
   */
  keySignature?: KeySignature;
  /**
   * この小節から適用する音部記号（クレフ）。
   * 省略時は直前の小節のクレフ、またはパートの既定クレフ（PartData.clef）を継続する。
   * チェロのテナー記号への切り替えなど、曲の途中でのクレフ変更を記録する。
   */
  clef?: ClefType;
  /**
   * この小節に付くリハーサルマーク（練習番号）。
   * "A" 〜 "Z"、"AA" のようなアルファベット、または "1" のような数字も
   * 自由入力できるように文字列型にしている（1〜4文字）。
   * 省略時は「この小節にはリハーサルマークが無い」ことを表す。
   */
  rehearsalMark?: string;
  /**
   * この小節を「不完全小節（弱起・アウフタクト）」として扱い、その実拍数を持つ（Issue #473）。
   * 4分音符 = 1拍（timeSignatureUtils の getMeasureBeats と同じ単位）。
   * 省略時は「拍子どおりの完全小節」で、従来のデータと同じ意味になる。
   * MusicXML の <measure implicit="yes"> に対応し、曲頭だけでなく曲中の不完全小節も表せる。
   * 正本はパート0の小節（timeSignature / keySignature と同じ規約）で、
   * 書き込みは「全パートへ同じ値を書く」経路にそろえる。
   */
  pickupBeats?: number;
  /**
   * この小節に付く自由注釈テキスト（音符に紐づかないテキスト。Issue #421）。
   * 献呈・演奏メモ・冒頭の指示文（月光の「senza sordini」など）を想定している。
   * 小節に持たせているのは、段割り（段あたり小節数）を変えても
   * 「この小節の近くに置いた」という意図のまま付いてくるようにするため。
   * 省略時は「この小節には自由注釈が無い」ことを表す。
   */
  freeText?: FreeTextAnnotation;
}

/**
 * 自由注釈テキスト1つぶん。小節アンカー（どの小節に置いたか）＋オフセット（そこからのズレ）で
 * 位置を表す。ページ上の絶対座標にしないのは、段割りを変えたときにテキストだけ
 * 紙面に取り残されるのを避けるため。
 */
export interface FreeTextAnnotation {
  /** 表示する文字列（1行）。空文字列は「注釈なし」なので、保存時はフィールドごと削除する */
  text: string;
  /** 既定位置からの横ズレ（px、正で右）。省略時は 0 */
  offsetX?: number;
  /** 既定位置からの縦ズレ（px、正で下）。省略時は 0 */
  offsetY?: number;
  /** 既定サイズに対する倍率（1 = 既定）。省略時は 1 */
  scale?: number;
  /**
   * 書体の id（Issue #432）。選択肢はタイトル書体（TITLE_FONT_OPTIONS）と同じものを共用する。
   * 省略時は「既定」＝発想標語と同じイタリックのセリフ体で、既存の注釈は見た目が変わらない。
   * 未知の id（手書き JSON・将来の一覧変更）は読み込み時に既定へ倒す（titleFontId と同じ流儀）。
   */
  fontId?: string;
}

export interface ScoreMetadata {
  title: string;
  subtitle: string;
  lyricist: string;
  composer: string;
  arranger: string;
}

/** スコアの種類（単旋律 / ピアノ大譜表 / 弦楽四重奏 / 可変編成） */
export type ScoreType = 'single' | 'piano' | 'quartet' | 'ensemble';

export type InstrumentFamily = 'woodwind' | 'brass' | 'percussion' | 'strings' | 'keyboard' | 'vocal' | 'other';
export type InstrumentBracketGroup = 'woodwinds' | 'brass' | 'percussion' | 'strings' | 'keyboard' | 'voices' | 'solo';

/** 将来のオケ譜・パート譜生成に使う、譜表単位ではなく楽器パート単位の編成定義 */
export interface InstrumentPartDefinition {
  id: string;
  name: string;
  abbreviation: string;
  family: InstrumentFamily;
  clef: 'treble' | 'bass' | 'alto';
  staffCount: number;
  transposition: 'C' | 'Bb' | 'Eb' | 'F' | 'G' | 'octave-down' | 'none';
  bracketGroup: InstrumentBracketGroup;
  /**
   * セクション内のサブグループ識別子。例: 弦のなかで Vln I/Vln II を
   * 細い括弧でひとまとめにしたい場合などに使う。
   * 同じ値が連続するパートだけが 1 本のサブ括弧でくくられる。
   */
  subBracketGroup?: string;
  playbackInstrument?: InstrumentType;
  order: number;
}

export type InstrumentationPresetId =
  | 'single'
  | 'piano'
  | 'string-quartet'
  | 'string-orchestra'
  | 'chamber-orchestra'
  | 'classical-orchestra'
  | 'romantic-orchestra'
  | 'wind-band'
  | 'vocal-piano'
  | 'recorder-vocal'
  | 'custom';

/**
 * 編成譜の表示モード。
 *
 * - `concert`: 実音表示（鳴る音そのままを記譜する）。データの正本もこちら。
 * - `written`: 記譜音表示（各パートの `transposition` に従って譜面上をシフト）。
 *   編集時は画面上の記譜音を実音へ戻して保存する。再生は常に実音側を使うので、
 *   表示モードを切り替えても響きは変わらない。
 */
export type ScoreNotationMode = 'concert' | 'written';

export interface ScoreInstrumentation {
  presetId: InstrumentationPresetId;
  name: string;
  parts: InstrumentPartDefinition[];
}

/** 1パート（右手・左手など）のデータ */
export interface PartData {
  partId: string;           // 'melody' | 'right-hand' | 'left-hand' | 'violin-1' | 'violin-2' | 'viola' | 'cello'
  clef: ClefType;
  measures: MeasureData[];
}

export interface SavedScoreData {
  version: string;
  timestamp: number;
  metadata: ScoreMetadata;
  scoreType: ScoreType;
  /** 調号。旧データ互換のため省略時は C（調号なし）として扱う */
  keySignature?: KeySignature;
  /** 拍子。旧データ互換のため省略時は 4/4 として扱う */
  timeSignature?: TimeSignature;
  /** 編成テンプレート。旧データ互換のため省略可 */
  instrumentation?: ScoreInstrumentation;
  /** 編成譜の表示モード（実音/記譜音）。旧データ互換のため省略可、省略時は実音表示 */
  notationMode?: ScoreNotationMode;
  /**
   * タイトル・サブタイトル・作者欄のフォント（Issue #342）。
   * utils/titleFontOptions.ts の一覧の id。旧データ互換のため省略可で、
   * 省略時・未知の id は既定（現行の浄書セリフ体のまま）として扱う。
   */
  titleFontId?: string;
  /**
   * タイトルブロック（タイトル・サブタイトル・作者欄）の文字サイズ倍率（Issue #420）。
   * px の実値ではなく既定の見た目に対する倍率で、1 = 従来どおり。
   * 旧データ互換のため省略可。省略時・数値でない値は 1、範囲外は最小/最大へクランプ
   * （normalizeTitleFontSize が正本。#420 round1 P2 でクランプを正と確定）。
   */
  titleFontSize?: number;
  /**
   * タイトルブロックの太さ（Issue #420）。'normal' | 'bold'。
   * 旧データ互換のため省略可で、省略時は従来どおり（タイトル行だけ太字）。
   */
  titleFontWeight?: string;
  /**
   * 拍子記号を数字で描くか記号（C / 𝄵）で描くか（Issue #422）。
   * 旧データ互換のため省略可で、省略時は数字表記として扱う。
   */
  timeSignatureStyle?: TimeSignatureStyle;
  /**
   * 用紙サイズ（Issue #495）。'a4' | 'b4' | 'a3'。
   * 「表示設定」ではなく**作品の属性**として保存するので、別の環境で開き直しても
   * 同じ判型で開く。旧データ互換のため省略可で、省略時・未知の値は既定の A4 として
   * 扱う（normalizePageSizeId が正本）。既定（A4）のときは項目自体を書き出さないため、
   * 従来の保存データとの差分は増えない。
   */
  pageSize?: PageSizeId;
  /**
   * 「音符の大きさ」倍率（Issue #477）。0.8〜2.0。
   * MusicXML の `<defaults><scaling>` から引き継いだ縮尺を、その作品の属性として保存する
   * （#495 の用紙サイズと同じ原則で、別の環境で開き直しても同じ縮尺で開く）。
   * 旧データ互換のため省略可で、省略時は従来どおり表示設定（localStorage の
   * 「音符の大きさ」スライダー値）に従う。工場出荷既定値と同じときは項目自体を
   * 書き出さないため、従来の保存データとの差分は増えない。
   */
  notationSizeMultiplier?: number;
  /**
   * ページ余白（mm、Issue #477）。左右・上・下。
   * MusicXML の `<defaults><page-layout><page-margins>` から引き継いだ余白を作品の属性として
   * 保存する。notationSizeMultiplier と同じく省略可で、省略時は表示設定に従う。
   */
  pageMargins?: SavedPageMargins;
  /**
   * 作品ごとの全体テンポ（♩=N、Issue #543）。再生パネルに出す「その作品のテンポ」で、
   * 小節ごとの数値テンポ変更（`MeasureData.bpm`）や速度標語より弱い（最初の既定値になる）。
   *
   * 用紙サイズ（#495）・音符の大きさ（#477）と同じく**作品の属性**として保存するので、
   * 別の作品へ切り替えても前の作品のテンポが残らない。旧データ互換のため省略可で、
   * 省略時は従来どおりアプリ全体設定（localStorage の music-app-tempo-settings）→
   * 無ければ 120 として開く（normalizeSavedGlobalBpm が正本）。
   */
  globalBpm?: number;
  parts: PartData[];
  systems: number;
  measuresPerSystem: number;
  /** ユーザー定義カスタム記号ライブラリ。旧データ互換のため省略可 */
  customSymbolDefs?: CustomSymbolDef[];
  /**
   * 段ごとの小節数のユーザー上書き。「絶対小節インデックス startMeasure から始まる段は
   * count 小節」という意味で保持する。小節の挿入・削除で多少ずれても意味を保ちやすいよう、
   * 段の並び順ではなく開始小節番号をキーにしている。旧データ互換のため省略可（省略時は
   * 自動計画のみ）。
   */
  systemMeasureOverrides?: SystemMeasureOverride[];
  /**
   * 段ごとの間隔（上の段との距離）のユーザー上書き。「絶対小節インデックス startMeasure
   * から始まる段は、レイアウトタブの『段の間隔』設定に加えて gapPx ぶん追加で間隔を空ける（負値は
   * 詰める）」という意味で保持する。systemMeasureOverrides と同様、段の並び順ではなく
   * 開始小節番号をキーにすることで、小節の挿入・削除があっても意味を保ちやすくしている。
   * 旧データ互換のため省略可（省略時は全段とも追加オフセット0＝全体設定のみが効く）。
   */
  systemRowGapOverrides?: SystemRowGapOverride[];
}

/** 「小節 startMeasure から始まる段は count 小節」という段ごとの手動上書き。 */
export interface SystemMeasureOverride {
  startMeasure: number;
  count: number;
}

/** 「小節 startMeasure から始まる段の間隔（上の段との距離）に gapPx を追加する」という段ごとの手動上書き。 */
export interface SystemRowGapOverride {
  startMeasure: number;
  gapPx: number;
}

export interface StorageMetadata {
  lastSaved: number;
  version: string;
  dataChecksum?: string;
}

/**
 * 作品カタログ1件ぶんの要約情報（作品一覧の表示に使う軽い情報だけを持つ）。
 * 譜面データ本体（SavedScoreData）はサイズが大きいので、ここには入れず
 * 作品IDから引ける別のキー（スロット）に保存する。
 */
export interface WorkSummary {
  /** 作品ID。localStorage のキー名の一部にもなるため、英数字とハイフンのみ許可する */
  id: string;
  /** 一覧表示用のタイトル。SavedScoreData.metadata.title のコピー（空文字なら画面側で「無題」と表示する） */
  title: string;
  /** 最終更新時刻（ミリ秒）。一覧の並び替えに使う */
  updatedAt: number;
  /** 作成時刻（ミリ秒） */
  createdAt: number;
}

/**
 * 作品カタログ本体。localStorage には「実在する作品IDの一覧」を列挙する API が無いため、
 * このカタログが「どの作品が存在するか」の正本（唯一の正しい情報源）になる。
 */
export interface WorkIndex {
  /** カタログ自体のバージョン（将来カタログの構造を変えるときの移行判定に使う） */
  version: string;
  works: WorkSummary[];
  /** 起動時に「前回の続き」として開く作品ID（未設定なら null） */
  lastOpenedWorkId: string | null;
}

export const StorageErrorType = {
  QUOTA_EXCEEDED: 'quota_exceeded',
  STORAGE_DISABLED: 'storage_disabled',
  CORRUPTED_DATA: 'corrupted_data',
  UNKNOWN_ERROR: 'unknown_error'
} as const;

export type StorageErrorType = typeof StorageErrorType[keyof typeof StorageErrorType];

export interface StorageError {
  type: StorageErrorType;
  message: string;
  recoverable: boolean;
}

export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: StorageError;
}
