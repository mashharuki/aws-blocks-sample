/**
 * フロントエンド — src/index.ts
 *
 * リアルタイムTodoアプリ。@eventバインディングによる宣言的レンダリングにlit-htmlを使用。
 * `aws-blocks`（自動生成されるプロキシ）経由で型付きバックエンドAPIをimportする。
 */

import {
	AccountMenuBar,
	AuthenticatedContent,
	onAuthChange,
} from "@aws-blocks/blocks/ui";
import { api, authApi } from "aws-blocks";
import { html, render } from "lit-html";

// ─── 認証 ────────────────────────────────────────────────────────────────────
// サインインをクリックすると認証画面がポップアップするAccount Menuバーを表示する。
const menuBarEl = document.getElementById("menu-bar")!;
menuBarEl.appendChild(AccountMenuBar(authApi));

onAuthChange(authApi, (user) => {
	document.getElementById("signInMessage")!.style.display =
		user == null ? "" : "none";
});

// ─── アプリ本体（認証後に表示） ─────────────────────────────────────────
document.getElementById("app")!.appendChild(
	AuthenticatedContent(authApi, (user) => {
		const container = document.createElement("div");
		type Todo = {
			todoId: string;
			title: string;
			completed: boolean;
			priority: number;
		};
		let todos: Todo[] = [];
		let sortBy: "priority" | "title" | undefined;

		async function load() {
			todos = await api.listTodos(sortBy);
			redraw();
		}

		function redraw() {
			render(
				html`
        <h2>Todo</h2>
        <div style="margin-bottom:12px;display:flex;gap:4px;align-items:center;flex-wrap:wrap">
          <input id="new-todo" type="text" placeholder="やることを入力してください" style="flex:1;min-width:200px" @keydown=${(
						e: KeyboardEvent,
					) => {
						if (e.key === "Enter") addTodo();
					}} />
          <select id="new-priority">
            <option value="1">🔴 高</option>
            <option value="2" selected>🟡 中</option>
            <option value="3">🟢 低</option>
          </select>
          <button @click=${addTodo}>追加</button>
        </div>
        <div style="margin-bottom:12px;font-size:0.85em;color:#666">
          並び替え:
          <button @click=${() => setSort(undefined)} style="font-weight:${!sortBy ? "bold" : "normal"}">デフォルト</button>
          <button @click=${() => setSort("priority")} style="font-weight:${sortBy === "priority" ? "bold" : "normal"}">優先度</button>
          <button @click=${() => setSort("title")} style="font-weight:${sortBy === "title" ? "bold" : "normal"}">タイトル</button>
        </div>
        <ul>
          ${todos.map(
						(t) => html`
            <li style="margin:10px 0;display:flex;align-items:center;gap:8px;${t.completed ? "text-decoration:line-through;opacity:0.5" : ""}">
              <input type="checkbox" .checked=${t.completed} @change=${() => toggle(t.todoId)} />
              <span style="flex:1">${t.title}</span>
              <select .value=${String(t.priority)} @change=${(e: Event) => setPriority(t.todoId, parseInt((e.target as HTMLSelectElement).value))}>
                <option value="1">🔴 高</option>
                <option value="2">🟡 中</option>
                <option value="3">🟢 低</option>
              </select>
              <button @click=${() => remove(t.todoId)}>×</button>
            </li>
          `,
					)}
        </ul>
        <p style="color:#888;font-size:0.85em">残り${todos.filter((t) => !t.completed).length}件</p>
      `,
				container,
			);
		}

		async function addTodo() {
			const input = container.querySelector("#new-todo") as HTMLInputElement;
			const select = container.querySelector(
				"#new-priority",
			) as HTMLSelectElement;
			const title = input.value.trim();
			if (!title) return;
			await api.createTodo(title, parseInt(select.value));
			input.value = "";
			await load();
		}

		function setSort(s: "priority" | "title" | undefined) {
			sortBy = s;
			load();
		}

		async function toggle(todoId: string) {
			try {
				await api.toggleTodo(todoId);
			} catch {
				/* 競合 — 再読み込みするだけ */
			}
			await load();
		}

		async function setPriority(todoId: string, priority: number) {
			try {
				await api.updatePriority(todoId, priority);
			} catch {
				/* 競合 */
			}
			await load();
		}

		async function remove(todoId: string) {
			await api.deleteTodo(todoId);
			await load();
		}

		// リアルタイム: 他のタブ/ユーザーからの変更を購読する
		(async () => {
			try {
				const channel = await api.subscribeTodos();
				const sub = channel.subscribe(() => load());
				await sub.established;
			} catch {
				/* ローカル開発ではリアルタイムは利用できない */
			}
		})();

		load();
		return container;
	}),
);
