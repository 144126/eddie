<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { VM, Message } from '$lib/types';

	let { params } = $props();

	let vm = $state<VM | null>(null);
	let messages = $state<Message[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let error = $state('');
	let msgContainer = $state<HTMLDivElement>();

	onMount(async () => {
		const r = await fetch(`/api/vms/${params.id}`);
		if (r.ok) vm = await r.json();
		await loadMessages();
	});

	async function loadMessages() {
		const r = await fetch(`/api/vms/${params.id}/actions`);
		if (r.ok) messages = await r.json();
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
		error = '';
		streaming = true;

		const userMsg: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content: m,
			createdAt: new Date().toISOString(),
		};
		messages = [...messages, userMsg];
		scrollDown();

		const assistantMsg: Message = {
			id: '',
			role: 'assistant',
			content: '',
			createdAt: '',
		};
		messages = [...messages, assistantMsg];

		try {
			const response = await fetch(`/api/vms/${params.id}/actions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'chat', message: m }),
			});

			if (!response.ok) {
				const e = await response.json();
				throw new Error(e.error || 'Request failed');
			}

			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buf = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const lines = buf.split('\n');
				buf = lines.pop() || '';
				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const data = JSON.parse(line.slice(6));
					if (data.token) {
						messages[messages.length - 1].content += data.token;
						messages = messages.slice();
						scrollDown();
					} else if (data.error) {
						error = data.error;
						messages = messages.slice(0, -1);
					} else if (data.done) {
						// streaming complete, server already saved it
					}
				}
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			error = msg;
			messages = messages.slice(0, -1);
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
		<h2 style="font-size: var(--text-body-lg); margin: 0; flex: 1;">{vm?.name || 'Loading...'}</h2>
		<span class="eyebrow eyebrow-sm">{vm?.status || ''}</span>
	</div>

	{#if error}
		<div
			style="padding: var(--spacing-sm) var(--spacing-xl); background: var(--color-canvas-soft); color: var(--color-accent-sunset); font-size: var(--text-body-sm);"
		>
			{error}
			<button
				style="float: right; background: none; border: none; color: var(--color-body-mid); cursor: pointer;"
				onclick={() => (error = '')}
			>
				x
			</button>
		</div>
	{/if}

	<div
		bind:this={msgContainer}
		style="flex: 1; overflow-y: auto; padding: var(--spacing-xl); display: flex; flex-direction: column; gap: var(--spacing-lg);"
	>
		{#each messages as msg}
			<div
				style="display: flex; {msg.role === 'user' ? 'justify-content: flex-end;' : 'justify-content: flex-start;'}"
			>
				<div
					style="max-width: 70%; padding: var(--spacing-md) var(--spacing-lg); border-radius: var(--radius-sm); {msg.role === 'user'
						? 'background: var(--color-primary); color: var(--color-on-primary);'
						: 'background: var(--color-canvas-soft); color: var(--color-ink); border: 1px solid var(--color-hairline);'}"
				>
					<p style="margin: 0; white-space: pre-wrap; word-break: break-word;">
						{msg.content || (msg.role === 'assistant' ? '...' : '')}
					</p>
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
			onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
			disabled={streaming}
		/>
		<button class="btn-primary" onclick={send} disabled={streaming || !input.trim()}>
			Send
		</button>
	</div>
</div>
