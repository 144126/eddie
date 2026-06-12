<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { VM } from '$lib/types';

	interface Block {
		k: 'text' | 'code';
		c: string;
		l?: string;
	}

	interface Msg {
		i: string;
		r: 'user' | 'assistant';
		blocks: Block[];
	}

	let { params } = $props();
	let vm = $state<VM | null>(null);
	let msgs = $state<Msg[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let err = $state('');
	let msgContainer = $state<HTMLDivElement>();

	function flattenToText(m: Msg): string {
		return m.blocks.map((b) => b.c).join('');
	}

	function toBlocks(text: string): Block[] {
		const blocks: Block[] = [];
		const re = /```(\w+)?\n([\s\S]*?)```/g;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			if (m.index > last) blocks.push({ k: 'text', c: text.slice(last, m.index) });
			blocks.push({ k: 'code', l: m[1] || 'python', c: m[2] });
			last = m.index + m[0].length;
		}
		if (last < text.length) blocks.push({ k: 'text', c: text.slice(last) });
		return blocks;
	}

	onMount(async () => {
		const r = await fetch(`/api/vms/${params.id}`);
		if (r.ok) vm = await r.json();
		await loadMessages();
	});

	async function loadMessages() {
		const r = await fetch(`/api/vms/${params.id}/actions`);
		if (!r.ok) return;
		const raw = await r.json();
		msgs = raw.map((m: { i: string; r: 'user' | 'assistant'; c: string }) => ({
			i: m.i,
			r: m.r,
			blocks: toBlocks(m.c)
		}));
	}

	function scrollDown() {
		if (msgContainer) {
			requestAnimationFrame(() => {
				msgContainer!.scrollTop = msgContainer!.scrollHeight;
			});
		}
	}

	async function send() {
		const m = input.trim();
		if (!m || streaming) return;
		input = '';
		err = '';
		streaming = true;

		const userMsg: Msg = { i: crypto.randomUUID(), r: 'user', blocks: [{ k: 'text', c: m }] };
		msgs = [...msgs, userMsg];
		const assistantMsg: Msg = {
			i: crypto.randomUUID(),
			r: 'assistant',
			blocks: [{ k: 'text', c: '' }]
		};
		msgs = [...msgs, assistantMsg];
		scrollDown();

		try {
			const response = await fetch(`/api/vms/${params.id}/actions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'chat', message: m })
			});
			if (!response.ok) {
				const e = await response.json();
				throw new Error(e.e || 'Request failed');
			}

			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			let raw = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const lines = buf.split('\n');
				buf = lines.pop() || '';
				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const data = JSON.parse(line.slice(6));
					if (data.t === 'token') {
						raw += data.x;
						const last = msgs[msgs.length - 1];
						last.blocks = toBlocks(raw);
						msgs = msgs.slice();
						scrollDown();
					} else if (data.t === 'code_exec') {
						const last = msgs[msgs.length - 1];
						last.blocks = [
							...last.blocks,
							{ k: 'text', c: `\n[ran ${data.l}]\n` },
							{ k: 'code', l: data.l, c: data.c },
							{ k: 'text', c: `\n[output]\n${data.o}\n` }
						];
						raw = flattenToText(last);
						msgs = msgs.slice();
						scrollDown();
					} else if (data.t === 'error') {
						err = data.m;
						msgs = msgs.slice(0, -1);
					}
				}
			}
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e);
			err = m;
			msgs = msgs.slice(0, -1);
		}
		streaming = false;
		scrollDown();
	}
</script>

<div style="display: flex; flex-direction: column; height: 100vh;">
	<div
		style="display: flex; align-items: center; gap: var(--spacing-md); padding: var(--spacing-md) var(--spacing-xl); border-bottom: 1px solid var(--color-hairline); flex-shrink: 0;"
	>
		<button class="btn-outline btn-outline-sm" onclick={() => goto('/')}>← Back</button>
		<h2 style="font-size: var(--text-body-lg); margin: 0; flex: 1;">{vm?.n || 'Loading...'}</h2>
		<span class="eyebrow eyebrow-sm">{vm?.s || ''}</span>
	</div>

	{#if err}
		<div
			style="padding: var(--spacing-sm) var(--spacing-xl); background: var(--color-canvas-soft); color: var(--color-accent-sunset); font-size: var(--text-body-sm);"
		>
			{err}
			<button
				style="float: right; background: none; border: none; color: var(--color-body-mid); cursor: pointer;"
				onclick={() => (err = '')}
			>
				x
			</button>
		</div>
	{/if}

	<div
		bind:this={msgContainer}
		style="flex: 1; overflow-y: auto; padding: var(--spacing-xl); display: flex; flex-direction: column; gap: var(--spacing-lg);"
	>
		{#each msgs as msg (msg.i)}
			<div
				style="display: flex; {msg.r === 'user'
					? 'justify-content: flex-end;'
					: 'justify-content: flex-start;'}"
			>
				<div
					style="max-width: 70%; padding: var(--spacing-md) var(--spacing-lg); border-radius: var(--radius-sm); {msg.r ===
					'user'
						? 'background: var(--color-primary); color: var(--color-on-primary);'
						: 'background: var(--color-canvas-soft); color: var(--color-ink); border: 1px solid var(--color-hairline);'}"
				>
					{#each msg.blocks as b, i (i)}
						{#if b.k === 'text'}
							<p style="margin: 0; white-space: pre-wrap; word-break: break-word;">{b.c}</p>
						{:else}
							<pre
								style="margin: var(--spacing-sm) 0; padding: var(--spacing-md); background: var(--color-canvas); border: 1px solid var(--color-hairline); border-radius: var(--radius-sm); overflow-x: auto; font-size: var(--text-body-sm);"><code
									>{b.c}</code
								></pre>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<div
		style="flex-shrink: 0; padding: var(--spacing-md) var(--spacing-xl); border-top: 1px solid var(--color-hairline); display: flex; gap: var(--spacing-sm);"
	>
		<input
			class="input"
			placeholder="Type a message..."
			bind:value={input}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					send();
				}
			}}
			disabled={streaming}
		/>
		<button class="btn-primary" onclick={send} disabled={streaming || !input.trim()}> Send </button>
	</div>
</div>
