import { useState } from 'react';
import ScorePage from './components/ScorePage';
import StaffCanvas from './components/StaffCanvas';

export default function App() {
  const [note, setNote] = useState('C4');

  return (
    <ScorePage
      pageNumber={1}
      title="タイトル"
      subtitle="サブタイトル"
      credits={{ composer: "作曲者名", lyricist: "作詞者名", arranger: "編曲者名" }}
    >
      {/* ページ本文の中に、複数段の五線を敷く */}
      <div style={{ paddingTop: 8 }}>
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setNote('C4')}>ド (C4)</button>
          <button onClick={() => setNote('E4')} style={{ marginLeft: 8 }}>ミ (E4)</button>
          <button onClick={() => setNote('G4')} style={{ marginLeft: 8 }}>ソ (G4)</button>
        </div>

        {/* content領域の横幅に合わせて StaffCanvas が自動リサイズ */}
        <StaffCanvas 
          note={note} 
          systems={6} 
          gap={110} 
          measuresPerSystem={4}
        />
      </div>
    </ScorePage>
  );
}
