// src/components/Palette.tsx
// ─────────────────────────────────────────────────────────────
// 目的：ツールバーのボタンに「五線なし」の音符/休符アイコンを表示する。
// 仕様：VexFlowで1音(または休符)を描画 → 実際の描画要素の合成BBoxから
//       SVGの viewBox を作り、ボタン内の枠に等比フィット。
//       色は #111 で強制して“白抜け”を回避。
// ★新機能：全ての音符/休符の「見た目サイズ」を個別に調整できるようにした。
//        （下の FILL_TWEAKS を編集するだけでOK。キー一覧は型 SymKey を参照）
// 初学者向けにコメントを多めに入れています。
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';
import type { AccidentalToolKind } from '../utils/noteKeyUtils';
import type { RepeatMarkerKind } from '../utils/repeatMarkerUtils';

// ========== 表示サイズ＆色（ボタン側と合わせる） ==========
const BUTTON_W = 56;   // ボタン幅（CSSと合わせる）
const BUTTON_H = 44;   // ボタン高さ（CSSと合わせる）

// ボタンの中に置くアイコン用 SVG の物理解像度
const CANVAS_W = 52;   // 横幅（ボタンより少しだけ小さめ）
const CANVAS_H = 40;   // 高さ（= ボタン高さの約9割）
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
  | { duration: DurKey; isRest?: boolean }  // 通常の音符/休符入力
  | { mode: 'tie' }                         // タイ記号を付けるモード
  | { mode: 'accidental'; accidental: AccidentalToolKind }  // 臨時記号を付けるモード
  | { mode: 'repeat'; repeat: RepeatMarkerKind };           // リピート記号を付けるモード

type AccidentalTool = Extract<Tool, { mode: 'accidental' }>;
type RepeatTool = Extract<Tool, { mode: 'repeat' }>;

// 並べるアイテム（上段=音符, 下段=休符）
const ROW1: Tool[] = ['1','2','4','8','16','32','64'].map(d => ({ duration: d as DurKey }));
const ROW2: Tool[] = ROW1.map(t => ({ ...t, isRest: true }));

// ─────────────────────────────────────────────────────────────
// ★ ここが“サイズ調整ダイヤル”です！
//    ・BASE_FILL … 全体の基準の大きさ（数値が小さいほど“見た目が小さく”なる）
//    ・FILL_TWEAKS … 記号別の上書き（なければ BASE_FILL が使われます）
//    ・キーの命名：音符 = 'w','h','q','8','16','32','64'
//                  休符 = 上記＋'r'（例：四分休符 'qr'、八分休符 '8r'）
//    ・まずは BASE_FILL で全体を決めて、気になる記号だけ Tweaks を足すのがコツ。
// ─────────────────────────────────────────────────────────────
const BASE_FILL = 0.60; // だいたい“ボタン内の7〜8割”くらいの見た目

type SymKey =
  | 'w'|'h'|'q'|'8'|'16'|'32'|'64'
  | 'wr'|'hr'|'qr'|'8r'|'16r'|'32r'|'64r';

const FILL_TWEAKS: Partial<Record<SymKey, number>> = {
  // 背が低くて大きく見えがちなものは小さめに
  w:  0.25,  // 全音符
  wr: 0.20,  // 全休符（黒い四角）
  hr: 0.20,  // 二分休符（黒い四角）
  // 八分休符はやや主張が強いので少し小さく
  '8r': 0.40,
  // 小さく見えがちな細かい音符群は少し大きめ
  '32':  0.75,
  '32r': 0.75,
  '64':  0.85,
  '64r': 0.85,
  // 例：四分音符/休符を微調整したいときは以下を解放
  // 'q': 0.72,
  // 'qr': 0.70,
  // '16r': 0.70,
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

export default function Palette({
  value, onChange,
}: { value: Tool; onChange: (t: Tool) => void }) {

  const items = [...ROW1, ...ROW2]; // 7×2 = 14個

  // タイモードかどうか（判別共用体の型ガード）
  const tieActive = 'mode' in value && value.mode === 'tie';
  const selectedAccidental = 'mode' in value && value.mode === 'accidental'
    ? value.accidental
    : null;
  const selectedRepeat = 'mode' in value && value.mode === 'repeat'
    ? value.repeat
    : null;

  return (
    <div style={{ padding: 8 }}>
      {/* 音符・休符ボタン行 */}
      <div
        className="palette-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7,56px)', // 7列分
          gap: 8,
          marginBottom: 8,
        }}
      >
        {items.map((t, i) => {
          // Tool が音符/休符のときだけ duration を参照する（型ガード）
          const noteActive = !tieActive &&
            'duration' in value && 'duration' in t &&
            value.duration === t.duration && !!value.isRest === !!t.isRest;
          return (
            <button
              type="button"
              key={i}
              onClick={() => onChange(t)}
              aria-label={`${'isRest' in t && t.isRest ? '休符' : '音符'} ${label((t as {duration: DurKey}).duration)}`}
              title={`${'isRest' in t && t.isRest ? '休符' : '音符'} ${label((t as {duration: DurKey}).duration)}`}
              style={{
                width: BUTTON_W,
                height: BUTTON_H,
                padding: 0,
                borderRadius: 10,
                border: noteActive ? '2px solid #3b82f6' : '1px solid #ccc',
                background: '#fff',
                color: '#222',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <NoteIcon duration={(t as {duration: DurKey}).duration} isRest={'isRest' in t ? t.isRest : false} />
            </button>
          );
        })}
      </div>

      {/* タイボタン行 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onChange(tieActive ? ROW1[2] : TIE_TOOL)}
          aria-label="タイ"
          title="タイ（隣接する同音符を結ぶ弧線）"
          style={{
            width: BUTTON_W,
            height: BUTTON_H,
            padding: 0,
            borderRadius: 10,
            border: tieActive ? '2px solid #3b82f6' : '1px solid #ccc',
            background: tieActive ? '#eff6ff' : '#fff',
            color: '#222',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 22,
          }}
        >
          {/* タイの弧を表す SVG アイコン */}
          <svg width="32" height="20" viewBox="0 0 32 20" fill="none">
            <path d="M4 14 Q16 2 28 14" stroke="#111" strokeWidth="2" strokeLinecap="round" fill="none"/>
          </svg>
        </button>

        {ACCIDENTAL_TOOLS.map((tool) => {
          const isActive = selectedAccidental === tool.accidental;
          return (
            <button
              type="button"
              key={tool.accidental}
              onClick={() => onChange(isActive ? ROW1[2] : tool)}
              aria-label={accidentalLabel(tool.accidental)}
              title={`${accidentalLabel(tool.accidental)}（選択して音符をクリック）`}
              style={{
                width: BUTTON_W,
                height: BUTTON_H,
                padding: 0,
                borderRadius: 10,
                border: isActive ? '2px solid #3b82f6' : '1px solid #ccc',
                background: isActive ? '#eff6ff' : '#fff',
                color: '#222',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: 24,
                fontFamily: '"Times New Roman", serif',
                lineHeight: 1,
              }}
            >
              {accidentalSymbol(tool.accidental)}
            </button>
          );
        })}

        {REPEAT_TOOLS.map((tool) => {
          const isActive = selectedRepeat === tool.repeat;
          return (
            <button
              type="button"
              key={tool.repeat}
              onClick={() => onChange(isActive ? ROW1[2] : tool)}
              aria-label={repeatLabel(tool.repeat)}
              title={`${repeatLabel(tool.repeat)}（対象の小節をクリック）`}
              style={{
                width: BUTTON_W,
                height: BUTTON_H,
                padding: 0,
                borderRadius: 10,
                border: isActive ? '2px solid #3b82f6' : '1px solid #ccc',
                background: isActive ? '#eff6ff' : '#fff',
                color: '#222',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: 18,
                fontFamily: '"Times New Roman", serif',
                lineHeight: 1,
              }}
            >
              {repeatSymbol(tool.repeat)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ツールチップ用の日本語ラベル（“音符 4分”などに使う）
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

/**
 * 各ボタン内の“小さなSVG”に音符/休符を1つ描く（五線は描かない）。
 * 1) VexFlowで描画
 * 2) 実ストローク群（path/line/ellipse/polygon/rect）の合成BBoxを計算
 * 3) そのBBoxをベースに viewBox を作り、W×Hに等比フィット
 * 4) ただし FILL（記号別の占有率）に応じて viewBox を“広げて”小さくもできる
 */
function NoteIcon({ duration, isRest }: { duration: DurKey; isRest?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = ''; // 前回の描画をクリア

    try {
      // 1) SVGレンダラー
      const renderer = new Renderer(host, Renderer.Backends.SVG);
      renderer.resize(CANVAS_W, CANVAS_H);
      const ctx = renderer.getContext();

      // 2) レイアウト用 Stave（drawしない＝五線は出さない）
      const stave = new Stave(0, 0, CANVAS_W);
      (stave as any).setContext?.(ctx);

      // 3) 音符/休符の作成（休符は高さ非依存なので 'b/4' でOK）
      const vfCore = normalizeToVF(duration);        // 'w' | 'h' | 'q' | '8' | ...
      const vfDur: SymKey = (vfCore + (isRest ? 'r' : '')) as SymKey; // 例: '8' or '8r'
      const note = new StaveNote({
        clef: 'treble',
        keys: ['b/4'],
        duration: vfDur,
      });
      (note as any).setCenterAlignment?.(true);
      (note as any).setStave?.(stave);

      // 4) 1音の Voice を配置して描画
      const voice = new Voice({ time: { num_beats: 1, beat_value: 1 } } as any);
      voice.setMode((Voice as any).Mode.SOFT ?? 1);
      voice.addTickables([note]);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);

      // 5) SVG取得＆黒で強制（白抜け対策）※ rect も忘れずに！
      const svg = (ctx as any).svg as SVGSVGElement | undefined;
      if (!svg) return;
      svg.style.display = 'block';
      svg.querySelectorAll('path,line,ellipse,polygon,rect').forEach(el => {
        (el as SVGElement).setAttribute('stroke', COLOR);
        (el as SVGElement).setAttribute('fill', COLOR);
      });

      // 6) 実描画要素の合成BBox（rect含む）。無ければグループ全体でフォールバック
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

      // 7) 記号ごとの FILL（なければ BASE_FILL）を決定
      const fill = (FILL_TWEAKS[vfDur] ?? BASE_FILL);

      // 8) viewBox を“fillぶん”広げ、W×Hに等比フィット（=小さく/大きくを統一）
      if (baseW > 0 && baseH > 0) {
        const expand = 1 / Math.max(fill, 0.01);                 // FILLが小さいほど広くなる=表示は小さく
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
      // 失敗しても真っ白にならないよう、Unicodeにフォールバック
      const fb = unicodeFallback(duration, !!isRest);
      host.textContent = fb;
      host.style.fontSize = '18px';
      host.style.lineHeight = '1';
      host.style.color = COLOR;
    }
  }, [duration, isRest]);

  // はみ出し防止にコンテナサイズも固定
  return <div ref={ref} style={{ width: CANVAS_W, height: CANVAS_H }} aria-hidden="true" />;
}

// 失敗時フォールバック（環境で字形は多少変わります）
function unicodeFallback(d: DurKey, rest: boolean) {
  if (rest) {
    return d==='1' ? '𝄻' : d==='2' ? '𝄺' : d==='4' ? '𝄽'
         : d==='8' ? '𝄼' : d==='16'? '𝄾' : d==='32'? '𝄿' : '𝅀';
  } else {
    return d==='1' ? '𝅝' : d==='2' ? '𝅗𝅥' : d==='4' ? '♩'
         : d==='8' ? '♪' : d==='16'? '𝅘𝅥𝅯' : d==='32'? '𝅘𝅥𝅰' : '𝅘𝅥𝅱';
  }
}
