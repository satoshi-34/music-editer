import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';

/* ─────────────────────────────────────────────────────────────
  安定版：クリック不可を修正
  - ループ変数(globalIndex/x)をイベントで参照しない。各小節ごとに const で捕捉。
  - VexFlowオブジェクトは state に入れず、描画ごとに新規生成。
  - 16分・32分が多い小節ほど幅を広げ、4→3→2→1小節の順に自動改行。
────────────────────────────────────────────────────────────── */

type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; key: string };
type MeasureData = { events: NoteEvent[] };

type Props = {
  systems?: number;
  gap?: number;
  measuresPerSystem?: number;
  tool: Tool;
  scale: number;
};

/* 見た目パラメータ */
const TARGET_FILL = 0.92;
const MIN_MEASURE_W = 46;
const NOTE_UNIT_W = 8;
const FLAG_EXTRA_W = 4;
const CLEF_PAD_FIRST = 44;
const CLEF_PAD_OTHER = 28;
const EMPTY_MEASURE_WEIGHT = 10;
const BEATS_PER_MEASURE = 4;

/* 安全な音価変換 */
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
  return vf==='64'?1/16 : vf==='32'?1/8 : vf==='16'?1/4 :
         vf==='8' ?1/2  : vf==='q' ?1    : vf==='h' ?2   : 4;
}
function vfToDenom(vf: VFDur | string) {
  return vf==='64'?64 : vf==='32'?32 : vf==='16'?16 :
         vf==='8' ?8  : vf==='q' ?4  : vf==='h' ?2  : 1;
}

export default function StaffCanvas({
  systems = 6, gap = 110, measuresPerSystem = 4, tool, scale = 1,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // state には軽量データのみ
  const [score, setScore] = useState<MeasureData[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] }))
  );

  useEffect(() => {
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] })));
  }, [systems, measuresPerSystem]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    /* ===== レンダラ ===== */
    const W = ref.current.parentElement?.clientWidth ?? ref.current.clientWidth ?? 700;
    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();
    const svg = ref.current.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    /* ===== レイアウト ===== */
    const left = 16, right = 16;
    const innerW = W - left - right;

    let globalIndex = 0;

    for (let s = 0; s < systems; s++) {
      if (globalIndex >= score.length) break;

      const y = top + s * gap;
      const CLEF_PAD_THIS = (s === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      const candidates = [measuresPerSystem, 3, 2, 1].filter((v, i, a) => a.indexOf(v) === i);

      let chosenCount = 1;
      let widths: number[] = [];
      let startX = left;

      const minContentWidth = (m: MeasureData | undefined) => {
        if (!m || !m.events || m.events.length === 0) return MIN_MEASURE_W;
        const flags = m.events.filter(ev => vfToDenom(toVFDur(ev.dur)) >= 16).length;
        const n = m.events.length;
        return Math.max(MIN_MEASURE_W, n * NOTE_UNIT_W + flags * FLAG_EXTRA_W + 18);
      };

      const tryFit = (n: number) => {
        const last = Math.min(globalIndex + n, score.length);
        const items = score.slice(globalIndex, last);

        const weights = items.map(m => {
          if (!m.events.length) return EMPTY_MEASURE_WEIGHT;
          return m.events.reduce((sum, ev) => sum + vfToDenom(toVFDur(ev.dur)), 0);
        });
        while (weights.length < n) weights.push(EMPTY_MEASURE_WEIGHT);

        let occupy = innerW * TARGET_FILL;
        if (n === 1) occupy = innerW;

        const allocContentW = Math.max(0, occupy - CLEF_PAD_THIS);

        const minWs = items.map(minContentWidth);
        while (minWs.length < n) minWs.push(MIN_MEASURE_W);

        const sumMin = minWs.reduce((a, b) => a + b, 0);
        if (sumMin > allocContentW * 1.001) return null;

        const extra = allocContentW - sumMin;
        const totalWeight = weights.reduce((a,b)=>a+b,0) || 1;
        const wContent = minWs.map((w, i) => w + extra * (weights[i] / totalWeight));

        const realWs = wContent.map((w, i) => (i === 0 ? w + CLEF_PAD_THIS : w));
        const need = realWs.reduce((a, b) => a + b, 0);
        const start = left + (innerW - occupy) / 2;

        if (need > occupy * 1.001 && n > 1) return null;
        return { widths: realWs, startX: start };
      };

      let fitted: null | { widths: number[]; startX: number } = null;
      for (const n of candidates) {
        fitted = tryFit(n);
        if (fitted) { chosenCount = n; widths = fitted.widths; startX = fitted.startX; break; }
      }
      if (!fitted) { chosenCount = 1; widths = [innerW]; startX = left; }

      /* ===== 実描画 ===== */
      let x = startX;

      for (let i = 0; i < chosenCount && globalIndex < score.length; i++, globalIndex++) {
        const w = widths[i];
        const data: MeasureData | undefined = score[globalIndex];

        const stave = new Stave(x, y, w);
        if (i === 0) {
          stave.addClef('treble');
          if (s === 0) stave.addTimeSignature('4/4');
        }
        stave.setEndBarType(Barline.type.SINGLE);
        stave.setContext(ctx).draw();

        // 描画用に安全化
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

        /* === クリック領域（ここが修正ポイント） ===
           ループ変数をそのまま使わず、“その時点の値”を const で捕捉してから
           リスナーを作るのがコツ。*/
        const measureIndex = globalIndex; // ← この小節のインデックスを固定
        const x0 = x;                     // ← この小節の開始Xを固定
        const w0 = w;                     // ← この小節の幅を固定

        if (svg) {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const rectY = stave.getYForLine(0);
          const rectH = stave.getYForLine(4) - rectY;
          rect.setAttribute('x', String(x0));
          rect.setAttribute('y', String(rectY));
          rect.setAttribute('width', String(w0));
          rect.setAttribute('height', String(rectH));
          rect.setAttribute('fill', 'transparent');
          rect.setAttribute('pointer-events', 'all');
          rect.style.cursor = 'crosshair';

          rect.addEventListener('click', (e) => {
            const svgRect = (svg as SVGSVGElement).getBoundingClientRect();
            const relX = (e as MouseEvent).clientX - svgRect.left - x0; // ← x0 を使う
            const relY = (e as MouseEvent).clientY - svgRect.top;

            const line = Math.round(stave.getLineForY(relY) * 2) / 2;
            const key = lineToKeyTreble(line);

            setScore(prev => {
              const next = prev.map(m => ({ events: [...(m?.events ?? [])] as NoteEvent[] }));

              // measureIndex を安全に参照（なければ作る）
              while (measureIndex >= next.length) next.push({ events: [] });
              const m = next[measureIndex];

              const addBeats = beatsFromVF(toVFDur((tool as any)?.duration));
              const curBeats = m.events.reduce((s, ev) => s + beatsFromVF(toVFDur(ev.dur)), 0);
              if (curBeats + addBeats > BEATS_PER_MEASURE) return prev;

              const clickBeat = Math.max(0, Math.min(BEATS_PER_MEASURE, (relX / w0) * BEATS_PER_MEASURE));

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

/* ───────── ヘルパー ───────── */

function lineToKeyTreble(line: number): string {
  const map: Record<number, string> = {
    0: 'f/5', 0.5: 'e/5', 1: 'd/5', 1.5: 'c/5',
    2: 'b/4', 2.5: 'a/4', 3: 'g/4', 3.5: 'f/4', 4: 'e/4',
  };
  return map[line] ?? 'c/4';
}

function makeVFNote(ev: NoteEvent) {
  const vfDur = toVFDur(ev.dur);
  if (ev.isRest) {
    const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: (vfDur as VFDur) + 'r' });
    (n as any).setCenterAlignment?.(true);
    return n;
  }
  return new StaveNote({ clef: 'treble', keys: [ev.key], duration: vfDur });
}
