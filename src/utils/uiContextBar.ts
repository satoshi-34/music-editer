// src/utils/uiContextBar.ts
// Issue #405（段2）: UI案 A1「文脈バー」の中身を作る純粋関数。
//
// 何のための表示か:
// いまの画面は「どのレイヤーを編集中か」「どのタブを開いているか」「どのツールを持っているか」が
// それぞれ別の場所（レイヤーのチップ・タブの見た目・パレットの選択枠）に散っていて、
// 初めて触る人は自分がどの状態にいるのかを一目では言い表せない。
// テスト会で詰まったとき、原因が **レイヤー / タブ / ツール** のどれだったかを
// 観察者が判別できるよう、3つを1行の言葉にして常に出しておくのがこの案。
//
// なぜ純粋関数に切り出すのか:
// 「どんな状態のときに何と出るか」を、ScorePage 全体を描画せずにテストで固定できるようにするため
// （段1 の resolveUiVariant と同じ考え方）。DOM も React もここでは使わない。

import type { Tool } from '../components/Palette';
import type { ScoreType } from '../types/storage';
import { articulationLabel } from './articulationUtils';
import {
  accidentalSymbol,
  durationLabel,
  dynamicSymbol,
  endingLabel,
  microtoneSymbol,
  pianoLayerLabel,
  repeatLabel,
  toolbarTabLabel,
  type ToolbarTab,
} from './editorContextLabels';
import { ornamentLabel } from './ornamentUtils';
import { textElementLabel } from './textElementUtils';

/** 文脈バーに並べる1区画。`key` は見出し語（「レイヤー」など）を出し分けるための識別子 */
export interface ContextBarSegment {
  key: 'layer' | 'tab' | 'tool';
  /** 見出し語。何の情報かを言葉で示す（詰まった原因を言い表せるようにするため） */
  caption: string;
  /** 中身。「右手・声部1」「演奏記号」「pp」など */
  value: string;
}

export interface ContextBarInput {
  scoreType: ScoreType;
  /** ピアノ譜の編集レイヤー（手）。0=右手・1=左手 */
  activeLayerPart: number;
  /** 編集中の声部。0=声部1・1=声部2 */
  activeVoice: number;
  activeToolbarTab: ToolbarTab;
  tool: Tool;
  /** カスタム記号の id → 名前。文脈バーに記号名を出すために使う（無ければ「カスタム記号」とだけ出す） */
  customSymbolNames?: Record<string, string>;
}

/**
 * 文脈バーに出す区画の一覧を作る。
 *
 * レイヤーの区画はピアノ譜のときだけ入れる。単旋律・弦楽四重奏・アンサンブルには
 * 「手 × 声部」のレイヤー選択が無く、無理に出すと**存在しない概念を教えてしまう**ため
 * （空欄や「なし」を出すより、区画ごと出さないほうが誤解が少ない）。
 */
export function buildContextBarSegments(input: ContextBarInput): ContextBarSegment[] {
  const segments: ContextBarSegment[] = [];
  if (input.scoreType === 'piano') {
    segments.push({
      key: 'layer',
      caption: 'レイヤー',
      value: pianoLayerLabel(input.activeLayerPart, input.activeVoice),
    });
  }
  segments.push({ key: 'tab', caption: 'タブ', value: toolbarTabLabel(input.activeToolbarTab) });
  segments.push({
    key: 'tool',
    caption: 'ツール',
    value: describeTool(input.tool, input.customSymbolNames),
  });
  return segments;
}

/**
 * いま持っているツールを短い言葉にする。
 *
 * パレットのツールチップと同じ言い回しになるよう、ラベルは
 * `editorContextLabels` などの既存の関数を通す（表記がずれると
 * 「バーに出ている言葉」でボタンを探せなくなるため）。
 */
export function describeTool(tool: Tool, customSymbolNames?: Record<string, string>): string {
  // 音符・休符の入力ツールだけは `mode` を持たない形なので、先に切り分ける
  if (!('mode' in tool)) {
    const base = `${durationLabel(tool.duration)}${tool.isRest ? '休符' : '音符'}`;
    const dotted = tool.dots === 1 ? `付点${base}` : base;
    const grouped = tool.tuplet ? `${tool.tuplet.numNotes}連符（${dotted}）` : dotted;
    // 臨時記号（Issue #470 → #548 で統合）は、ONになっていることが一番気づきにくい状態なので
    // 「♯付き」と頭に付けて、置いた音に記号が付く理由がバーだけで分かるようにする。
    // 微分音（¼♯・¼♭）も同じ属性になったので同じ形で出す
    if (tool.accidental) return `${accidentalSymbol(tool.accidental)}付き${grouped}`;
    if (tool.microtone) return `${microtoneSymbol(tool.microtone)}付き${grouped}`;
    return grouped;
  }
  switch (tool.mode) {
    case 'select': return '小節選択';
    case 'tie': return 'タイ';
    case 'repeat': return repeatLabel(tool.repeat);
    case 'ending': return endingLabel(tool.ending);
    case 'dynamic': return dynamicSymbol(tool.dynamic);
    case 'articulation': return articulationLabel(tool.articulation);
    case 'customSymbol': return customSymbolName(tool.symbolId, customSymbolNames);
    case 'customSymbolResize': return `${customSymbolName(tool.symbolId, customSymbolNames)}のサイズ変更`;
    case 'customSymbolOffset': return `${customSymbolName(tool.symbolId, customSymbolNames)}の位置調整`;
    case 'tupletNumberToggle': return '連符数字の表示切替';
    case 'crossStaffToggle': return '段またぎ表示の切替';
    case 'symbolAdjustResize': return '記号のサイズ変更';
    case 'symbolAdjustOffset': return '記号の位置調整';
    case 'textElement': return textElementLabel(tool.textKind);
    case 'measureTempo': return '途中テンポ変更';
    case 'measureTimeSig': return '途中拍子変更';
    case 'measurePickup': return '弱起（アウフタクト）';
    case 'measureKeySig': return '途中調号変更';
    case 'measureClef': return '途中音部記号変更';
    case 'measureRehearsal': return 'リハーサルマーク';
    case 'measureText': return '自由注釈テキスト';
    case 'graceNote': return '前打音';
    case 'ornament': return ornamentLabel(tool.ornamentType);
    case 'pedal': return tool.pedalType === 'down' ? 'ペダル（Ped）' : 'ペダル解除（✱）';
    case 'ottava': return ottavaLabel(tool.ottavaType);
    case 'hairpin': return tool.hairpinType === 'cresc' ? '松葉（クレッシェンド＜）' : '松葉（デクレッシェンド＞）';
    default: {
      // 将来ツールを増やしたときに「バーだけ更新し忘れる」ことがないよう、
      // 網羅していない場合はここで型エラーになるようにしておく（never 検査）
      const exhaustive: never = tool;
      void exhaustive;
      return 'ツール';
    }
  }
}

/** カスタム記号は id しか持っていないので、分かれば名前に、分からなければ総称に落とす */
function customSymbolName(symbolId: string, names?: Record<string, string>): string {
  const name = names?.[symbolId];
  return name ? `カスタム記号「${name}」` : 'カスタム記号';
}

function ottavaLabel(type: '8va' | '8vb' | '8vaEnd' | '8vbEnd'): string {
  switch (type) {
    case '8va': return '8va（オクターブ上）';
    case '8vb': return '8vb（オクターブ下）';
    case '8vaEnd': return '8va の終わり';
    case '8vbEnd': return '8vb の終わり';
  }
}
