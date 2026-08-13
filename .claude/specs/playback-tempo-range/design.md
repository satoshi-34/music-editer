# 設計書: 再生テンポの有効範囲（Issue #240）

## 問題

運用者の実機テスト（2026-08-11）で、月光第1楽章（Adagio sostenuto ♩≈50台）を
♩=56 で再生しようとしたところ、**入力が無言で元の値（99）へ巻き戻された**。

原因は2つある。

1. **範囲が狭い**: `PlaybackControls.tsx` の `handleTempoInputBlur` が
   `newTempo >= 60 && newTempo <= 200` を直書きしており、Adagio や Largo（♩=40台）、
   Grave が設定できなかった。`TempoManager` の `MIN_BPM=60 / MAX_BPM=200` と
   入力欄・スライダーの `min="60" max="200"` も、それぞれ独立に同じ数字を持っていた
2. **範囲外のフィードバックが無い**: 範囲外は `setTempoInput(currentTempo.toString())` で
   静かに巻き戻すだけだった。利用者からは「入力欄が壊れている」ようにしか見えない

## 修正設計

### 1. 有効範囲の正本を1ファイルに集約（`src/audio/tempoRange.ts` 新設）

```ts
export const MIN_BPM = 30;
export const MAX_BPM = 240;
export function clampBpm(bpm: number, fallback: number): number
export const TEMPO_RANGE_MESSAGE = `テンポは${MIN_BPM}〜${MAX_BPM}の範囲で設定してください`;
```

- `TempoManager` の `MIN_BPM / MAX_BPM` はこの定数を参照するだけにした
  （`private static readonly MIN_BPM = MIN_BPM;`）。`getBPMRange()` の戻り値も自動で追従する
- `PlaybackControls` の入力欄・スライダーの `min` / `max` 属性も同じ定数を渡す。
  これで「入力欄では入るのに保存で弾かれる」ような食い違いが構造的に起きなくなる
- **30〜240 を選んだ理由**: Grave（♩=40前後）〜 Prestissimo（♩=200超）をカバーでき、
  実用の楽曲でこの外に出ることはまず無い。上限 240 は、既にある途中テンポ変更
  （`measureMetaInputUtils.parseBpmInput`）の上限とも一致する

### 2. 範囲外は「巻き戻し」ではなく「クランプ＋一時表示」

トリアージが挙げた2案（メッセージ付きで巻き戻す／範囲へクランプする）のうち、
**推奨どおりクランプと一時表示を併用**した。理由は次のとおり。

- 巻き戻しは、利用者から見て「入力が効かなかった」＝故障と区別が付かない。
  端の値へ寄せれば「これ以上は行かない」という上限の存在が体感として伝わる
- スライダー側は元から端で止まる（クランプ）挙動なので、入力欄だけ巻き戻すのは非対称だった
- ただしクランプは黙って値を書き換える操作でもあるため、
  **寄せたときだけ** `role="status"` の案内文（`テンポは30〜240の範囲で設定してください（30 に合わせました）`）を
  4秒間表示する。範囲内の入力では何も出さない

数字として読めない入力（空欄・記号のみ）は、寄せる先が決められないので従来どおり
元の値へ戻し、同じ案内文（寄せた旨の括弧なし）を出す。

`role="status"` にしたのは、画面を見ていない利用者にも読み上げで届けるため。
既存の無音検知通知（`audio-health-notice`）と同じ見た目・同じ仕組みに合わせている。

### 3. 再生エンジン側

音の予約もハイライトのタイムラインも `60 / bpm` の比例計算しか使っていない
（`ScorePlayer` / `SimpleAudioEngine` / `SoundFontEngine` / `playbackPositionUtils`）。
下限・上限を広げても分岐や固定値には触れないため、**エンジン側のコード変更は不要**。
30 BPM で1拍 2000ms、240 BPM で1拍 250ms になることを単体テストで固定した。

## 影響範囲

| ファイル | 変更 |
| --- | --- |
| `src/audio/tempoRange.ts` | 新設。範囲の定数・クランプ・案内文 |
| `src/audio/TempoManager.ts` | 範囲を `tempoRange` から取り込むだけに変更（検証ロジックは不変） |
| `src/components/PlaybackControls.tsx` | ブラー時の判定をクランプへ変更、案内文の表示、`min`/`max` を定数化 |
| `src/audio/tempoRange.test.ts` | 新設（5件） |
| `src/audio/TempoManager.test.ts` | 端の値・エラーメッセージを新範囲へ更新。旧下限未満（56 / 40）を通すテストを追加 |
| `src/hooks/useTempoStorage.test.ts` | エラーメッセージの範囲表記を更新 |
| `src/utils/playbackPositionUtils.test.ts` | 30 / 240 BPM での予約時刻を固定するテストを追加 |
| `src/components/PlaybackControls.test.tsx` | クランプ・案内・入力欄とスライダーの範囲一致のテストを追加 |

保存済みデータへの影響は無い。旧範囲（60〜200）は新範囲（30〜240）に完全に含まれるため、
`TempoManager.loadSettings()` の検証を通らなくなる保存値は存在しない。

## 未対応（このIssueのスコープ外）

- **途中テンポ変更（小節単位）の下限は 60 のまま**（`measureMetaInputUtils.parseBpmInput`）。
  曲の途中で Adagio へ落とすケースでは同じ症状が起きる。本Issueの受入条件は
  再生テンポ（全体）についてのみ書かれているため触っていない。別Issue化が望ましい
