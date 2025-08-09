import { useState } from 'react';
import ScorePage from './components/ScorePage';
import StaffCanvas from './components/StaffCanvas';
import Palette, { type Tool } from './components/Palette';

export default function App() {
  const [tool, setTool] = useState<Tool>({ duration: 'q', isRest: false });

  return (
    <ScorePage pageNumber={1} title="タイトル" subtitle="サブタイトル">
      <div style={{ paddingTop: 8}}>
        <div style={{ marginBottom: 16}}>
          <Palette value={tool} onChange={setTool} />
        </div>
          <StaffCanvas systems={6} gap={110} measuresPerSystem={4} tool={tool} />
      </div>
    </ScorePage>
  );
}
