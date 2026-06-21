# AI事前問診メモ — Cloudflare Pages 版（7月2日デモ）

患者がスマホで症状を話すと、**クリニックごとの問診リストに沿ってAIが不足項目を音声で追加質問**し、問診メモを完成。**QRコード**で受付に提示すると、受付の **iPad** で読み取って表示・**AirPrint印刷**できる、という一連のデモ。

```
患者: スマホで音声 → AIが追加質問で問診リストを完成 → QR表示
   ↓
クリニック: iPadでQR読み取り → メモ表示 → プリント
```

> このブランチ（`cloudflare`）は **Cloudflare Pages** で配信する構成です。
> プロキシは別Workerをやめ、**同一ドメインの Pages Functions（`functions/api/*`）** に統合しています（CORS不要）。
> `main` ブランチは従来の **GitHub Pages ＋ Cloudflare Worker** 構成のまま（保険として温存）。

## 🌐 公開URL

- 患者用: `https://qureas-monshin.pages.dev/`（ルートは `/patient-app/` へリダイレクト）
- 受付用: `https://qureas-monshin.pages.dev/reception-app/`

## 📦 構成

```
ai-prediagnosis-pwa/
├── patient-app/            患者用PWA（スマホ）
│   ├── index.html
│   ├── app.js              AI追加質問ロジック・QR生成（API_PROXY_BASE = 同一オリジン）
│   ├── clinic-template.js  クリニック別 問診テンプレート（クレアス固定）
│   ├── service-worker.js
│   ├── manifest.json
│   └── vendor/             lz-string / qrcode（ローカル同梱）
├── reception-app/          受付用Webアプリ（iPad/Safari）
│   ├── index.html
│   ├── app.js              QR読取・表示・印刷
│   ├── manifest.json
│   └── vendor/             lz-string / jsQR（ローカル同梱）
├── functions/              Cloudflare Pages Functions（サーバー側プロキシ）
│   └── api/
│       ├── transcribe.js   POST /api/transcribe → OpenAI Whisper へ中継
│       └── chat.js         POST /api/chat       → OpenAI Chat Completions へ中継
├── _redirects              ルート / を /patient-app/ へ（配布URLはドメインのみで済む）
├── proxy/                  旧Cloudflare Worker（main用・保険。Pages版では未使用）
├── docs/                   検討資料（医院提供に向けた検討事項 ほか）
├── DEMO_GUIDE.md           当日の操作手順・トラブル対処
└── README.md               このファイル
```

## 🔧 バックエンド（Cloudflare Pages Functions・同一ドメイン）

患者アプリと**同じドメインの `/api/*`** がOpenAIへ中継します。別Workerは不要で、CORSも不要。

```
患者アプリ（qureas-monshin.pages.dev）
   │  POST /api/transcribe（音声）
   │  POST /api/chat（要約・翻訳・抽出）
   ▼
Pages Functions（functions/api/*.js）── OPENAI_API_KEY（Secret）──▶ OpenAI
```

- `patient-app/app.js` の `API_PROXY_BASE = window.location.origin`（＝同一オリジン）。独自ドメインを後付けしてもそのまま動く。
- **OpenAI APIキーはクライアントに置かない**。Cloudflare Pages の環境変数（Secret）に保存。

## 🚀 デプロイ（Cloudflare Pages）

GitHubリポジトリと連携し、`cloudflare` ブランチへ push すると自動デプロイされます。

1. Cloudflare ダッシュボード → Workers & Pages → Create → **Pages** → Connect to Git
2. リポジトリ `ai-prediagnosis-pwa` を選択
3. ビルド設定:
   - Project name: `qureas-monshin`（＝URLになる）
   - **Production branch: `cloudflare`**
   - Framework preset: `None` ／ Build command: 空 ／ Build output directory: `/`
4. デプロイ後、**Settings → 環境変数（Production）** に登録:
   - `OPENAI_API_KEY` … 必須（**タイプ＝シークレット／暗号化**）
   - `APP_TOKEN` … 任意（合言葉。設定すると `x-app-token` 必須に）
5. 変数追加後は **Deployments → 最新 → Retry deployment** で反映

> マイク・カメラはHTTPSでのみ動作。Cloudflare Pages はHTTPSなのでそのまま使えます。
> 配布に使うのは固定URLの `qureas-monshin.pages.dev`。`<ハッシュ>.qureas-monshin.pages.dev` はデプロイ毎の確認用。

## 🌿 ブランチ運用

| ブランチ | 配信 | プロキシ | 位置づけ |
| --- | --- | --- | --- |
| `cloudflare` | Cloudflare Pages | Pages Functions（同一ドメイン・CORS無し） | 本番デモ（7/2） |
| `main` | GitHub Pages | 旧Cloudflare Worker | 保険・従来構成 |

`main` を据え置くことで、`cloudflare` 側に問題が出ても従来URLで配布を継続できます。

## 🎯 デモ版の仕様

- **問診リスト**: コア9項目 ＋ 主訴別（痛み=OPQRST / 発熱 / 慢性 / 子ども）を動的追加
- **テンプレ管理**: `patient-app/clinic-template.js` に JSON ハードコード（`creas` 固定）
- **QR受け渡し**: メモをLZString圧縮してQRに直接埋め込み（サーバーに患者データを保存しない）
- **iPad側**: Safari で開く軽量Webアプリ。jsQRでカメラ読取、`window.print()` でAirPrint

## 🔄 AI対話の流れ

1. **自由発話** … 「今日はどうされましたか？」に患者が自由に話す
2. **分析＋立案** … 発話を問診テンプレと照合し、埋まった項目を抽出。話していない点だけ深掘り質問を作る（1回のAI判断に統合）
3. **追加質問** … 不足項目を1つずつ音声で質問。曖昧なら聞き直し（目立つバーで明示）、「わからない」は不明で確定（最大2回）
4. **完成** … メモ確認・編集 → QR表示

> 音声まわりの保険: 無音・短すぎる録音や Whisper の“幻聴”（「チャンネル登録を…」等）は弾き、「もう一度お話しください」と再録音を促す。録音フォーマットに合ったファイル名で送信。

## 🔑 OpenAI APIキー

- **配布動作**: Pages の Secret（`OPENAI_API_KEY`）で動作。キーはサーバー側に隠れる。
- **端末ごとキー / モック**: `API_PROXY_BASE` が無効な環境では、設定（⚙️）で各自キー投入、または未設定でモック体験が可能（開発用）。

## 🔒 今後クリアすべき課題（クライアント医院提供時）

本番サービス化には別途検討が必要（**デモ版では未対応**）。詳細は **[docs/医院提供に向けた検討事項.md](docs/医院提供に向けた検討事項.md)**。

- **プライバシー / 個人情報保護法**: 要配慮個人情報（健康情報）の取得・利用同意、目的明示
- **医療情報の3省2ガイドライン**（厚労省／経産省／総務省）
- **AI送信先**: OpenAI（米国）→ Azure OpenAI（東京リージョン）等への見直し（越境・国内保管）
- **データ保持**: 「サーバーに患者データを保存しない」現設計の維持
- **複数医院対応 / 認証 / 監査ログ**、医療広告ガイドライン・医師法（「診断ではない」位置づけ）

## 📝 注意事項

このアプリは **患者本人が受付前にメモを作成する** ためのデモです。診断・治療提案は行いません。診察は医療機関で改めて実施されます。
