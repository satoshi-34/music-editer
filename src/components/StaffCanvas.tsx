// src/components/StaffCanvas.tsx
import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Barline } from 'vexflow';

type Props = {
  systems?: number;           // 段数
  gap?: number;               // 段間
  measuresPerSystem?: number; // 1段の小節数
};

const StaffCanvas = ({
  systems = 4,
  gap = 110,
  measuresPerSystem = 4,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';

    // キャンバスサイズ
    const W = ref.current.clientWidth || ref.current.parentElement?.clientWidth || 700;
    const top = 10, bottom = 30;
    const H = top + systems * gap + bottom;

    const renderer = new Renderer(ref.current, Renderer.Backends.SVG);
    renderer.resize(W, H);
    const ctx = renderer.getContext();

    // 余白
    const left = 16, right = 16;
    const innerW = W - left - right;

    // 全休符（中央配置）
    const wholeRest = () => new StaveNote({ clef: 'treble', keys: ['b/4'], duration: 'wr' });

    for (let s = 0; s < systems; s++) {
      const y = top + s * gap;
      let x = left;

      // 初期は全部全休符なので均等割でOK
      const measureW = innerW / measuresPerSystem;

      for (let mi = 0; mi < measuresPerSystem; mi++) {
        const stave = new Stave(x, y, measureW);
        if (mi === 0) {
          stave.addClef('treble').addTimeSignature('4/4'); // 段頭だけ記号
        }
        stave.setEndBarType(Barline.type.SINGLE).setContext(ctx).draw();

        // 全休符の voice を配置
        const v = new Voice({ num_beats: 4, beat_value: 4 } as any).addTickables([wholeRest()]);
        new Formatter().joinVoices([v]).formatToStave([v], stave);
        v.draw(ctx, stave);

        x += measureW;
      }
    }
  }, [systems, gap, measuresPerSystem]);

  return <div ref={ref} />;
};

export default StaffCanvas;
