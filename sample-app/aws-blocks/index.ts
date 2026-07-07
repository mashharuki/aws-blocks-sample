/**
 * バックエンド — aws-blocks/index.ts
 *
 * ユーザーごとの分離、楽観的ロック、セカンダリインデックスを備えたリアルタイムTodoアプリ。
 * BlockとAPIの定義が一体になっている
 *
 * このファイルはAPI・認証・データモデル・リアルタイムチャンネルを定義する。
 * フロントエンドは `import { ... } from 'aws-blocks'` でこれらのexportを直接importする。
 *
 * ─── 重要 ───────────────────────────────────────────────────────────────
 * 永続化のためにローカルファイル・インメモリ配列・ローカルデータベースを使わないこと。
 * クラウドの永続化やその他の共通クラウド抽象化にはBuilding Blockを使う。
 * ローカルでは自動的にモックされ、設定不要でAWSへデプロイされる。
 *
 * Blockの一覧と使い方の全体は以下を参照:
 *   node_modules/@aws-blocks/blocks/README.md
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
	ApiNamespace,
	AuthBasic,
	DistributedTable,
	Realtime,
	Scope,
} from "@aws-blocks/blocks";
import { z } from "zod";

const scope = new Scope("my-app");

// ─── 認証 ────────────────────────────────────────────────────────────────────
const auth = new AuthBasic(scope, "auth", {
	passwordPolicy: { minLength: 8 },
	crossDomain: process.env.BLOCKS_SANDBOX === "true",
});
export const authApi = auth.createApi();

// ─── データ ────────────────────────────────────────────────────────────────────
// Zodスキーマ = ランタイム検証 + TypeScriptの型 + DynamoDBテーブル形状。
const todoSchema = z.object({
	userId: z.string(), // パーティションキー — ユーザーごとの分離
	todoId: z.string(), // ソートキー — ユーザー内で一意
	title: z.string(),
	completed: z.boolean(),
	priority: z.number(), // 1=高, 2=中, 3=低
	version: z.number(), // 楽観的ロック — 更新のたびにインクリメント
	createdAt: z.number(),
});

const todos = new DistributedTable(scope, "todos", {
	schema: todoSchema,
	key: { partitionKey: "userId", sortKey: "todoId" },
	indexes: {
		// セカンダリインデックス: 優先度またはタイトルでソートしてTodoを問い合わせる。
		// パーティションキーは常にuserId（ユーザーごとの分離）、ソートキーは異なる。
		byPriority: { partitionKey: "userId", sortKey: "priority" },
		byTitle: { partitionKey: "userId", sortKey: "title" },
	},
});

// ─── リアルタイム ────────────────────────────────────────────────────────────────
const rt = new Realtime(scope, "live", {
	namespaces: {
		todos: Realtime.namespace(
			z.object({
				action: z.enum(["created", "updated", "deleted"]),
				todoId: z.string(),
			}),
		),
	},
});

// ─── API ─────────────────────────────────────────────────────────────────────
export const api = new ApiNamespace(scope, "api", (context) => ({
	/**
	 * Todo一覧を取得する
	 * @returns 
	 */
	async subscribeTodos() {
		// 認証する
		const user = await auth.requireAuth(context);
		// Todo一覧を取得する
		return rt.getChannel("todos", user.username);
	},

	/**
	 * Todoを作成する
	 * @param title 
	 * @param priority 
	 * @returns 
	 */
	async createTodo(title: string, priority: number = 2) {
		const user = await auth.requireAuth(context);
		const todoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const todo = {
			userId: user.username,
			todoId,
			title,
			completed: false,
			priority,
			version: 1,
			createdAt: Date.now(),
		};
		// putする
		await todos.put(todo);

		// todoをデータベースに格納する
		await rt.publish("todos", user.username, {
			action: "created" as const,
			todoId,
		});
		return todo;
	},

	/** Todoを一覧表示する。セカンダリインデックスでソートすることもできる。 */
	async listTodos(sortBy?: "priority" | "title") {
		const user = await auth.requireAuth(context);
		if (sortBy) {
			const index = sortBy === "priority" ? "byPriority" : "byTitle";
			return await Array.fromAsync(
				todos.query({ index, where: { userId: { equals: user.username } } }),
			);
		}
		// デフォルト: todoId（作成順）でソート
		return await Array.fromAsync(
			todos.query({ where: { userId: { equals: user.username } } }),
		);
	},

	/**
	 * 楽観的ロックでTodoの完了状態を切り替える。
	 * `ifFieldEquals` を使って同時書き込みを検知する。競合時は
	 * ConditionalCheckFailedExceptionをスローする — 呼び出し側は再読み込みしてリトライすべき。
	 */
	async toggleTodo(todoId: string) {
		const user = await auth.requireAuth(context);
		const todo = await todos.get({ userId: user.username, todoId });
		if (!todo) throw new Error("Todo not found");
		await todos.put(
			{ ...todo, completed: !todo.completed, version: todo.version + 1 },
			{ ifFieldEquals: { version: todo.version } },
		);
		await rt.publish("todos", user.username, {
			action: "updated" as const,
			todoId,
		});
		return { success: true };
	},

	/**
	 * 楽観的ロックでTodoの優先度を更新するメソッド
	 */
	async updatePriority(todoId: string, priority: number) {
		const user = await auth.requireAuth(context);
		const todo = await todos.get({ userId: user.username, todoId });
		if (!todo) throw new Error("Todo not found");
		await todos.put(
			{ ...todo, priority, version: todo.version + 1 },
			{ ifFieldEquals: { version: todo.version } },
		);
		await rt.publish("todos", user.username, {
			action: "updated" as const,
			todoId,
		});
		return { success: true };
	},

	/**
	 * Todoを削除する。接続中の全クライアントに'deleted'をブロードキャストする。
	 */
	async deleteTodo(todoId: string) {
		const user = await auth.requireAuth(context);
		await todos.delete({ userId: user.username, todoId });
		await rt.publish("todos", user.username, {
			action: "deleted" as const,
			todoId,
		});
		return { success: true };
	},
}));
