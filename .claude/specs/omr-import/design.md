# PDF楽譜の取り込み（OMR 変換サーバ経由）設計書

対象 Issue: #487（#461 段1）
初版: 2026-08-29

## 1. 背景と方式決定

紙・PDFの楽譜を本アプリで編集したい、という要望（#461）に対し、
2026-08-29 のスパイクで3経路を比較した（詳細は #461 のコメント）。

| 経路 | 結果 | 判定 |
| --- | --- | --- |
| Audiveris 5.11（Java・AGPL） | 浄書PDFで69小節・調号・音高が正解と一致。3ページ26秒。出力 .mxl が本アプリでそのまま開けた | ◎ 採用 |
| oemer（Python・MIT） | 1ページ2.6分。リズムが崩壊し実用外 | ✕ |
| VLM に画像を直接読ませる | 小節単位なら高精度だが、一括変換にはコスト高 | △ 後続の「修正層」で補助的に使う |

出版譜スキャンでは弱点が2つある（1段目の左手ヘ音記号の検出漏れ／三連符マーカーの欠落）。
つまり**完成品ではなく「修正前提の下書き」**であり、UI上も β として提示する。

方式: **Audiveris を変換サーバ（コンテナ）に閉じ込め、アプリは HTTP で呼ぶだけ**にする。

```
アプリ（「PDF (β)」ボタン）
   │  POST /convert （multipart: PDF）
   ▼
変換API コンテナ  server/omr
   │  Audiveris CLI を子プロセスで実行（-batch -export）
   ▼
 .mxl（圧縮MusicXML）
   │
   ▼
既存の MusicXML 読込経路（mxlUtils → musicXmlImport）
```

## 2. AGPL の整理（なぜこの構成なのか）

Audiveris は AGPL v3。本体アプリをクローズドソースのまま提供する前提のため、
以下を**設計上の制約**として固定する。

- Audiveris は**公式配布のバイナリ（.deb）を無改造のまま**コンテナへ入れる
- 呼び出しは**別プロセスの起動（CLI）と HTTP** に限る。ライブラリとしてリンクしない・
  ソースを取り込まない・パッチを当てない
- Audiveris に手を入れる必要が出た場合は、実装せずに Issue へ差し戻す（判断を人に返す）

※ AGPL の「ネットワーク越しの利用者へのソース提供義務」は Audiveris 本体（無改造）に関する
ものであり、公開時には配布元と版を明示できる状態にしておく（`AUDIVERIS_VERSION` を Dockerfile の
ARG にしているのはこのため）。

## 3. 変換API（server/omr）

| ファイル | 役割 |
| --- | --- |
| `Dockerfile` | ubuntu 24.04 + Audiveris 5.11.0 の公式 .deb（Java 21 同梱）+ Node（薄いラッパー） |
| `server.js` | HTTP 層（`POST /convert`・`GET /health`・CORS） |
| `convert.js` | multipart 解析・入力上限・理由コード（**依存ゼロ・単体テスト対象**） |
| `audiveris.js` | Audiveris の子プロセス実行・一時ファイルの後始末 |

### API

- `POST /convert`（`multipart/form-data`, フィールド名 `file`）→ 成功時 `200` で .mxl のバイト列
  （`content-type: application/vnd.recordare.musicxml`）
- 失敗時は `{ "error": { "reason": ..., "message": ... } }`（#318: 黙って失敗しない）

| reason | HTTP | 意味 |
| --- | --- | --- |
| `noFile` | 400 | multipart に PDF が入っていない |
| `notPdf` | 400 | 中身が PDF でない（先頭が `%PDF-` でない） |
| `tooLarge` | 413 | 20MB 超 |
| `tooManyPages` | 413 | 20ページ超 |
| `timeout` | 504 | 120秒以内に終わらなかった |
| `conversionFailed` | 422 | Audiveris が異常終了 |
| `noOutput` | 422 | 変換は終わったが .mxl が出てこなかった（譜面として読めなかった） |

### 設計上の判断

- **依存パッケージを入れない**: multipart の解析は「PDFが1つ入っているだけ」の用途に絞った
  最小実装（`convert.js`）にした。express/busboy を足すと、変換サーバ側にも依存更新の運用が
  発生するため（アプリ本体の依存追加ルールと同じ考え方）
- **ページ数の数え方は best-effort**: PDF は本文をオブジェクトストリームで圧縮でき、
  非圧縮の `/Type /Page` を数える方法では**数えられない PDF がある**。数えられない場合は
  ページ上限を課さず、変換タイムアウト（120秒）で守る。正当なPDFを誤って弾かないことを優先した
- **一時ファイルは必ず消す**: 入力PDFと出力 .mxl は `mkdtemp` の作業ディレクトリに置き、
  成功・失敗にかかわらず `finally` で削除する（ユーザーの楽譜をサーバーに残さない）
- **実行ファイルのパスを決め打ちしない**: .deb の配置はパッケージの作り方で変わるため、
  ビルド時に `find` で探して `/usr/local/bin/audiveris` へ symlink する
- **非 root で動かす**（ubuntu イメージ既定の `ubuntu` ユーザー）

## 4. アプリ側

- `src/utils/omrApi.ts`: 変換APIのクライアント。`VITE_OMR_API_URL` が未設定なら `getOmrApiUrl()` が
  `null` を返し、**「PDF (β)」ボタンも隠しファイル入力も描画しない**（本番は当面非表示のまま）
- `src/components/ScorePage.tsx`:
  - 既存の `handleImportMusicXml` の中身を **`applyImportedMusicXmlBytes(bytes, fileName)` へ抽出**し、
    ファイル選択経路と PDF変換経路の**両方が同じ読込処理を通る**ようにした。
    経路ごとに読込処理を書くと片方だけ直る事故（#280 の型）になるため、新しいパース処理は書かない
  - `handleImportPdf`: 変換API → 返ってきた .mxl を `applyImportedMusicXmlBytes` へ渡す。
    変換中はボタンを「PDF 変換中…」にして無効化（数十秒かかるため、二重送信も防ぐ）
- `src/utils/scoreEditorNotices.ts`: `describeOmrConvertFailed(reason)` を追加。
  **失敗時は必ず理由＋代替手順（Audiveris で手元変換 →「MusicXML (.mxl)」で開く）**を出す

## 5. テスト

| テスト | 内容 |
| --- | --- |
| `server/omr/convert.test.js` | 正常系（multipart から PDF を取り出す）・上限超過（tooLarge / tooManyPages）・壊れたPDF（notPdf）・ページ数を数えられないPDFを弾かないこと |
| `src/utils/omrApi.test.ts` | fetch モックで送信先/形式、失敗レスポンスの理由コードの持ち上げ、URL 未設定時に通信しないこと |
| `src/components/ScorePagePdfImport.test.tsx` | ScorePage の配線: URL 未設定ならボタンを出さない／PDF を選ぶと変換APIへ送り、返った .mxl が画面へ反映される／失敗時は理由と代替手順を通知し譜面を変えない |

## 6. 影響範囲

- 既存の MusicXML / .mxl 読込は `applyImportedMusicXmlBytes` への抽出のみで、**挙動は変えていない**
  （`ScorePageMxlImport.test.tsx` が回帰の見張り役）
- 変換API を使わない環境（= 本番）では、UI もネットワークアクセスも一切増えない
- ローカルで使う場合:
  ```sh
  docker compose --profile omr up omr          # 変換APIを 127.0.0.1:8080 で起動
  VITE_OMR_API_URL=http://localhost:8080 npm run dev
  ```

## 7. 本Issueの範囲外（後続）

- Cloud Run 等へのデプロイ（レビュアーが手動で実施）
- クレフ誤検出・連符欠落の自動補正（「修正層」。拍不整合の検出→VLM で該当小節を再読→修正提案）
- 変換の進捗表示（現状は「変換中…」のみ。Audiveris はページ単位の進捗を出せるが、
  ストリーミングAPIが必要になるため見送り）

## 8. 未検証事項（2026-08-29 時点）

- **コンテナイメージのビルドは未実行**。作業機から Docker Hub の `ubuntu:24.04` を取得できず
  （`DeadlineExceeded`）、`docker build` を完走できなかった。.deb の URL と資産名は
  GitHub Releases API で実在を確認済み（`Audiveris-5.11.0-ubuntu24.04-x86_64.deb`）だが、
  **Audiveris の起動確認・実PDFのエンドツーエンド変換は未実施**。最初に動かす人は
  `docker compose --profile omr build omr` の完走と `/health` の応答から確認すること
