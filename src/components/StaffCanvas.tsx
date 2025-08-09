// src/components/StaffCanvas.tsx
import { useEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline } from 'vexflow';
import type { Tool } from './Palette';


type Measure = { tickables: any[] };
type Props = {
  systems?: number; gap?: number; measuresPerSystem?: number;
  tool: Tool;
};

export default function StaffCanvas({
  systems = 1, gap = 110, measuresPerSystem = 4, tool,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const [score, setScore] = useState<Measure[]>(
    Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] }))
  );

  useEffect(() => {
    setScore(Array.from({ length: systems * measuresPerSystem }, () => ({ tickables: [] })));
  }, [systems, measuresPerSystem]);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    const W = 
      ref.current.parentElement?.clientWidth //親の幅を維持
      ?? ref.current.clientWidth
      ?? 700;

    const top = 10, bottom = 30, H = top + systems * gap + bottom;

    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();

    // ← SVG 要素はここで一度だけ取得
    const svg = ref.current.querySelector('svg');
    if (!svg) return;

    const left = 16, right = 16, innerW = W - left - right, CLEF_PAD = 44;

    // measuresPerSystem = 1 のときも破綻しないように
    const base = innerW / measuresPerSystem;
    const firstW = base + CLEF_PAD;
    const otherW =
      measuresPerSystem > 1 ? (innerW - firstW) / (measuresPerSystem - 1) : innerW;

    for (let s = 0; s < systems; s++) {
      const y = top + s * gap;
      let x = left;

      for (let mi = 0; mi < measuresPerSystem; mi++) {
        const idx = s * measuresPerSystem + mi;
        const w = mi === 0 ? firstW : otherW;

        const stave = new Stave(x, y, w);
        if (mi === 0) stave.addClef('treble').addTimeSignature('4/4');
        stave.setEndBarType(Barline.type.SINGLE).setContext(ctx).draw();

        // 表示ノート（空なら全休符を仮表示）
        const notes = score[idx].tickables.length ? score[idx].tickables : [makeRest('w')];
        const v = new Voice({ num_beats: 4, beat_value: 4 } as any).addTickables(notes);
        new Formatter({ align_rests: true }).joinVoices([v]).formatToStave([v], stave);
        v.draw(ctx, stave);

        // クリック矩形：五線の実寸に合わせる
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const rectY = stave.getYForLine(0);                 // 五線の最上ライン
        const rectH = stave.getYForLine(4) - rectY;         // 五線の高さ（5ライン分）
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(rectY));
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', String(rectH));
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('pointer-events', 'all');
        rect.style.cursor = 'crosshair';

         rect.addEventListener('click', (e) => {
          const svgRect = (svg as SVGSVGElement).getBoundingClientRect();
          const clickY = e.clientY - svgRect.top;          // SVG座標のY
          const lineRaw = stave.getLineForY(clickY);       // 0=最上ライン, 0.5=次のスペース...
          const line = Math.round(lineRaw * 2) / 2;        // 0.5刻みに丸め
          const key = lineToKeyTreble(line);               // 'c/4' など

          setScore(old => {
            const next = old.map(m => ({ tickables: [...m.tickables] }));
            next[idx].tickables = [makeFromTool(tool, key)];
            return next;
          });
        });

        svg.appendChild(rect);
        x += w;
      }
    }
  }, [systems, gap, measuresPerSystem, score, tool]);

  return <div ref={ref} />;
}

// ---- helpers
function makeFromTool(tool: Tool, keyOverride?: string) {
  if (tool.isRest) return makeRest(tool.duration);
  return new StaveNote({
    clef: 'treble', 
    keys: [keyOverride ?? 'e/4'],        // クリックYから渡ってきた音高を使う
    duration: durToVF(tool.duration),
  });
}
function makeRest(dur: Tool['duration']) {
  const n = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: durToVF(dur) + 'r' });
  (n as any).setCenterAlignment?.(true);
  return n;
}
function durToVF(d: 'q' | 'h' | 'w') { return d === 'q' ? 'q' : d === 'h' ? 'h' : 'w'; }
function lineToKeyTreble(line: number): string {
  const map = [
    'a/6','g/6','f/6','e/6','d/6','c/6','b/5','a/5','g/5',
    'f/5','e/5','d/5','c/5','b/4','a/4','g/4','f/4','e/4',
    'd/4','c/4','b/3','a/3','g/3','f/3','e/3','d/3','c/3','b/2','a/2'
  ];
  const zeroIndex = map.indexOf('f/5'); // line=0 を 'f/5' に対応
  const idx = zeroIndex + Math.round(line * 2);
  const i = Math.max(0, Math.min(map.length - 1, idx));
  return map[i];
}

