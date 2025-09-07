import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';

/* ─────────────────────────────────────────────────────────────
  MuseScore っぽい小節幅の自動割り付け（全・二分を広め／八分を詰め気味）
────────────────────────────────────────────────────────────── */

type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; key: string };
type MeasureData = { events: NoteEvent[] };

type Props = {
  systems?: number;             // 段数
  gap?: number;                 // 段間(px)
  measuresPerSystem?: number;   // 1段の目標小節数
  tool: Tool;                   // パレット選択
  scale?: number;               // 譜面の拡大率
};

/* ── 見た目パラメータ ── */
const TARGET_FILL = 0.99;       // 行の使用率（左右余白を極小に）
const PAGE_LEFT = 4;            // 左余白
const PAGE_RIGHT = 4;           // 右余白

const MIN_MEASURE_W = 52;       // 通常の最小幅
const LONG_HALF_MIN = 80;       // 二分音符を含む小節の最小幅（少し広め）
const LONG_WHOLE_MIN = 92;      // 全音符を含む小節の最小幅（少し広め）

const BASE_PAD = 14;            // 小節の基礎パディング（小節線や臨時記号の余地）
const UNIT_WIDTH = 9;           // “スペース単位”1.0に対するpx
const FLAG_EXTRA_PX = 4;        // 16分以上の旗ぶん微追加

const CLEF_PAD_FIRST = 50;      // 1段目：ト音＋拍子のパディング
const CLEF_PAD_OTHER = 28;      // 2段目以降：ト音のみ
const EMPTY_MEASURE_UNITS = 0.6;// 何も置かれていない小節の単位
const BEATS_PER_MEASURE = 4;    // 4/4 前提

/* 文字列 → VexFlow duration */
type VFDur = 'w'|'h'|'q'|'8'|'16'|'32'|'64';
function toVFDur(d: DurKey | string | undefined | null): VFDur {
  switch (d) {
    case '1': return 'w';
    case '2': return 'h';
    case '4': return 'q';
    case '8': return '8';
    case '16': return '16';
    case '32': return '32';
    case '64': return '64';
    default:  return 'q';
  }
}
function beatsFromVF(vf: VFDur) {
  // 4/4 基準の拍数
  return vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 :
         vf==='8' ?1/2  : vf==='q' ?1    : vf==='h' ?2   : 4;
}
function vfToDenom(vf: VFDur | string) {
  return vf==='64'?64 : vf==='32'?32 : vf==='16'?16 :
         vf==='8' ?8  : vf==='q' ?4  : vf==='h' ?2  : 1;
}

/* === スペース単位：ここが今回のキモ ===
   - “1.0 = 四分音符1つぶん” を基準に、各音価の見た目の占有感を数値化
   - 全音符・二分音符は 1.45 / 1.25 と“少しだけ”厚めに
   - 八分音符は 1.18 に下げて詰める（以前の 1.4 から縮小）
   - 16分以上は従来通りしっかり広がる（読める間隔を確保）
*/
const UNIT_BY_DENOM: Record<number, number> = {
  1: 1.45,  // 全音符（もう少し広め）
  2: 1.25,  // 二分（少し広め）
  4: 1.00,  // 四分（基準）
  8: 0.60,  // 八分（詰め気味）ok
  16: 0.50, // 十六分
  32: 2.20, // 三十二分
  64: 2.60, // 六十四分
};

function unitsForEvent(ev: NoteEvent): number {
  const denom = vfToDenom(toVFDur(ev.dur));
  const base = UNIT_BY_DENOM[denom] ?? 1.0;
  const restFactor = ev.isRest ? 0.85 : 1.0;      // 休符は少し狭く
  const flagExtra = denom >= 16 ? (FLAG_EXTRA_PX / UNIT_WIDTH) : 0; // 旗の微追加
  return base * restFactor + flagExtra;
}

/* 小節の“最小必要幅（コンテンツ幅）”を見積もる
   - 中身の合計単位 × UNIT_WIDTH + BASE_PAD を基本に
   - 長い音を含むときにだけ下限を少し引き上げる（やりすぎない）
*/
function minContentWidth(m?: MeasureData): number {
  if (!m || !m.events || m.events.length === 0) {
    return Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * EMPTY_MEASURE_UNITS);
  }
  let hasHalf = false, hasWhole = false;
  const units = m.events.reduce((s, ev) => {
    const denom = vfToDenom(toVFDur(ev.dur));
    if (denom === 2) hasHalf = true;
    if (denom === 1) hasWhole = true;
    return s + unitsForEvent(ev);
  }, 0);
  const raw = Math.max(MIN_MEASURE_W, BASE_PAD + UNIT_WIDTH * units);

  // 長い音を含む場合だけ“ちょい広め”の下限を適用
  if (hasWhole) return Math.max(raw, LONG_WHOLE_MIN);
  if (hasHalf)  return Math.max(raw, LONG_HALF_MIN);
  return raw;
}

/* 五線ライン番号(0〜4の0.5刻み) → ト音記号の鍵盤キー */
function lineToKeyTreble(line: number): string {
  const map: Record<number, string> = {
    0: 'f/5', 0.5: 'e/5', 1: 'd/5', 1.5: 'c/5',
    2: 'b/4', 2.5: 'a/4', 3: 'g/4', 3.5: 'f/4', 4: 'e/4',
  };
  return map[line] ?? 'c/4';
}

export default function StaffCanvas({
  systems = 6,
  gap = 110,
  measuresPerSystem = 4,
  tool,
  scale = 0.86, // デフォルト少し縮小
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // VexFlowの重いオブジェクトは持たず、軽い配列だけを状態で管理
  const [score, setScore] = useState<MeasureData[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] }))
  );

  useEffect(() => {
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] })));
  }, [systems, measuresPerSystem]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();

    const svg = ref.current.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    // 見た目だけ縮小。以降の描画座標は 1/scale で渡す必要あり
    const s = Math.max(0.75, Math.min(1.0, scale ?? 1));
    ctx.scale(s, s);

    const innerW = W - PAGE_LEFT - PAGE_RIGHT;
    const left = PAGE_LEFT;

    let globalIndex = 0;

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= score.length) break;

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      // 4小節で試し、無理なら 3→2→1
      const candidates = [measuresPerSystem, 3, 2, 1].filter((v, i, a) => a.indexOf(v) === i);

      let chosenCount = 1;
      let widths: number[] = [];
      let startX = left;

      const tryFit = (n: number) => {
        const last = Math.min(globalIndex + n, score.length);
        const items = score.slice(globalIndex, last);

        let occupy = innerW * TARGET_FILL;
        if (n === 1) occupy = innerW; // 1小節行は行いっぱい使う

        const allocContentW = Math.max(0, occupy - CLEF_PAD_THIS);

        const minWs = items.map(minContentWidth);
        while (minWs.length < n) minWs.push(MIN_MEASURE_W);

        const unitWeights = items.map(m =>
          (m && m.events && m.events.length)
            ? m.events.reduce((u, ev) => u + unitsForEvent(ev), 0)
            : EMPTY_MEASURE_UNITS
        );
        while (unitWeights.length < n) unitWeights.push(EMPTY_MEASURE_UNITS);

        const sumMin = minWs.reduce((a, b) => a + b, 0);
        if (sumMin > allocContentW * 1.002) return null;

        const extra = Math.max(0, allocContentW - sumMin);
        const weightSum = unitWeights.reduce((a, b) => a + b, 0) || 1;
        const contentW = minWs.map((w, i) => w + extra * (unitWeights[i] / weightSum));

        const realWs = contentW.map((w, i) => (i === 0 ? w + CLEF_PAD_THIS : w));
        const need = realWs.reduce((a, b) => a + b, 0);
        const start = left + (innerW - occupy) / 2;

        if (need > occupy * 1.002 && n > 1) return null;
        return { widths: realWs, startX: start };
      };

      let fitted: null | { widths: number[]; startX: number } = null;
      for (const n of candidates) {
        fitted = tryFit(n);
        if (fitted) { chosenCount = n; widths = fitted.widths; startX = fitted.startX; break; }
      }
      if (!fitted) { chosenCount = 1; widths = [innerW]; startX = left; }

      let x = startX;

      for (let i = 0; i < chosenCount && globalIndex < score.length; i++, globalIndex++) {
        const w = widths[i];
        const data: MeasureData | undefined = score[globalIndex];

        const stave = new Stave(x / s, y / s, w / s);
        if (i === 0) {
          stave.addClef('treble');
          if (line === 0) stave.addTimeSignature('4/4');
        }
        stave.setEndBarType(Barline.type.SINGLE);
        stave.setContext(ctx).draw();

        const safeEvents: NoteEvent[] =
          (data && data.events && data.events.length
            ? data.events
            : [{ dur: '1', isRest: true, key: 'b/4' }])
          .map(ev => (!ev || !ev.dur ? { dur: '4', isRest: true, key: 'b/4' } : ev));

        const vfNotes = safeEvents.map(ev => makeVFNote(ev));
        const beams = Beam.generateBeams(vfNotes, { beam_rests: false });

        const voice = new Voice({ time: { num_beats: BEATS_PER_MEASURE, beat_value: 4 } } as any);
        voice.setMode((Voice as any).Mode.SOFT ?? 1);
        voice.addTickables(vfNotes);

        new Formatter({ align_rests: true }).joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach(b => b.setContext(ctx).draw());

        const measureIndex = globalIndex;
        const xDraw = x / s;
        const wDraw = w / s;

        if (svg) {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const rectY = stave.getYForLine(0);
          const rectH = stave.getYForLine(4) - rectY;
          rect.setAttribute('x', String(xDraw));
          rect.setAttribute('y', String(rectY));
          rect.setAttribute('width', String(wDraw));
          rect.setAttribute('height', String(rectH));
          rect.setAttribute('fill', 'transparent');
          rect.setAttribute('pointer-events', 'all');
          rect.style.cursor = 'crosshair';

          rect.addEventListener('click', (e) => {
            const svgRect = (svg as SVGSVGElement).getBoundingClientRect();
            // 画面 → 譜面座標（scale を逆変換）
            const relX = ((e as MouseEvent).clientX - svgRect.left) / s - xDraw;
            const relY = ((e as MouseEvent).clientY - svgRect.top) / s;

            const linePos = Math.round(stave.getLineForY(relY) * 2) / 2;
            const key = lineToKeyTreble(linePos);

            setScore(prev => {
              const next = prev.map(m => ({ events: [...(m?.events ?? [])] as NoteEvent[] }));
              while (measureIndex >= next.length) next.push({ events: [] });
              const m = next[measureIndex];

              const addBeats = beatsFromVF(toVFDur((tool as any)?.duration));
              const curBeats = m.events.reduce((s2, ev) => s2 + beatsFromVF(toVFDur(ev.dur)), 0);
              if (curBeats + addBeats > BEATS_PER_MEASURE) return prev;

              // クリックした場所に近い側へ挿入
              const clickBeat = Math.max(0, Math.min(BEATS_PER_MEASURE, (relX / wDraw) * BEATS_PER_MEASURE));
              let acc = 0, insertAt = m.events.length;
              for (let j = 0; j < m.events.length; j++) {
                const b = beatsFromVF(toVFDur(m.events[j].dur));
                if (clickBeat <= acc + b / 2) { insertAt = j; break; }
                acc += b;
              }

              const ev: NoteEvent = {
                dur: (['1','2','4','8','16','32','64'].includes((tool as any)?.duration) ? (tool as any).duration : '4') as DurKey,
                isRest: !!(tool as any)?.isRest,
                key,
              };
              m.events.splice(insertAt, 0, ev);
              return next;
            });
          });

          svg.appendChild(rect);
        }

        x += w;
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool, scale]);

  return <div ref={ref} />;
}

/* ───────── VexFlowノート生成 ───────── */
function makeVFNote(ev: NoteEvent) {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: (vfDur as VFDur) + 'r' });
    (n as any).setCenterAlignment?.(true); // 休符は中央寄せ
    return n;
  }
  return new StaveNote({ clef: 'treble', keys: [ev.key], duration: vfDur });
}
