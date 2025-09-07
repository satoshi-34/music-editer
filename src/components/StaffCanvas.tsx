import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline, Beam } from 'vexflow';
import type { Tool } from './Palette';

/* ─────────────────────────────────────────────────────────────
  自動レイアウト（余白さらに縮小 & 譜面を少し縮小）
  - VexFlowオブジェクトは state に保持しない（毎回新規生成）
  - 細かい音が多い小節ほど幅を広げ、4→3→2→1小節の順に自動改行
  - 左右の余白をさらに小さくし、scaleで五線・音符を少し縮小
  - クリック座標は scale を考慮した逆変換で正しく挿入
────────────────────────────────────────────────────────────── */

type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
type NoteEvent = { dur: DurKey; isRest: boolean; key: string };
type MeasureData = { events: NoteEvent[] };

type Props = {
  systems?: number;             // 何段描くか
  gap?: number;                 // 段間(px)
  measuresPerSystem?: number;   // 1段の目標小節数（入らなければ 3→2→1）
  tool: Tool;                   // パレットの選択
  scale?: number;               // 譜表全体の倍率（1.0=等倍、0.86で14%縮小）
};

/* ── 見た目パラメータ（今回“余白縮小”に調整） ── */
const TARGET_FILL = 0.992;      // 行の有効幅の使用率（左右余白を極小に）
const PAGE_LEFT = 4;            // 左余白（px）
const PAGE_RIGHT = 4;           // 右余白（px）
const MIN_MEASURE_W = 50;       // 小節の最低幅（詰まり防止）
const NOTE_UNIT_W = 10;         // 1音あたり最低ほしい幅
const DENSITY_K = 0.6;          // 細かさ密度の寄与
const FLAG_EXTRA_W = 6;         // 16分以上の旗の上乗せ
const CLEF_PAD_FIRST = 44;      // 1段目：ト音＋拍子ぶん
const CLEF_PAD_OTHER = 28;      // 2段目以降：ト音のみ
const EMPTY_MEASURE_WEIGHT = 12;// 空小節の重み
const BEATS_PER_MEASURE = 4;    // 4/4 前提

/* ── 音価変換（安全：未定義は 'q' にフォールバック） ── */
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
  systems = 6,
  gap = 110,
  measuresPerSystem = 4,
  tool,
  scale = 0.86,           // ← “もう少し小さく”の既定値(五線と音符)
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // state には軽量データのみ
  const [score, setScore] = useState<MeasureData[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ events: [] }))
  );

  // 行数/段あたり小節数が変わったら作り直し
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

    // 譜面縮小。描画前にスケールを掛け、座標は 1/scale で渡す。
    const s = Math.max(0.75, Math.min(1.0, scale ?? 1)); // 0.75〜1.0にクランプ
    ctx.scale(s, s);

    /* ===== レイアウト（横余白を詰め気味） ===== */
    const innerW = (W - PAGE_LEFT - PAGE_RIGHT);
    const left = PAGE_LEFT;

    let globalIndex = 0;

    for (let line = 0; line < systems; line++) {
      if (globalIndex >= score.length) break;

      const y = top + line * gap;
      const CLEF_PAD_THIS = (line === 0) ? CLEF_PAD_FIRST : CLEF_PAD_OTHER;

      const candidates = [measuresPerSystem, 3, 2, 1].filter((v, i, a) => a.indexOf(v) === i);

      let chosenCount = 1;
      let widths: number[] = [];
      let startX = left;

      // 小節の“最小必要幅”（行頭パディング抜き = コンテンツ幅）を推定
      const minContentWidth = (m: MeasureData | undefined) => {
        if (!m || !m.events || m.events.length === 0) return MIN_MEASURE_W;
        const n = m.events.length;
        const density = m.events.reduce((sum, ev) => sum + vfToDenom(toVFDur(ev.dur)), 0);
        const flags = m.events.filter(ev => vfToDenom(toVFDur(ev.dur)) >= 16).length;
        const base = n * NOTE_UNIT_W;
        const densPlus = Math.max(0, density - 4 * n) * DENSITY_K; // 4分相当より細かい分だけ上乗せ
        return Math.max(MIN_MEASURE_W, base + densPlus + flags * FLAG_EXTRA_W + 18);
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
        if (n === 1) occupy = innerW; // 1小節は行いっぱいまで使う

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

      /* ===== 実描画（ctx.scale(s,s) 済み → 座標は 1/s で渡す） ===== */
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

        // クリック領域（scale考慮）
        const measureIndex = globalIndex;
        const xDraw = x / s;           // rect用の描画座標
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
            // 画面座標 → 譜面座標（scale を逆変換）
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
