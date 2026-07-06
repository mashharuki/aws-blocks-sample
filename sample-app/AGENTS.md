# エージェントガイド

## クイックリファレンス

- **バックエンド:** `aws-blocks/index.ts` — API、認証、データモデル
- **フロントエンド:** `src/` — `import { api } from 'aws-blocks'` でバックエンドAPIをimport
- **テスト:** `test/e2e.test.ts` — `npm run test:e2e` で実行
- **完全ガイド:** `node_modules/@aws-blocks/blocks/README.md` — アーキテクチャ、ワークフロー、ベストプラクティス、よくある間違い
- **Blockカタログ + 決定木:** `node_modules/@aws-blocks/blocks/docs/index.md`
- **Block別ドキュメント:** `node_modules/@aws-blocks/blocks/docs/<package-name>.md`

## ワークフロー

1. バックエンド（`aws-blocks/index.ts`）またはフロントエンド（`src/`）を変更する
2. `npm run test:e2e` でテストする — dev serverが起動していなければ自動的に起動する
3. より速いイテレーションのために: バックグラウンドで `npm run dev &` を実行し、`npm run test:e2e` を繰り返し実行する（起動中のサーバーを再利用する）
4. 接続の問題を調査する場合以外は、APIに対してcurl/fetchを使わない

## ルール

- 永続化とクラウド抽象化には**すべてBuilding Blockを使う** — ローカルファイル、インメモリ配列、ローカルデータベースは絶対に使わない。
- Blockを使う前に `node_modules/@aws-blocks/blocks/docs/<package-name>.md` の**Blockドキュメントを読む**。
- **JSON-RPCトランスポートは不可視** — RPCペイロードを手動で組み立てない。型付きAPIを直接importして呼び出す。

## デプロイ（AWS認証情報が必要）

- `npm run sandbox` — バックエンドをAWSへデプロイし、フロントエンドはローカルで提供
- `npm run deploy` — AWSへの本番フルデプロイ
- `npm run sandbox:destroy` — サンドボックスリソースを削除
