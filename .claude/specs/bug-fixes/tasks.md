# 実装計画: バグ修正 (Bug Fixes)

## 概要

静的解析・コードレビューで発見された9件のバグを、深刻度の高い順に修正します。
すべてのタスクは実装済みです（コミット: `a164510`、ブランチ: `claude/understand-app-functionality-2sJos`）。

---

## タスク

- [x] 1. `utils/storage.ts` — `loadScoreData()` 再帰呼び出しの除去
  - チェックサム不一致時のバックアップ検証をインラインロジックに変更
  - バックアップも不一致の場合は `CORRUPTED_DATA` エラーを返す
  - `localStorage.removeItem(PRIMARY)` + 再帰呼び出しのコードパスを削除
  - _要件: 1.1, 1.2, 1.3, 1.4_

- [x] 2. `audio/SoundSource.ts` — AudioContext 未作成時の楽器ロード修正
  - AudioContext が `null` または `closed` の場合、エラーをスローするよう変更
  - 黙って `return` して「読み込み済み」と誤認させるコードを除去
  - _要件: 2.1, 2.2, 2.3_

- [x] 3. `audio/SoundSource.ts` — `unloadInstrument()` リソースリーク修正
  - `loadingPromises` から Promise 参照を取得してから `delete` するよう変更
  - コールバック内で直接 `synthMap` を操作して再帰呼び出しを除去
  - _要件: 3.1, 3.2, 3.3, 3.4_

- [x] 4. `components/StaffCanvas.tsx` — `getBoundingBox()` null フォールバック改善
  - `fallbackNoteWidth = Math.max(20, wDraw / (vfNotes.length + 1))` を導入
  - `getAbsoluteX()` のフォールバックを比例座標に統一
  - _要件: 4.1, 4.2, 4.3_

- [x] 5. `components/StaffCanvas.tsx` — スナップ計算の精度修正
  - `Number(line.toFixed(1))` を `Math.round(line * 2) / 2` に変更
  - _要件: 5.1, 5.2, 5.3_

- [x] 6. `components/ScorePage.tsx` — 空小節の拍数を定数に抽出
  - ファイル先頭に `const BEATS_PER_MEASURE = 4` を定義
  - `calculateScoreDuration()` 内のマジックナンバー `4` を定数で置き換え
  - _要件: 6.1, 6.2_

- [x] 7. `audio/AudioEngine.ts` — `getContext()` null ガード追加と分岐整理
  - `getContext()` の結果を変数に受け、null チェックを追加
  - 重複した if-else 分岐を `state !== 'running'` の単一分岐に整理
  - _要件: 7.1, 7.2, 7.3_

- [x] 8. `components/StaffCanvas.tsx` — keydown リスナーの Ref 化
  - `selectedRef` と `disabledRef` を `useRef` で追加
  - 各 Ref を同期させる `useEffect` を追加
  - `keydown` リスナー内で state の代わりに Ref を参照
  - `useEffect` の依存配列を `[]` に変更
  - _要件: 8.1, 8.2, 8.3, 8.4_

- [x] 9. `components/ScorePage.tsx` — リサイズイベントにデバウンス追加
  - `setTimeout` 150ms のデバウンスを `onResize` ハンドラに実装
  - cleanup 関数で `removeEventListener` と `clearTimeout` の両方を実行
  - _要件: 9.1, 9.2, 9.3_

- [x] 10. コミット・プッシュ
  - `git add` 対象5ファイルをステージング
  - コミットメッセージに全修正内容のサマリーを含める
  - `origin/claude/understand-app-functionality-2sJos` へプッシュ

---

## 修正の依存関係

```
修正1 (storage)       → 独立
修正2 (SoundSource)   → 独立
修正3 (SoundSource)   → 修正2 の後が望ましい（同ファイル）
修正4 (StaffCanvas)   → 独立
修正5 (StaffCanvas)   → 独立（修正4と同ファイルだが依存なし）
修正8 (StaffCanvas)   → 独立（修正4,5と同ファイルだが依存なし）
修正6 (ScorePage)     → 独立
修正9 (ScorePage)     → 独立（修正6と同ファイルだが依存なし）
修正7 (AudioEngine)   → 独立
```

---

## テスト観点

各修正に対して以下の観点で動作確認を行う。

| # | 修正 | テスト観点 |
|---|---|---|
| 1 | storage 再帰除去 | チェックサム不一致データで `loadScoreData()` が1回の呼び出しで完了すること |
| 2 | AudioContext 未チェック | AudioContext 未初期化状態で `loadInstrument()` を呼ぶとエラーが返ること |
| 3 | リソースリーク | ロード中に `unloadInstrument()` を呼んでも、ロード完了後に Synth が解放されること |
| 4 | BoundingBox null | 音符が複数ある小節で、クリック位置に応じた正しい挿入位置が返ること |
| 5 | スナップ精度 | 五線の間・線上の任意位置をクリックして正しい音高（0.5行刻み）にスナップすること |
| 6 | 空小節定数 | 空小節のある譜面で `calculateScoreDuration()` が正しい秒数を返すこと |
| 7 | AudioContext null | `Tone.getContext()` が null の場合に明確なエラーメッセージが出力されること |
| 8 | リスナー単一登録 | 複数音符を連続配置しても keydown が正常に機能すること（Delete/矢印キー） |
| 9 | デバウンス | ウィンドウリサイズ中に `columns` 状態が頻繁に変化しないこと |

---

## 注意事項

- 修正2・3は `SoundSource.ts` の同一ファイルへの変更のため、差分レビュー時は2件まとめて確認すること
- 修正8の `selectedRef` パターンは、`setScore(prev => ...)` 内のコールバックは変更対象外（最新の `prev` が自動的に渡されるため）
- 修正6は機能変更ではなくコードの明確化であり、動作に差異はない
