// 開発環境限定の定数チューニングパネル（Issue #596）。
//
// App が import.meta.env.DEV のときだけ動的 import で読み込む（本番バンドルに含めない。
// 動的 import と DEV ガードを同一関数内に置く規約は Turbopack の教訓と同じ考え方）。
// 値は localStorage（dev-tuning-overrides）へ保存し、devTuned() 経由で各定数の
// 読み出し点に効く。段割りのような「開いたときに計画される」値は再読み込みで反映する。
import { useState } from 'react';
import {
  DEV_TUNING_ENTRIES,
  formatDevTuningForCode,
  getDevTuningOverrides,
  resetAllDevTuning,
  setDevTuningOverride,
} from '../utils/devTuning';

export default function DevTuningPanel() {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>(() => getDevTuningOverrides());
  const [copied, setCopied] = useState(false);

  const dirty = Object.keys(overrides).length > 0;

  const update = (key: string, value: number | null) => {
    setDevTuningOverride(key, value);
    setOverrides(getDevTuningOverrides());
  };

  const copyForCode = async () => {
    try {
      await navigator.clipboard.writeText(formatDevTuningForCode());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードが使えない環境では何もしない（値はパネルに見えている）
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: 9999,
        fontSize: 12,
        maxWidth: 340,
      }}
      data-testid="dev-tuning-panel"
    >
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="開発用: 定数チューニング（#596）"
          style={{
            border: '1px solid #d1d5db',
            borderRadius: 8,
            background: dirty ? '#fef3c7' : '#fff',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          🔧 dev調整{dirty ? '（上書き中）' : ''}
        </button>
      )}
      {open && (
        <div
          style={{
            border: '1px solid #d1d5db',
            borderRadius: 10,
            background: '#fff',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            padding: 12,
            display: 'grid',
            gap: 10,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>🔧 dev調整（#596）</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="dev調整を閉じる">×</button>
          </div>
          <div style={{ color: '#6b7280', lineHeight: 1.5 }}>
            開発環境限定。値は localStorage の上書きで、正本はコードの定数のまま。
            レイアウト系は<strong>「反映（再読み込み）」で段割りへ反映</strong>されます。
          </div>
          {DEV_TUNING_ENTRIES.map((entry) => {
            const value = overrides[entry.key] ?? entry.defaultValue;
            const overridden = overrides[entry.key] !== undefined;
            return (
              <div key={entry.key} style={{ display: 'grid', gap: 2 }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {entry.label}
                    {overridden && <span style={{ color: '#b45309' }}>（上書き中）</span>}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {value}{entry.unit ?? ''}
                    <span style={{ color: '#9ca3af' }}>（既定 {entry.defaultValue}{entry.unit ?? ''}）</span>
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="range"
                    min={entry.min}
                    max={entry.max}
                    step={entry.step}
                    value={value}
                    aria-label={entry.label}
                    onChange={(e) => update(entry.key, Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    min={entry.min}
                    max={entry.max}
                    step={entry.step}
                    value={value}
                    aria-label={`${entry.label}（数値）`}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) update(entry.key, n);
                    }}
                    style={{ width: 70 }}
                  />
                  {overridden && (
                    <button type="button" onClick={() => update(entry.key, null)} title="この項目の上書きを消して既定へ">
                      戻す
                    </button>
                  )}
                </div>
                <div style={{ color: '#6b7280' }}>{entry.description}</div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => window.location.reload()} style={{ fontWeight: 600 }}>
              反映（再読み込み）
            </button>
            <button type="button" onClick={copyForCode}>
              {copied ? 'コピーしました' : '現在値をコピー（コード形式）'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetAllDevTuning();
                setOverrides({});
              }}
            >
              全部リセット
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
