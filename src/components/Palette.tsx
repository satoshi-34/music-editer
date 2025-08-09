// src/components/Palette.tsx
import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';

export type DurKey = '1'|'2'|'4'|'8'|'16'|'32'|'64';
export type Tool = { duration: DurKey; isRest?: boolean };

const ROW1: Tool[] = ['1','2','4','8','16','32','64'].map(d => ({ duration: d }));
const ROW2: Tool[] = ROW1.map(t => ({ ...t, isRest: true }));

export default function Palette({
  value, onChange,
}: { value: Tool; onChange: (t: Tool) => void }) {
  const items = [...ROW1, ...ROW2];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,56px)', gap: 8, padding: 8 }}>
      {items.map((t, i) => {
        const active = value.duration === t.duration && !!value.isRest === !!t.isRest;
        return (
          <button
            key={i}
            onClick={() => onChange(t)}
            style={{
              width: 56, height: 44, padding: 0,
              borderRadius: 10,
              border: active ? '2px solid #3b82f6' : '1px solid #ccc',
              background: '#fff', color: '#222',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer'
            }}
            aria-label={(t.isRest ? '休符 ' : '音符 ') + label(t.duration)}
            title={(t.isRest ? '休符 ' : '音符 ') + label(t.duration)}
          >
            <NoteIcon duration={t.duration} isRest={t.isRest} />
          </button>
        );
      })}
    </div>
  );
}

function label(d: DurKey) {
  return d==='1'?'全':d==='2'?'2分':d==='4'?'4分':d==='8'?'8分':d==='16'?'16分':d==='32'?'32分':'64分';
}

/** '1|2|4|8|16|32|64' → VexFlow 'w|h|q|8|16|32|64' */
export function normalizeToVF(d: DurKey): 'w'|'h'|'q'|'8'|'16'|'32'|'64' {
  return d==='1'?'w':d==='2'?'h':d==='4'?'q':d;
}

function NoteIcon({ duration, isRest }: { duration: DurKey; isRest?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
  const el = ref.current; if (!el) return;
  el.innerHTML = '';

  const r = new Renderer(el, Renderer.Backends.SVG);
  r.resize(52, 40);
  const ctx = r.getContext();

  // 1) 先に五線を作って描画
  const stave = new Stave(2, 6, 48);
  stave.setContext(ctx).draw();

  // 2) ノート作成
  const vfDur = normalizeToVF(duration) + (isRest ? 'r' : '');
  const note = new StaveNote({
    clef: 'treble',
    keys: [isRest ? 'b/4' : 'e/4'],
    duration: vfDur,
  });
  (note as any).setCenterAlignment?.(true);

  // ★ ここがポイント：ノートに五線を結びつける
  //   （formatToStave を使う場合でも安全のため明示しておく）
  (note as any).setStave?.(stave);

  // 3) Voice を SOFT モードで
  const v = new Voice({ time: { num_beats: 1, beat_value: 1 } } as any);
  v.setMode((Voice as any).Mode.SOFT ?? 1);
  v.addTickables([note]);

  // ★ format ではなく formatToStave を使う
  new Formatter({ align_rests: true }).joinVoices([v]).formatToStave([v], stave);

  // 4) 描画
  v.draw(ctx, stave);
}, [duration, isRest]);

  return <div ref={ref} />;
}
