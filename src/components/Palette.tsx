// src/components/Palette.tsx
// ─────────────────────────────────────────────────────────────
// 目的：ツールバーのボタンに「五線なし」の音符/休符アイコンを表示する。
// 仕様：VexFlowで1音(または休符)を描画 → 実際の描画要素の合成BBoxから
//       SVGの viewBox を作り、ボタン内の枠に等比フィット。
//       色は #111 で強制して"白抜け"を回避。
// ★新機能：全ての音符/休符の「見た目サイズ」を個別に調整できるようにした。
//        （下の FILL_TWEAKS を編集するだけでOK。キー一覧は型 SymKey を参照）
// 初学者向けにコメントを多めに入れています。
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';
import type { AccidentalToolKind } from '../utils/noteKeyUtils';
import type { EndingNumber, RepeatMarkerKind } from '../utils/repeatMarkerUtils';
import type { ArticulationType, CustomSymbolDef, DynamicMarkingValue, OrnamentType } from '../types/storage';
import { articulationLabel } from '../utils/articulationUtils';
import { ornamentLabel } from '../utils/ornamentUtils';
import { symbolDefToPreviewSvg } from '../utils/customSymbolUtils';
import { type TextElementKind, textElementLabel } from '../utils/textElementUtils';

// ========== 表示サイズ＆色（コンパクト版） ==========
const BUTTON_W = 36;   // ボタン幅（縮小）
const BUTTON_H = 30;   // ボタン高さ（縮小）

// ボタンの中に置くアイコン用 SVG の物理解像度
const CANVAS_W = 32;   // 横幅
const CANVAS_H = 26;   // 高さ
const COLOR   = '#111';// 強制色（テーマに影響されない濃い黒）
const MIN_PAD = 1;     // 最低限の余白（食み出し防止の保険）
// ========================================================

// 取り扱う音価（全=1, 2=二分, 4=四分, 8=八分…）
export type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';

// VexFlowでの記法へ変換：'1→w', '2→h', '4→q', それ以外は同じ
export function normalizeToVF(d: DurKey): 'w'|'h'|'q'|'8'|'16'|'32'|'64' {
  return d==='1'?'w':d==='2'?'h':d==='4'?'q':d;
}

// ツール（「音価」と「休符かどうか」、またはタイモード）
export type Tool =
  | { duration: DurKey; isRest?: boolean; dots?: 1; tuplet?: boolean }  // 通常の音符/休符入力（dots: 1で付点, tuplet: trueで3連符モード）
  | { mode: 'select' }                      // 小節選択モード（コピー&ペースト用）
  | { mode: 'tie' }                         // タイ記号を付けるモード
  | { mode: 'accidental'; accidental: AccidentalToolKind }  // 臨時記号を付けるモード
  | { mode: 'repeat'; repeat: RepeatMarkerKind }            // リピート記号を付けるモード
  | { mode: 'ending'; ending: EndingNumber }                // 1番括弧 / 2番括弧
  | { mode: 'dynamic'; dynamic: DynamicMarkingValue }       // 強弱記号を付けるモード
  | { mode: 'articulation'; articulation: ArticulationType }  // アーティキュレーション記号を付けるモード
  | { mode: 'customSymbol'; symbolId: string }               // カスタム記号を付けるモード
  | { mode: 'customSymbolResize'; symbolId: string }         // カスタム記号のサイズを変更するモード（対象の音符をクリック）
  | { mode: 'customSymbolOffset'; symbolId: string }         // カスタム記号の位置を調整するモード（対象の音符をクリック）
  | { mode: 'symbolAdjustResize' }                          // 標準記号（運指・強弱など）も含めた汎用サイズ調整モード（対象の音符をクリック→調整対象を選ぶ）
  | { mode: 'symbolAdjustOffset' }                           // 標準記号も含めた汎用位置調整モード（対象の音符をクリック→調整対象を選ぶ）
  | { mode: 'textElement'; textKind: TextElementKind }      // テキスト要素（歌詞・コード・テンポ・発想標語）を付けるモード
  | { mode: 'measureTempo' }                                // 小節単位のテンポ変更モード
  | { mode: 'measureTimeSig' }                             // 小節単位の拍子変更モード
  | { mode: 'measureKeySig' }                               // 小節単位の調号変更モード
  | { mode: 'measureClef' }                                  // 小節単位のクレフ（音部記号）変更モード
  | { mode: 'graceNote' }                                  // 前打音（スラッシュ付き短前打音）を付けるモード
  | { mode: 'ornament'; ornamentType: OrnamentType }       // 装飾記号（トリル/モルデント/プラルトリラー/ターン）を付けるモード
  | { mode: 'pedal'; pedalType: 'down' | 'up' }           // ペダル記号（Ped / ✱）を付けるモード
  | { mode: 'ottava'; ottavaType: '8va' | '8vb' | '8vaEnd' | '8vbEnd' } // オッターバ記号を付けるモード
  | { mode: 'hairpin'; hairpinType: 'cresc' | 'dim' };     // 松葉（クレッシェンド＜／ディミヌエンド＞）を付けるモード。タイと同様に開始音符→終了音符へドラッグして設置

type AccidentalTool = Extract<Tool, { mode: 'accidental' }>;
type RepeatTool = Extract<Tool, { mode: 'repeat' }>;
type EndingTool = Extract<Tool, { mode: 'ending' }>;
type DynamicTool = Extract<Tool, { mode: 'dynamic' }>;
type ArticulationTool = Extract<Tool, { mode: 'articulation' }>;

// 並べるアイテム（上段=音符, 下段=休符）
const ROW1: Tool[] = ['1','2','4','8','16','32','64'].map(d => ({ duration: d as DurKey }));
const ROW2: Tool[] = ROW1.map(t => ({ ...t, isRest: true }));

// ─────────────────────────────────────────────────────────────
// ★ ここが"サイズ調整ダイヤル"です！
//    ・BASE_FILL … 全体の基準の大きさ（数値が小さいほど"見た目が小さく"なる）
//    ・FILL_TWEAKS … 記号別の上書き（なければ BASE_FILL が使われます）
// ─────────────────────────────────────────────────────────────
const BASE_FILL = 0.60;

type SymKey =
  | 'w'|'h'|'q'|'8'|'16'|'32'|'64'
  | 'wr'|'hr'|'qr'|'8r'|'16r'|'32r'|'64r';

const FILL_TWEAKS: Partial<Record<SymKey, number>> = {
  w:  0.25,
  wr: 0.20,
  hr: 0.20,
  '8r': 0.40,
  '32':  0.75,
  '32r': 0.75,
  '64':  0.85,
  '64r': 0.85,
};
// ─────────────────────────────────────────────────────────────

// タイツールの定数
const TIE_TOOL: Tool = { mode: 'tie' };
const ACCIDENTAL_TOOLS: AccidentalTool[] = [
  { mode: 'accidental', accidental: 'sharp' },
  { mode: 'accidental', accidental: 'flat' },
  { mode: 'accidental', accidental: 'natural' },
];
const REPEAT_TOOLS: RepeatTool[] = [
  { mode: 'repeat', repeat: 'start' },
  { mode: 'repeat', repeat: 'end' },
];
const ENDING_TOOLS: EndingTool[] = [
  { mode: 'ending', ending: 1 },
  { mode: 'ending', ending: 2 },
];
const DYNAMIC_TOOLS: DynamicTool[] = [
  { mode: 'dynamic', dynamic: 'pp' },
  { mode: 'dynamic', dynamic: 'p' },
  { mode: 'dynamic', dynamic: 'mp' },
  { mode: 'dynamic', dynamic: 'mf' },
  { mode: 'dynamic', dynamic: 'f' },
  { mode: 'dynamic', dynamic: 'ff' },
  { mode: 'dynamic', dynamic: 'cresc' },
  { mode: 'dynamic', dynamic: 'dim' },
];
const ARTICULATION_TOOLS: ArticulationTool[] = [
  { mode: 'articulation', articulation: 'staccato' },
  { mode: 'articulation', articulation: 'accent' },
  { mode: 'articulation', articulation: 'tenuto' },
  { mode: 'articulation', articulation: 'fermata' },
];

/** テキスト要素ツール一覧（歌詞・コード記号・テンポ表記・発想標語） */
const TEXT_ELEMENT_TOOLS: Array<{ mode: 'textElement'; textKind: TextElementKind }> = [
  { mode: 'textElement', textKind: 'lyrics' },
  { mode: 'textElement', textKind: 'chordSymbol' },
  { mode: 'textElement', textKind: 'tempoMarking' },
  { mode: 'textElement', textKind: 'expressionMarking' },
  { mode: 'textElement', textKind: 'fingering' },
];

// ボタン共通スタイルを生成するヘルパー
function btnStyle(active: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: BUTTON_W,
    height: BUTTON_H,
    padding: 0,
    borderRadius: 6,
    border: active ? '2px solid #3b82f6' : '1px solid #ccc',
    background: active ? '#eff6ff' : '#fff',
    color: '#222',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    ...extra,
  };
}

// アクセント色ボタン（前打音・トリル・ペダル・オッターバ）
function accentBtnStyle(active: boolean): React.CSSProperties {
  return {
    ...btnStyle(false),
    border: active ? '2px solid #7c3aed' : '1px solid #ccc',
    background: active ? '#f5f3ff' : '#fff',
  };
}

export default function Palette({
  value, onChange,
  section = 'notes',
  customSymbolDefs = [],
  onOpenSymbolEditor,
}: {
  value: Tool;
  onChange: (t: Tool) => void;
  /** 表示するパレットの種別。'notes'=音符・休符、'symbols'=演奏記号 */
  section?: 'notes' | 'symbols';
  customSymbolDefs?: CustomSymbolDef[];
  onOpenSymbolEditor?: () => void;
}) {
  // 現在の選択状態を判定
  const selectActive = 'mode' in value && value.mode === 'select';
  const tieActive = 'mode' in value && value.mode === 'tie';
  const dotActive = 'duration' in value && !!value.dots;
  const tupletActive = 'duration' in value && !!value.tuplet;
  const selectedAccidental = 'mode' in value && value.mode === 'accidental' ? value.accidental : null;
  const selectedRepeat = 'mode' in value && value.mode === 'repeat' ? value.repeat : null;
  const selectedEnding = 'mode' in value && value.mode === 'ending' ? value.ending : null;
  const selectedDynamic = 'mode' in value && value.mode === 'dynamic' ? value.dynamic : null;
  const selectedArticulation = 'mode' in value && value.mode === 'articulation' ? value.articulation : null;
  const selectedCustomSymbolId = 'mode' in value && value.mode === 'customSymbol' ? value.symbolId : null;
  const selectedCustomSymbolResizeId = 'mode' in value && value.mode === 'customSymbolResize' ? value.symbolId : null;
  const selectedCustomSymbolOffsetId = 'mode' in value && value.mode === 'customSymbolOffset' ? value.symbolId : null;
  const symbolAdjustResizeActive = 'mode' in value && value.mode === 'symbolAdjustResize';
  const symbolAdjustOffsetActive = 'mode' in value && value.mode === 'symbolAdjustOffset';
  const selectedTextKind = 'mode' in value && value.mode === 'textElement' ? value.textKind : null;
  const measureTempoActive = 'mode' in value && value.mode === 'measureTempo';
  const measureTimeSigActive = 'mode' in value && value.mode === 'measureTimeSig';
  const measureKeySigActive = 'mode' in value && value.mode === 'measureKeySig';
  const measureClefActive = 'mode' in value && value.mode === 'measureClef';
  const graceNoteActive = 'mode' in value && value.mode === 'graceNote';
  const selectedOrnamentType = 'mode' in value && value.mode === 'ornament' ? value.ornamentType : null;
  const pedalDownActive = 'mode' in value && value.mode === 'pedal' && (value as any).pedalType === 'down';
  const pedalUpActive = 'mode' in value && value.mode === 'pedal' && (value as any).pedalType === 'up';
  const ottava8vaActive = 'mode' in value && value.mode === 'ottava' && (value as any).ottavaType === '8va';
  const ottava8vbActive = 'mode' in value && value.mode === 'ottava' && (value as any).ottavaType === '8vb';
  const ottava8vaEndActive = 'mode' in value && value.mode === 'ottava' && (value as any).ottavaType === '8vaEnd';
  const ottava8vbEndActive = 'mode' in value && value.mode === 'ottava' && (value as any).ottavaType === '8vbEnd';
  const selectedHairpinType = 'mode' in value && value.mode === 'hairpin' ? value.hairpinType : null;

  const ROW_STYLE: React.CSSProperties = { display: 'flex', gap: 3, flexWrap: 'wrap' as const };

  if (section === 'notes') {
    return (
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* 音符行：選択 + 7音価 + タイ + 臨時記号3 */}
        <div style={ROW_STYLE}>
          {/* 選択ツール */}
          <button
            type="button"
            onClick={() => onChange(selectActive ? ROW1[2] : { mode: 'select' })}
            title="小節選択（クリックで選択 → Cmd+C でコピー → Cmd+V でペースト）"

            aria-label="小節選択（クリックで選択 → Cmd+C でコピー → Cmd+V でペースト）"
            style={btnStyle(selectActive, { fontSize: 15 })}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="14" height="14" rx="2" stroke="#333" strokeWidth="1.5" strokeDasharray="3 2" fill="none"/>
              <path d="M8 6 L12 9 L9.5 9.5 L11 13 L9.5 13.5 L8 10 L6 12 Z" fill="#333"/>
            </svg>
          </button>
          {ROW1.map((t, i) => {
            const active = !tieActive && 'duration' in value && 'duration' in t &&
              value.duration === t.duration && !value.isRest;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChange(t)}
                title={`音符 ${label((t as {duration: DurKey}).duration)}`}

                aria-label={`音符 ${label((t as {duration: DurKey}).duration)}`}
                style={btnStyle(active)}
              >
                <NoteIcon duration={(t as {duration: DurKey}).duration} isRest={false} />
              </button>
            );
          })}
          {/* 付点トグル：ONのまま音符/休符を置くと dots:1 が付く（キーボードの「.」でも切替可） */}
          <button
            type="button"
            onClick={() => {
              if ('duration' in value) {
                onChange({ ...value, dots: value.dots ? undefined : 1 });
              } else {
                onChange({ ...(ROW1[2] as { duration: DurKey; isRest?: boolean }), dots: 1 });
              }
            }}
            title="付点（音価を1.5倍に伸ばす。「.」キーでも切替可）"
            aria-label="付点（音価を1.5倍に伸ばす。「.」キーでも切替可）"
            // 付点ONのときは背景色を変えて、押し忘れ/押しっぱなしが見た目で分かるようにする
            style={btnStyle(dotActive, { fontSize: 20, fontWeight: 'bold' })}
          >
            .
          </button>
          {/* 3連符トグル：ONの状態で音価ツール+クリックすると、音符1つ＋休符2つの3連符グループを配置する */}
          <button
            type="button"
            onClick={() => {
              if ('duration' in value) {
                onChange({ ...value, tuplet: value.tuplet ? undefined : true });
              } else {
                onChange({ ...(ROW1[2] as { duration: DurKey; isRest?: boolean }), tuplet: true });
              }
            }}
            title="3連符（選択した音価で1音+休符2つの3連符グループを配置する）"
            aria-label="3連符（選択した音価で1音+休符2つの3連符グループを配置する）"
            style={btnStyle(tupletActive, { fontSize: 10, fontWeight: 'bold', width: 30 })}
          >
            3連符
          </button>
          {/* タイ */}
          <button
            type="button"
            onClick={() => onChange(tieActive ? ROW1[2] : TIE_TOOL)}
            title="タイ（隣接する同音符を結ぶ弧線）"

            aria-label="タイ（隣接する同音符を結ぶ弧線）"
            style={btnStyle(tieActive)}
          >
            <svg width="24" height="14" viewBox="0 0 24 14" fill="none">
              <path d="M3 10 Q12 2 21 10" stroke="#111" strokeWidth="2" strokeLinecap="round" fill="none"/>
            </svg>
          </button>
          {/* 臨時記号 */}
          {ACCIDENTAL_TOOLS.map((tool) => {
            const active = selectedAccidental === tool.accidental;
            return (
              <button
                key={tool.accidental}
                type="button"
                onClick={() => onChange(active ? ROW1[2] : tool)}
                title={`${accidentalLabel(tool.accidental)}（選択して音符をクリック）`}

                aria-label={`${accidentalLabel(tool.accidental)}（選択して音符をクリック）`}
                style={btnStyle(active, { fontSize: 18, fontFamily: '"Times New Roman", serif' })}
              >
                {accidentalSymbol(tool.accidental)}
              </button>
            );
          })}
        </div>

        {/* 休符行：7音価 + リピート2 + 括弧2 */}
        <div style={ROW_STYLE}>
          {ROW2.map((t, i) => {
            const active = !tieActive && 'duration' in value && 'duration' in t &&
              value.duration === t.duration && !!value.isRest;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChange(t)}
                title={`休符 ${label((t as {duration: DurKey}).duration)}`}

                aria-label={`休符 ${label((t as {duration: DurKey}).duration)}`}
                style={btnStyle(active)}
              >
                <NoteIcon duration={(t as {duration: DurKey}).duration} isRest={true} />
              </button>
            );
          })}
          {/* リピート記号 */}
          {REPEAT_TOOLS.map((tool) => {
            const active = selectedRepeat === tool.repeat;
            return (
              <button
                key={tool.repeat}
                type="button"
                onClick={() => onChange(active ? ROW1[2] : tool)}
                title={`${repeatLabel(tool.repeat)}（対象の小節をクリック）`}

                aria-label={`${repeatLabel(tool.repeat)}（対象の小節をクリック）`}
                style={btnStyle(active, { fontSize: 13, fontFamily: '"Times New Roman", serif' })}
              >
                {repeatSymbol(tool.repeat)}
              </button>
            );
          })}
          {/* 番号括弧 */}
          {ENDING_TOOLS.map((tool) => {
            const active = selectedEnding === tool.ending;
            return (
              <button
                key={tool.ending}
                type="button"
                onClick={() => onChange(active ? ROW1[2] : tool)}
                title={`${endingLabel(tool.ending)}（対象の小節をクリック）`}

                aria-label={`${endingLabel(tool.ending)}（対象の小節をクリック）`}
                style={btnStyle(active, { fontSize: 13, fontFamily: '"Times New Roman", serif' })}
              >
                {endingSymbol(tool.ending)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // section === 'symbols'
  return (
    <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* 強弱・速度・拍子行 */}
      <div style={ROW_STYLE}>
        {/* テンポ変更 */}
        <button
          type="button"
          onClick={() => onChange(measureTempoActive ? ROW1[2] : { mode: 'measureTempo' })}
          title="途中テンポ変更（小節をクリックしてBPMを設定）"

          aria-label="途中テンポ変更（小節をクリックしてBPMを設定）"
          style={btnStyle(measureTempoActive, { width: 44 })}
        >
          <svg width="38" height="18" viewBox="0 0 38 18" aria-hidden="true">
            <text x="1" y="13" fontSize="11" fontFamily='"Times New Roman", serif' fontWeight="bold" fill="#111">♩=</text>
            <text x="20" y="13" fontSize="10" fontFamily="sans-serif" fontWeight="bold" fill="#e05">?</text>
          </svg>
        </button>
        {/* 拍子変更 */}
        <button
          type="button"
          onClick={() => onChange(measureTimeSigActive ? ROW1[2] : { mode: 'measureTimeSig' })}
          title="途中拍子変更（小節をクリックして拍子を選択）"

          aria-label="途中拍子変更（小節をクリックして拍子を選択）"
          style={btnStyle(measureTimeSigActive, { width: 38 })}
        >
          <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
            <text x="1" y="9" fontSize="9" fontFamily='"Times New Roman", serif' fontWeight="bold" fill="#111">3</text>
            <line x1="1" y1="10" x2="10" y2="10" stroke="#111" strokeWidth="1.2"/>
            <text x="1" y="17" fontSize="9" fontFamily='"Times New Roman", serif' fontWeight="bold" fill="#111">8</text>
            <text x="12" y="14" fontSize="10" fill="#e05">?</text>
          </svg>
        </button>
        {/* 調号変更 */}
        <button
          type="button"
          onClick={() => onChange(measureKeySigActive ? ROW1[2] : { mode: 'measureKeySig' })}
          title="途中調号変更（小節をクリックして調号を選択）"

          aria-label="途中調号変更（小節をクリックして調号を選択）"
          style={btnStyle(measureKeySigActive, { width: 30 })}
        >
          <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
            <text x="0" y="14" fontSize="14" fontFamily="serif" fontWeight="bold" fill="#111">♯</text>
            <text x="11" y="14" fontSize="14" fontFamily="serif" fontWeight="bold" fill="#111">♭</text>
          </svg>
        </button>
        {/* 音部記号変更（途中クレフ変更） */}
        <button
          type="button"
          onClick={() => onChange(measureClefActive ? ROW1[2] : { mode: 'measureClef' })}
          title="途中音部記号変更（小節をクリックしてクレフを選択）"

          aria-label="途中音部記号変更（小節をクリックしてクレフを選択）"
          style={btnStyle(measureClefActive, { width: 30 })}
        >
          <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
            <text x="0" y="15" fontSize="15" fontFamily="serif" fontWeight="bold" fill="#111">𝄞</text>
          </svg>
        </button>
        {/* 強弱記号 */}
        {DYNAMIC_TOOLS.map((tool) => {
          const active = selectedDynamic === tool.dynamic;
          return (
            <button
              key={tool.dynamic}
              type="button"
              onClick={() => onChange(active ? ROW1[2] : tool)}
              title={`${dynamicLabel(tool.dynamic)}（対象の音符をクリック）`}

              aria-label={`${dynamicLabel(tool.dynamic)}（対象の音符をクリック）`}
              style={btnStyle(active, {
                minWidth: BUTTON_W,
                fontSize: tool.dynamic === 'cresc' || tool.dynamic === 'dim' ? 10 : 15,
                fontFamily: '"Times New Roman", serif',
                fontStyle: 'italic',
                padding: '0 4px',
              })}
            >
              {dynamicSymbol(tool.dynamic)}
            </button>
          );
        })}
        {/* 松葉（クレッシェンド／ディミヌエンド）: タイと同じくドラッグで開始音符→終了音符を結ぶ */}
        <button
          type="button"
          onClick={() => onChange(selectedHairpinType === 'cresc' ? ROW1[2] : { mode: 'hairpin', hairpinType: 'cresc' })}
          title="クレッシェンドの松葉＜（開始音符から終了音符へドラッグ）"
          aria-label="クレッシェンドの松葉＜（開始音符から終了音符へドラッグ）"
          style={btnStyle(selectedHairpinType === 'cresc')}
        >
          <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
            <path d="M2 7 L20 1 M2 7 L20 13" stroke="#111" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onChange(selectedHairpinType === 'dim' ? ROW1[2] : { mode: 'hairpin', hairpinType: 'dim' })}
          title="ディミヌエンドの松葉＞（開始音符から終了音符へドラッグ）"
          aria-label="ディミヌエンドの松葉＞（開始音符から終了音符へドラッグ）"
          style={btnStyle(selectedHairpinType === 'dim')}
        >
          <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
            <path d="M20 7 L2 1 M20 7 L2 13" stroke="#111" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>

      {/* アーティキュレーション・装飾・テキスト行 */}
      <div style={ROW_STYLE}>
        {ARTICULATION_TOOLS.map((tool) => {
          const active = selectedArticulation === tool.articulation;
          return (
            <button
              key={tool.articulation}
              type="button"
              onClick={() => onChange(active ? ROW1[2] : tool)}
              title={`${articulationLabel(tool.articulation)}（対象の音符をクリック）`}

              aria-label={`${articulationLabel(tool.articulation)}（対象の音符をクリック）`}
              style={btnStyle(active)}
            >
              <ArticulationIcon type={tool.articulation} />
            </button>
          );
        })}
        {/* 前打音 */}
        <button
          type="button"
          onClick={() => onChange(graceNoteActive ? ROW1[2] : { mode: 'graceNote' })}
          title="前打音（対象の音符をクリック。同じ音符を再クリックで解除）"

          aria-label="前打音（対象の音符をクリック。同じ音符を再クリックで解除）"
          style={accentBtnStyle(graceNoteActive)}
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>𝆒♩</span>
        </button>
        {/* トリル */}
        <button
          type="button"
          onClick={() => onChange(selectedOrnamentType === 'trill' ? ROW1[2] : { mode: 'ornament', ornamentType: 'trill' })}
          title="トリル（対象の音符をクリック。再クリックで解除）"

          aria-label="トリル（対象の音符をクリック。再クリックで解除）"
          style={accentBtnStyle(selectedOrnamentType === 'trill')}
        >
          <span style={{ fontSize: 13, lineHeight: 1, fontStyle: 'italic', fontWeight: 'bold' }}>tr</span>
        </button>
        {/* モルデント（下隣接音と1往復。波線＋縦線の記号） */}
        <button
          type="button"
          onClick={() => onChange(selectedOrnamentType === 'mordent' ? ROW1[2] : { mode: 'ornament', ornamentType: 'mordent' })}
          title={`${ornamentLabel('mordent')}（対象の音符をクリック。再クリックで解除）`}

          aria-label={`${ornamentLabel('mordent')}（対象の音符をクリック。再クリックで解除）`}
          style={accentBtnStyle(selectedOrnamentType === 'mordent')}
        >
          <span style={{ fontSize: 10, lineHeight: 1, fontWeight: 'bold' }}>mor</span>
        </button>
        {/* プラルトリラー（上隣接音と1往復。波線のみの記号） */}
        <button
          type="button"
          onClick={() => onChange(selectedOrnamentType === 'mordentInverted' ? ROW1[2] : { mode: 'ornament', ornamentType: 'mordentInverted' })}
          title={`${ornamentLabel('mordentInverted')}（対象の音符をクリック。再クリックで解除）`}

          aria-label={`${ornamentLabel('mordentInverted')}（対象の音符をクリック。再クリックで解除）`}
          style={accentBtnStyle(selectedOrnamentType === 'mordentInverted')}
        >
          <span style={{ fontSize: 9, lineHeight: 1, fontWeight: 'bold' }}>prall</span>
        </button>
        {/* ターン */}
        <button
          type="button"
          onClick={() => onChange(selectedOrnamentType === 'turn' ? ROW1[2] : { mode: 'ornament', ornamentType: 'turn' })}
          title={`${ornamentLabel('turn')}（対象の音符をクリック。再クリックで解除）`}

          aria-label={`${ornamentLabel('turn')}（対象の音符をクリック。再クリックで解除）`}
          style={accentBtnStyle(selectedOrnamentType === 'turn')}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>S</span>
        </button>
        {/* テキスト要素 */}
        {TEXT_ELEMENT_TOOLS.map((tool) => {
          const active = selectedTextKind === tool.textKind;
          return (
            <button
              key={tool.textKind}
              type="button"
              onClick={() => onChange(active ? ROW1[2] : tool)}
              title={`${textElementLabel(tool.textKind)}（対象の音符をクリックして入力）`}

              aria-label={`${textElementLabel(tool.textKind)}（対象の音符をクリックして入力）`}
              style={btnStyle(active, {
                fontSize: 10,
                fontFamily: tool.textKind === 'chordSymbol' ? '"Times New Roman", serif' : 'sans-serif',
                fontStyle: tool.textKind === 'expressionMarking' ? 'italic' : 'normal',
              })}
            >
              <TextElementIcon kind={tool.textKind} />
            </button>
          );
        })}
        {/* ペダル */}
        <button
          type="button"
          onClick={() => onChange(pedalDownActive ? ROW1[2] : { mode: 'pedal', pedalType: 'down' })}
          title="ペダル記号（Ped）を付ける。対象の音符をクリック。再クリックで解除"

          aria-label="ペダル記号（Ped）を付ける。対象の音符をクリック。再クリックで解除"
          style={accentBtnStyle(pedalDownActive)}
        >
          <span style={{ fontSize: 11, lineHeight: 1, fontStyle: 'italic', fontFamily: 'serif' }}>Ped</span>
        </button>
        <button
          type="button"
          onClick={() => onChange(pedalUpActive ? ROW1[2] : { mode: 'pedal', pedalType: 'up' })}
          title="ペダル解除記号（✱）を付ける。対象の音符をクリック。再クリックで解除"

          aria-label="ペダル解除記号（✱）を付ける。対象の音符をクリック。再クリックで解除"
          style={accentBtnStyle(pedalUpActive)}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>✱</span>
        </button>
        {/* オッターバ */}
        {(['8va', '8vb', '8vaEnd', '8vbEnd'] as const).map((ot) => {
          const active = ot === '8va' ? ottava8vaActive : ot === '8vb' ? ottava8vbActive : ot === '8vaEnd' ? ottava8vaEndActive : ottava8vbEndActive;
          const lbl = ot.replace('End', '終');
          return (
            <button
              key={ot}
              type="button"
              onClick={() => onChange(active ? ROW1[2] : { mode: 'ottava', ottavaType: ot })}
              title={`${lbl}記号を付ける。対象の音符をクリック。再クリックで解除`}

              aria-label={`${lbl}記号を付ける。対象の音符をクリック。再クリックで解除`}
              style={accentBtnStyle(active)}
            >
              <span style={{ fontSize: 10, lineHeight: 1, fontStyle: 'italic', fontFamily: 'serif' }}>{lbl}</span>
            </button>
          );
        })}
        {/* カスタム記号 */}
        {customSymbolDefs.map((def) => {
          const active = selectedCustomSymbolId === def.id;
          const resizeActive = selectedCustomSymbolResizeId === def.id;
          const offsetActive = selectedCustomSymbolOffsetId === def.id;
          const svgStr = symbolDefToPreviewSvg(def, 22);
          return (
            <div key={def.id} style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <button
                type="button"
                onClick={() => onChange(active ? ROW1[2] : { mode: 'customSymbol', symbolId: def.id })}
                title={`${def.name}（対象の音符をクリック）`}

                aria-label={`${def.name}（対象の音符をクリック）`}
                style={btnStyle(active)}
                dangerouslySetInnerHTML={{ __html: svgStr }}
              />
              {/* サイズ変更ボタン：クリック後に対象の音符をクリックすると、その配置だけの大きさを変えられる */}
              <button
                type="button"
                onClick={() => onChange(resizeActive ? ROW1[2] : { mode: 'customSymbolResize', symbolId: def.id })}
                title={`${def.name}のサイズを変更（対象の音符をクリック）`}
                aria-label={`${def.name}のサイズを変更（対象の音符をクリック）`}
                style={btnStyle(resizeActive, { width: 20, fontSize: 11, color: '#6b7280' })}
              >
                ⤢
              </button>
              {/* 位置調整ボタン：クリック後に対象の音符をクリックすると、その配置だけの縦横位置を微調整できる */}
              <button
                type="button"
                onClick={() => onChange(offsetActive ? ROW1[2] : { mode: 'customSymbolOffset', symbolId: def.id })}
                title={`${def.name}の位置を調整（対象の音符をクリック）`}
                aria-label={`${def.name}の位置を調整（対象の音符をクリック）`}
                style={btnStyle(offsetActive, { width: 20, fontSize: 11, color: '#6b7280' })}
              >
                ✥
              </button>
            </div>
          );
        })}
        {/* 汎用サイズ・位置調整: 運指・強弱記号など「標準記号」にも使える⤢/✥。
            カスタム記号専用の上のボタンと違い、対象の記号を音符クリック時に選ぶ（1種類だけならそのまま開く）。 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <button
            type="button"
            onClick={() => onChange(symbolAdjustResizeActive ? ROW1[2] : { mode: 'symbolAdjustResize' })}
            title="記号のサイズを変更（運指・強弱・カスタム記号など。対象の音符をクリック）"
            aria-label="記号のサイズを変更（運指・強弱・カスタム記号など。対象の音符をクリック）"
            style={btnStyle(symbolAdjustResizeActive, { width: 22, fontSize: 12, color: '#374151' })}
          >
            ⤢
          </button>
          <button
            type="button"
            onClick={() => onChange(symbolAdjustOffsetActive ? ROW1[2] : { mode: 'symbolAdjustOffset' })}
            title="記号の位置を調整（運指・強弱・カスタム記号など。対象の音符をクリック）"
            aria-label="記号の位置を調整（運指・強弱・カスタム記号など。対象の音符をクリック）"
            style={btnStyle(symbolAdjustOffsetActive, { width: 22, fontSize: 12, color: '#374151' })}
          >
            ✥
          </button>
        </div>
        {/* カスタム記号を新規作成 */}
        <button
          type="button"
          onClick={onOpenSymbolEditor}
          title="カスタム記号を新規作成"

          aria-label="カスタム記号を新規作成"
          style={{
            ...btnStyle(false),
            border: '1px dashed #9ca3af',
            color: '#6b7280',
            fontSize: 18,
          }}
        >
          ＋
        </button>
      </div>
    </div>
  );
}

// ツールチップ用の日本語ラベル
function label(d: DurKey) {
  return d==='1'?'全':d==='2'?'2分':d==='4'?'4分':d==='8'?'8分':d==='16'?'16分':d==='32'?'32分':'64分';
}

function accidentalSymbol(kind: AccidentalToolKind) {
  return kind === 'sharp' ? '♯' : kind === 'flat' ? '♭' : '♮';
}

function accidentalLabel(kind: AccidentalToolKind) {
  return kind === 'sharp' ? 'シャープ' : kind === 'flat' ? 'フラット' : 'ナチュラル';
}

function repeatSymbol(kind: RepeatMarkerKind) {
  return kind === 'start' ? '||:' : ':||';
}

function repeatLabel(kind: RepeatMarkerKind) {
  return kind === 'start' ? '開始リピート' : '終了リピート';
}

function endingSymbol(ending: EndingNumber) {
  return `${ending}.`;
}

function endingLabel(ending: EndingNumber) {
  return `${ending}番括弧`;
}

function dynamicSymbol(kind: DynamicMarkingValue) {
  return kind === 'cresc' ? 'cresc.' : kind === 'dim' ? 'dim.' : kind;
}

function dynamicLabel(kind: DynamicMarkingValue) {
  if (kind === 'cresc') return 'クレッシェンド';
  if (kind === 'dim') return 'ディミヌエンド';
  return `強弱記号 ${kind}`;
}

/**
 * 各ボタン内の"小さなSVG"に音符/休符を1つ描く（五線は描かない）。
 */
function NoteIcon({ duration, isRest }: { duration: DurKey; isRest?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '';

    try {
      const renderer = new Renderer(host, Renderer.Backends.SVG);
      renderer.resize(CANVAS_W, CANVAS_H);
      const ctx = renderer.getContext();

      const stave = new Stave(0, 0, CANVAS_W);
      (stave as any).setContext?.(ctx);

      const vfCore = normalizeToVF(duration);
      const vfDur: SymKey = (vfCore + (isRest ? 'r' : '')) as SymKey;
      const note = new StaveNote({
        clef: 'treble',
        keys: ['b/4'],
        duration: vfDur,
      });
      (note as any).setCenterAlignment?.(true);
      (note as any).setStave?.(stave);

      const voice = new Voice({ time: { num_beats: 1, beat_value: 1 } } as any);
      voice.setMode((Voice as any).Mode.SOFT ?? 1);
      voice.addTickables([note]);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);

      const svg = (ctx as any).svg as SVGSVGElement | undefined;
      if (!svg) return;
      svg.style.display = 'block';
      svg.querySelectorAll('path,line,ellipse,polygon,rect').forEach(el => {
        (el as SVGElement).setAttribute('stroke', COLOR);
        (el as SVGElement).setAttribute('fill', COLOR);
      });

      const scope = (svg.querySelector('g.vf-stavenote') as SVGGElement | null) ?? svg;
      let shapes = Array.from(scope.querySelectorAll('path,line,ellipse,polygon,rect')) as SVGGraphicsElement[];
      if (shapes.length === 0) {
        const all = Array.from(svg.querySelectorAll('path,line,ellipse,polygon,rect')) as SVGGraphicsElement[];
        if (all.length > 0) shapes = all;
      }

      let baseW = 0, baseH = 0, minX = 0, minY = 0;
      if (shapes.length > 0) {
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const s of shapes) {
          const b = s.getBBox();
          if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.width) || !isFinite(b.height)) continue;
          minx = Math.min(minx, b.x);
          miny = Math.min(miny, b.y);
          maxx = Math.max(maxx, b.x + b.width);
          maxy = Math.max(maxy, b.y + b.height);
        }
        if (minx < Infinity) {
          minX = minx; minY = miny; baseW = maxx - minx; baseH = maxy - miny;
        }
      }
      if (baseW === 0 || baseH === 0) {
        const b = (scope as SVGGraphicsElement).getBBox?.();
        if (b && isFinite(b.width) && isFinite(b.height)) {
          minX = b.x; minY = b.y; baseW = b.width; baseH = b.height;
        }
      }

      const fill = (FILL_TWEAKS[vfDur] ?? BASE_FILL);

      if (baseW > 0 && baseH > 0) {
        const expand = 1 / Math.max(fill, 0.01);
        const padX = Math.max((baseW * (expand - 1)) / 2, MIN_PAD);
        const padY = Math.max((baseH * (expand - 1)) / 2, MIN_PAD);

        const vbX = minX - padX;
        const vbY = minY - padY;
        const vbW = baseW + padX * 2;
        const vbH = baseH + padY * 2;

        svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('width', String(CANVAS_W));
        svg.setAttribute('height', String(CANVAS_H));
      }
    } catch {
      const fb = unicodeFallback(duration, !!isRest);
      host.textContent = fb;
      host.style.fontSize = '14px';
      host.style.lineHeight = '1';
      host.style.color = COLOR;
    }
  }, [duration, isRest]);

  return <div ref={ref} style={{ width: CANVAS_W, height: CANVAS_H }} aria-hidden="true" />;
}

/** パレットボタン内のアーティキュレーション記号アイコン（SVG） */
function ArticulationIcon({ type }: { type: ArticulationType }) {
  const W = 24, H = 22;
  switch (type) {
    case 'staccato':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <circle cx={W / 2} cy={H / 2} r="3.5" fill="#111" />
        </svg>
      );
    case 'accent':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <path
            d={`M ${W / 2 - 8} ${H / 2 - 5} L ${W / 2} ${H / 2 + 5} L ${W / 2 + 8} ${H / 2 - 5}`}
            stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
          />
        </svg>
      );
    case 'tenuto':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <line
            x1={W / 2 - 8} y1={H / 2} x2={W / 2 + 8} y2={H / 2}
            stroke="#111" strokeWidth="2.5" strokeLinecap="round"
          />
        </svg>
      );
    case 'fermata':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <path
            d={`M ${W / 2 - 8} ${H / 2 + 2} A 8 7 0 0 1 ${W / 2 + 8} ${H / 2 + 2}`}
            stroke="#111" strokeWidth="1.8" strokeLinecap="round" fill="none"
          />
          <circle cx={W / 2} cy={H / 2 + 4} r="2" fill="#111" />
        </svg>
      );
  }
}

/** テキスト要素ボタンのアイコン */
function TextElementIcon({ kind }: { kind: TextElementKind }) {
  const W = 24, H = 18;
  switch (kind) {
    case 'lyrics':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <text x="2" y="12" fontSize="10" fontFamily="serif" fill="#111">♩</text>
          <line x1="13" y1="7" x2="22" y2="7" stroke="#111" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="13" y1="11" x2="22" y2="11" stroke="#111" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'chordSymbol':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <text x="2" y="13" fontSize="12" fontFamily='"Times New Roman", serif' fontWeight="bold" fill="#111">Am</text>
        </svg>
      );
    case 'tempoMarking':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <text x="1" y="12" fontSize="10" fontFamily="serif" fill="#111" fontWeight="bold">♩=</text>
          <text x="15" y="12" fontSize="9" fontFamily="sans-serif" fill="#111" fontWeight="bold">12</text>
        </svg>
      );
    case 'expressionMarking':
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <text x="1" y="13" fontSize="9" fontFamily='"Times New Roman", serif' fontStyle="italic" fill="#111">espr.</text>
        </svg>
      );
    case 'fingering':
      // 運指番号: 丸で囲んだ「3」で「指番号」を直感的に表す
      return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <circle cx="12" cy="9" r="7" fill="none" stroke="#111" strokeWidth="1" />
          <text x="12" y="12.5" fontSize="9" fontFamily="sans-serif" textAnchor="middle" fill="#111">3</text>
        </svg>
      );
  }
}

function unicodeFallback(d: DurKey, rest: boolean) {
  if (rest) {
    return d==='1' ? '𝄻' : d==='2' ? '𝄺' : d==='4' ? '𝄽'
         : d==='8' ? '𝄼' : d==='16'? '𝄾' : d==='32'? '𝄿' : '𝅀';
  } else {
    return d==='1' ? '𝅝' : d==='2' ? '𝅗𝅥' : d==='4' ? '♩'
         : d==='8' ? '♪' : d==='16'? '𝅘𝅥𝅯' : d==='32'? '𝅘𝅥𝅰' : '𝅘𝅥𝅱';
  }
}
