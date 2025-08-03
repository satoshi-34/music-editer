// src/App.tsx
import { useState } from 'react';
import StaffCanvas from './components/StaffCanvas';

function App() {
  const [note, setNote] = useState('C4');

  return (
    <div style={{ padding: '20px' }}>
      <h1>🎼 楽譜エディタ（MVP）</h1>
      <button onClick={() => setNote('C4')}>ド (C4)</button>
      <button onClick={() => setNote('E4')}>ミ (E4)</button>
      <button onClick={() => setNote('G4')}>ソ (G4)</button>
      <StaffCanvas note={note} />
    </div>
  );
}

export default App;
