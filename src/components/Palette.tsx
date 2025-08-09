// src/components/Palette.tsx
export type Tool = { duration: 'q' | 'h' | 'w'; isRest?: boolean };

const presets: Tool[] = [
  { duration: 'w', isRest: false },
  { duration: 'h', isRest: false },
  { duration: 'q', isRest: false },
  { duration: 'w', isRest: true },
  { duration: 'h', isRest: true },
  { duration: 'q', isRest: true },
];

export default function Palette({
  value,
  onChange,
}: {
  value: Tool;
  onChange: (t: Tool) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: 8 }}>
      {presets.map((t, i) => {
        const active = value.duration === t.duration && !!value.isRest === !!t.isRest;
        return (
          <button
            key={i}
            onClick={() => onChange(t)}
            style={{
              padding: '6px 10px',
              border: '1px solid #ccc',
              borderRadius: 8,
              background: active ? '#e7f0ff' : 'white',
              cursor: 'pointer',
            }}
            title={`${t.isRest ? 'rest ' : 'note '}${t.duration}`}
          >
            {t.isRest ? `休符 ${t.duration}` : `音符 ${t.duration}`}
          </button>
        );
      })}
    </div>
  );
}
