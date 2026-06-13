# AI事前問診メモ — 7月2日デモ版

患者がスマホで症状を話すと、**クリニックごとの問診リストに沿ってAIが不足項目を音声で追加質問**し、問診メモを完成。**QRコード**で受付に提示すると、受付の **iPad** で読み取って表示・**AirPrint印刷**できる、という一連のデモ。

```
患者: スマホで音声 → AIが追加質問で問診リストを完成 → QR表示
   ↓
クリニック: iPadでQR読み取り → メモ表示 → プリント
```

## 📦 構成

```
ai-prediagnosis-pwa/
├── patient-app/            患者用PWA（スマホ）
│   ├── index.html
│   ├── app.js              AI追加質問ロジック・QR生成
│   ├── clinic-template.js  クリニック別 問診テンプレート（クレアス固定）
│   ├── service-worker.js
│   ├── manifest.json
│   └── vendor/             lz-string / qrcode（ローカル同梱）
├── reception-app/          受付用Webアプリ（iPad/Safari）
│   ├── index.html
│   ├── app.js              QR読取・表示・印刷
│   ├── manifest.json
│   └── vendor/             lz-string / jsQR（ローカル同梱）
├── DEMO_GUIDE.md           当日の操作手順・トラブル対処
└── README.md               このファイル
```

## 🎯 デモ版の仕様（Before → After）

| 項目 | Before（旧プロト） | After（デモ版） |
| --- | --- | --- |
| 問診ロジック | 主訴のみ確認 | クリニック別問診リストで不足項目を会話で埋める |
| クリニック対応 | 単一 | 複数クライアント対応（テンプレJSON切替） |
| デモクリニック | なし | クレアスクリニック（一般内科を想定） |
| 送信方法 | LINEで送る | ❌ 削除 |
| 受け渡し | OS共有シェア | QR提示 → iPadで読取 → AirPrint印刷 |

- **問診リスト**: コア9項目 ＋ 主訴別（痛み=OPQRST / 発熱 / 慢性 / 子ども）を動的追加
- **テンプレ管理**: `patient-app/clinic-template.js` に JSON ハードコード（`creas` 固定）
- **QR受け渡し**: メモをLZString圧縮してQRに直接埋め込み（サーバー不要）
- **iPad側**: Safari で開く軽量Webアプリ。jsQRでカメラ読取、`window.print()` でAirPrint

## 🔄 AI対話の流れ

1. **自由発話** … 「今日はどうされましたか？」に患者が自由に話す
2. **分析** … 発話を問診テンプレと照合し、埋まった項目／不足項目を判定
3. **追加質問** … 不足項目を1つずつ音声で質問。曖昧なら1回だけ聞き直し、それでも不明なら「不明」で記録（最大2回）
4. **完成** … メモ確認・編集 → QR表示

## 🔑 OpenAI APIキー

設定（⚙️）でキーを入れると Whisper（音声認識）＋ GPT-4o（分析・抽出）が動作。未設定時はモックデータでフロー全体を体験できる。

> ⚠️ デモ用にキーをブラウザのlocalStorageに保存します。本番はサーバー側管理が必須（後述「今後の課題」）。

## 🚀 公開（GitHub Pages）

このリポジトリの Settings → Pages → Branch を `main` / `(root)` にして保存すると、数分で公開されます。

- 患者用: `https://<ユーザー名>.github.io/ai-prediagnosis-pwa/patient-app/`
- 受付用: `https://<ユーザー名>.github.io/ai-prediagnosis-pwa/reception-app/`

> マイク・カメラはHTTPSでのみ動作します。GitHub Pages はHTTPSなのでそのまま使えます（`localhost` も可）。

ローカル確認:
```bash
cd ai-prediagnosis-pwa
python -m http.server 8000
# 患者用 http://localhost:8000/patient-app/
# 受付用 http://localhost:8000/reception-app/
```

当日の段取りは **[DEMO_GUIDE.md](DEMO_GUIDE.md)** を参照。

## 🔒 今後クリアすべき課題（デモ後の検討事項）

本番サービス化には、以下を別途検討する必要があります（**デモ版では未対応**）。

- **プライバシー / 個人情報保護法**: 要配慮個人情報（健康情報）の取得・利用同意、利用目的の明示
- **医療情報の3省2ガイドライン**（厚労省／経産省／総務省）: 医療情報システムの安全管理、外部事業者の責任分界
- **APIキー・通信のサーバー側管理**: ブラウザ直叩きをやめ、バックエンド経由に
- **データ保持**: QR直接埋め込み（現状）から、サーバー保存＋ワンタイムトークン方式へ
- **医療広告ガイドライン / 医師法**: 「診断ではない」位置づけの明確化

## 📝 注意事項

このアプリは **患者本人が受付前にメモを作成する** ためのデモです。診断・治療提案は行いません。診察は医療機関で改めて実施されます。
