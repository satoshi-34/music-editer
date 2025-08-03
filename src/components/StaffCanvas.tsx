// src/components/StaffCanvas.tsx
import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';

type Props = {
  note: string;
};

const StaffCanvas = ({ note }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    renderer.resize(500, 150);
    const context = renderer.getContext();
    context.setFont('Arial', 10, '').setBackgroundFillStyle('#fff');

    const stave = new Stave(10, 40, 400);
    stave.addClef('treble').addTimeSignature('4/4');
    stave.setContext(context).draw();

    const match = note.match(/^([A-Ga-g])([0-9])$/);
    if (!match) {
      console.warn('Invalid note format:', note);
      return;
    }

    const [, pitch, octave] = match;
    const key = `${pitch.toLowerCase()}/${Number(octave) + 1}`;

    console.log('描画するnote:', note);
    console.log('変換されたkey:', key);

    const vfNote = new StaveNote({
      keys: [key],
      duration: 'q',
      clef: 'treble',
    });

const voice = new Voice({
  beats: 4,
  beat_value: 4,
  resolution: 480,
  strict: false,
} as any); // ← これでTSの警告消える

voice.setStrict(false);
voice.addTickables([vfNote]);

new Formatter().joinVoices([voice]).format([voice], 400);
voice.draw(context, stave);



  }, [note]);

  return <div ref={containerRef}></div>;
};

export default StaffCanvas;
