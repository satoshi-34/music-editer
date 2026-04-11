# Requirements Document

## Introduction

このドキュメントは、music-editer アプリケーションで発見された既存バグの修正要件を定義します。対象バグは静的解析・コードレビューによって特定されたもので、データ破損、音声エンジンの誤動作、UIの精度低下、パフォーマンス劣化に関わる問題です。

修正対象ファイル:
- `src/utils/storage.ts`
- `src/audio/SoundSource.ts`
- `src/audio/AudioEngine.ts`
- `src/components/StaffCanvas.tsx`
- `src/components/ScorePage.tsx`

## Glossary

- **Score_System**: 楽譜作成Webアプリケーション全体
- **Storage_Layer**: LocalStorageを用いたデータ永続化層（`storage.ts`）
- **Audio_Engine**: Web Audio API / Tone.js を用いた音声再生層（`SoundSource.ts`, `AudioEngine.ts`）
- **Staff_Canvas**: 五線譜の描画・音符配置を担うコンポーネント（`StaffCanvas.tsx`）
- **Checksum**: データ整合性確認のためのハッシュ値
- **AudioContext**: ブラウザの Web Audio API コンテキスト
- **Synth**: Tone.js の PolySynth シンセサイザーインスタンス
- **Snap**: クリック位置を最近傍の五線位置に吸着させる処理
- **BoundingBox**: VexFlow が返す音符の描画領域

---

## Requirements

### Requirement 1: データ読み込みの安全な復旧処理

**User Story:** データ読み込み時にチェックサム不一致が発生した場合でも、アプリケーションがハングすることなく安全に復旧できること。

#### Acceptance Criteria

1. WHEN プライマリデータのチェックサムが不一致であり、かつバックアップデータが存在する場合、THE Score_System SHALL バックアップを直接検証して使用し、`loadScoreData()` を再帰呼び出ししない
2. WHEN バックアップデータも同様にチェックサムが不一致の場合、THE Score_System SHALL `CORRUPTED_DATA` エラーを返してデータ読み込みを中止する
3. WHEN バックアップデータのパースまたは検証に失敗した場合、THE Score_System SHALL エラーをキャッチしてフォールスルーし、エラー結果を返す
4. WHEN データ読み込みに失敗した場合、THE Score_System SHALL アプリケーションをクラッシュさせず、エラー情報を呼び出し元に伝播する

### Requirement 2: AudioContext 未作成時の楽器読み込み処理

**User Story:** AudioContext が存在しない状態で楽器を読み込もうとした場合、誤った「読み込み済み」状態にならず、明確なエラーが発生すること。

#### Acceptance Criteria

1. WHEN `_performInstrumentLoad()` が呼ばれた時点で AudioContext が `null` または `closed` 状態の場合、THE Audio_Engine SHALL 楽器を `synthMap` に登録せず、エラーをスローする
2. WHEN 楽器読み込みがエラーで終了した場合、THE Audio_Engine SHALL `isInstrumentLoaded()` が正しく `false` を返すことを保証する
3. WHEN AudioContext が正常に作成された後に楽器を読み込む場合、THE Audio_Engine SHALL 正常にシンセサイザーを作成・登録する

### Requirement 3: 楽器解放時のリソースリーク防止

**User Story:** 楽器の読み込み中に解放操作が発生した場合、読み込み完了後のシンセサイザーが確実に破棄されること。

#### Acceptance Criteria

1. WHEN `unloadInstrument()` が呼ばれた時点で当該楽器が読み込み中の場合、THE Audio_Engine SHALL `loadingPromises` から Promise を取得してから `delete` し、完了後にシンセサイザーを破棄する
2. WHEN 読み込み Promise が解決した後に `synthMap` に楽器が存在する場合、THE Audio_Engine SHALL `dispose()` を呼び出してから `synthMap` から削除する
3. WHEN 読み込み Promise がエラーで終了した場合、THE Audio_Engine SHALL 破棄処理をスキップして正常終了する
4. WHEN `unloadInstrument()` を再帰呼び出ししない場合でも、THE Audio_Engine SHALL 同等のリソース解放結果を保証する

### Requirement 4: 音符クリック判定の精度向上

**User Story:** 音符がすでに配置されている小節をクリックした場合、挿入位置が正確に判定されること。

#### Acceptance Criteria

1. WHEN VexFlow の `getBoundingBox()` が `null` を返す場合、THE Staff_Canvas SHALL 小節幅と音符数に基づいた比例幅（`wDraw / (vfNotes.length + 1)`）をフォールバックとして使用する
2. WHEN VexFlow の `getAbsoluteX()` が未定義の場合、THE Staff_Canvas SHALL 比例配分された位置座標をフォールバックとして使用する
3. WHEN フォールバック値を使用する場合、THE Staff_Canvas SHALL 最小幅 20px を下限として保証する

### Requirement 5: Y 方向スナップの精度保証

**User Story:** 五線譜上のクリック位置が、正確に 0.5 行刻みの音高位置へスナップされること。

#### Acceptance Criteria

1. WHEN スナップ計算が実行される場合、THE Staff_Canvas SHALL `Math.round(line * 2) / 2` を使用して 0.5 刻みで正確に丸める
2. WHEN ループ変数 `line` が浮動小数点誤差を含む場合、THE Staff_Canvas SHALL `toFixed(1)` ではなくビット演算を避けた算術丸めを使用する
3. WHEN 計算結果が確定した場合、THE Staff_Canvas SHALL 五線位置 `bestLine` として整数または `.5` 末尾の値のみを持つことを保証する

### Requirement 6: 空小節の再生時間計算の明確化

**User Story:** 空小節の再生時間が定数として管理され、将来の拍子記号変更に対応しやすいコードになること。

#### Acceptance Criteria

1. WHEN 空小節の再生時間を計算する場合、THE Score_System SHALL `BEATS_PER_MEASURE` 定数を使用してハードコードされた `4` を排除する
2. WHEN `BEATS_PER_MEASURE` を定義する場合、THE Score_System SHALL ファイルの先頭（関数外）に配置してスコープを明確にする

### Requirement 7: AudioContext の null 安全な初期化

**User Story:** AudioEngine の `start()` 処理において、`getContext()` が null を返す場合にクラッシュしないこと。

#### Acceptance Criteria

1. WHEN `this.Tone.getContext()` を呼び出す場合、THE Audio_Engine SHALL 結果が `null` でないことを確認してから `.state` にアクセスする
2. WHEN `getContext()` が `null` を返す場合、THE Audio_Engine SHALL 明確なエラーメッセージをスローする
3. WHEN AudioContext が `running` 以外の状態の場合、THE Audio_Engine SHALL 重複した if-else 分岐なしに `Tone.start()` を呼び出す

### Requirement 8: キーボードイベントリスナーの効率的な管理

**User Story:** 音符の選択状態が変わるたびにキーボードリスナーが再登録されず、マウント時に1度だけ登録されること。

#### Acceptance Criteria

1. WHEN `StaffCanvas` がマウントされる場合、THE Staff_Canvas SHALL `keydown` リスナーを1回だけ登録する
2. WHEN `selected` 状態が変化する場合、THE Staff_Canvas SHALL リスナーの再登録をせず、Ref を通じて最新の `selected` 値を参照する
3. WHEN `disabled` 状態が変化する場合、THE Staff_Canvas SHALL Ref を通じて最新の `disabled` 値を参照する
4. WHEN `StaffCanvas` がアンマウントされる場合、THE Staff_Canvas SHALL 登録したリスナーを正しく削除する

### Requirement 9: ウィンドウリサイズのデバウンス処理

**User Story:** ブラウザウィンドウのリサイズ中に過剰な再レンダリングが発生しないこと。

#### Acceptance Criteria

1. WHEN ウィンドウリサイズイベントが発生した場合、THE Score_System SHALL 最後のイベントから 150ms 経過後に `columns` 状態を更新する
2. WHEN リサイズが連続して発生する場合、THE Score_System SHALL タイマーをリセットして最終状態のみを反映する
3. WHEN `ScorePage` がアンマウントされる場合、THE Score_System SHALL 保留中のデバウンスタイマーをクリアする
