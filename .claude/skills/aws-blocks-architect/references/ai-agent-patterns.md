# AI エージェントパターン (Agent / KnowledgeBase)

`Agent` Block と `KnowledgeBase` Block を使った実装パターン。SKILL.mdのStep 2/3でAI機能を
実装する際の参考にする。裏側は Amazon Bedrock。

## 目次

1. [KnowledgeBaseの構築](#1-knowledgebaseの構築)
2. [Agentの基本構成](#2-agentの基本構成)
3. [Human-in-the-Loop (承認フロー)](#3-human-in-the-loop-承認フロー)
4. [フロントエンドのuseChat](#4-フロントエンドのusechat)
5. [ローカル開発時の挙動と注意点](#5-ローカル開発時の挙動と注意点)
6. [モデル選択](#6-モデル選択)
7. [会話永続化](#7-会話永続化)

---

## 1. KnowledgeBaseの構築

```typescript
import { KnowledgeBase } from '@aws-blocks/blocks';

const kb = new KnowledgeBase(scope, 'docs', {
  source: './knowledge',           // ドキュメントを配置したローカルディレクトリ
  description: 'プロダクトドキュメント',
  chunking: { strategy: 'semantic' }, // 意味的なまとまりでチャンク分割
});

const results = await kb.retrieve('返金ポリシーは？', { maxResults: 4 });
```

`source` に指定したディレクトリの内容がデプロイ時にBedrock Knowledge Basesへ取り込まれる。
ドキュメントを更新した場合は再デプロイが必要になる点に注意する（頻繁に変わるコンテンツは
別のBlock、例えば `FileBucket` + 独自の取り込みパイプラインの検討も選択肢に入れる）。

---

## 2. Agentの基本構成

```typescript
import { Agent, BedrockModels } from '@aws-blocks/blocks';
import { z } from 'zod';

const agent = new Agent(scope, 'support', {
  model: { deployed: BedrockModels.BALANCED }, // コスト/性能バランス型モデル
  systemPrompt: 'あなたはAcmeCloudのサポート担当者です。丁寧かつ簡潔に回答してください。',
  tools: (tool) => ({
    searchDocs: tool({
      description: 'ドキュメント検索',
      parameters: z.object({ query: z.string() }),
      handler: async ({ input }) => kb.retrieve(input.query, { maxResults: 4 }),
    }),
    getOrderStatus: tool({
      description: '注文ステータスを取得する',
      parameters: z.object({ orderId: z.string() }),
      handler: async ({ input }) => ORDERS[input.orderId],
    }),
  }),
});
```

- `parameters` は Zod スキーマで宣言する。これがそのままモデルへのツール定義（JSON Schema相当）に
  変換されるため、説明文（`description`）は曖昧さなく具体的に書く。モデルの呼び出し精度に直結する。
- 読み取り専用のツール（検索・参照）と、状態を変更するツール（後述のキャンセル等）を明確に区別する。

---

## 3. Human-in-the-Loop (承認フロー)

破壊的・不可逆な操作（決済、注文キャンセル、削除等）を行うツールには `needsApproval: true` を付ける。
これだけでエージェントはそのツールを実行する前に自動的に停止し、ユーザーの承認を待つ状態になる。

```typescript
tools: (tool) => ({
  cancelPurchase: tool({
    description: '注文をキャンセルする',
    parameters: z.object({ orderId: z.string(), reason: z.string() }),
    needsApproval: true, // ← これだけでHITLが有効になる
    handler: async ({ input }) => {
      // 承認された後にのみ実行される
      return cancelOrder(input.orderId, input.reason);
    },
  }),
}),
```

**設計判断の目安**: 「実行して後から取り消せない」「金銭・個人情報・外部通知が絡む」操作は
`needsApproval: true` にする。読み取り専用の検索・参照系ツールには付けない（体験が悪化するだけで
リスク低減にならない）。`review` モードでコードを見るときは、この基準に沿っているかを確認する。

**注意: `needsApproval: true` は「止める」だけで「誰が承認するか」までは決めない。**
Agent Block自身のHITL機能は、モデルがそのツールを呼ぼうとした時点で実行を自動停止する、という
ところまでしか面倒を見ない。要件が「（依頼者以外の）誰かの承認を経る」という場合、素朴な実装
（依頼者自身のチャット画面に承認ボタンを出すだけ）だと本人が自己承認できてしまう。承認を実行する
API関数（`resolveInterrupt`相当）側で、少なくとも次の2点をサーバー側で強制する。

- 承認者が権限を持つグループ・ロールに属しているか（例: Cognitoの承認者グループ）
- 承認者が依頼者本人ではないか（会話の作成者を記録しておき、比較する）

フロントエンドのUI上で承認ボタンを出し分けるだけでは不十分（表示を回避されれば通ってしまう）。
必ずバックエンドのハンドラ内でチェックする。

---

## 4. フロントエンドのuseChat

```typescript
import { useChat } from '@aws-blocks/bb-agent/client';
import { api } from 'aws-blocks';

function SupportChat() {
  const [interrupts, setInterrupts] = useState(null);

  const chat = useChat({
    api: {
      sendMessage: (convId, msg, chId) => api.sendMessage(convId, msg, chId),
      createConversation: () => api.createConversation(),
    },
    onInterrupt: (interrupts) => setInterrupts(interrupts), // HITL承認待ちの通知
  });

  const approve = async (interruptId: string) => {
    await chat.resolveInterrupt(interruptId, { approved: true });
    setInterrupts(null);
  };

  return (
    <div>
      {chat.messages.map((m) => <Message key={m.id} {...m} />)}
      {interrupts && <ApprovalDialog interrupts={interrupts} onApprove={approve} />}
      <ChatInput onSend={(text) => chat.sendMessage(text)} />
    </div>
  );
}
```

`onInterrupt` コールバックで承認待ちのツール呼び出し内容（ツール名・引数）を受け取り、
承認UIを表示する。ユーザーが承認/却下した結果を `resolveInterrupt` でエージェントに返す。

---

## 5. ローカル開発時の挙動と注意点

`npm run dev` では認証情報なしで動かすため、実際のBedrockモデルは呼ばれない。

- **KnowledgeBase**: TF-IDFベースの簡易全文検索でローカル再現される。実際のセマンティック検索とは
  精度特性が異なるため、検索結果の関連度をローカルテストだけで判断しない。
- **Agent**: canned（あらかじめ用意された固定パターンの）モデルプロバイダが応答する。実際のLLM推論を
  伴う開発・デバッグには Ollama をローカルに立てるか、AWS認証情報を設定して実際のBedrockを使う必要がある。

このため、Agent/KnowledgeBaseを使う機能の「本当の」品質確認（プロンプトの効き目、ツール選択の精度、
RAGの関連度）は `npm run sandbox` で実際のBedrockに接続した状態で行う。ローカル開発はUIフローや
HITLの承認フロー配線などの動作確認に留める。

---

## 6. モデル選択

`BedrockModels` から用途に応じたモデルを選ぶ（実際に利用可能な定数名は `@aws-blocks/blocks` の
型定義またはBedrockのモデルカタログで確認する。日々追加・更新されるため断定的に列挙しない）。
一般的な選び方の指針:

- レイテンシとコストを優先する対話UI → 軽量・高速なモデル
- ツール選択の精度やマルチターンの複雑な推論が必要 → よりバランスの取れた/高性能なモデル
- コストとレイテンシと精度の妥協点が知りたい → 標準的にはバランス型モデルから始めて、精度不足を感じたら
  上位モデルに切り替える

---

## 7. 会話永続化

`Agent` Block は会話履歴の永続化をBlock内部で扱う（DynamoDB等）。`createConversation` で
会話IDを発行し、以降の `sendMessage` はその会話IDに紐づけてメッセージを積み重ねる。
複数ユーザー・複数セッションを扱うアプリでは、会話IDとユーザーIDの紐付けをアプリ側の認可ロジックで
必ず検証する（他人の会話IDを推測して読まれないようにする）。

```typescript
export const api = new ApiNamespace(scope, 'api', (context) => ({
  async sendMessage(conversationId: string, message: string) {
    const user = await auth.getCurrentUser(context);
    await assertOwnsConversation(user.id, conversationId); // 認可チェックを忘れない
    return agent.sendMessage(conversationId, message);
  },
}));
```
