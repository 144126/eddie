import { json } from '@sveltejs/kit';
import * as vm from '$lib/server/vm-manager';
import * as store from '$lib/server/store';

export function GET({ params }) {
	const v = vm.getVM(params.id);
	if (!v) return json({ error: 'not found' }, { status: 404 });
	return json(store.getMessages(params.id));
}

export async function POST({ params, request }) {
	const body = await request.json();
	const { action } = body;
	const v = vm.getVM(params.id);
	if (!v) return json({ error: 'not found' }, { status: 404 });

	if (action === 'start') {
		const result = await vm.startVM(params.id);
		return json(result);
	}

	if (action === 'stop') {
		const result = await vm.stopVM(params.id);
		return json(result);
	}

	if (action === 'chat') {
		const { message } = body;
		if (!message) return json({ error: 'message required' }, { status: 400 });

		if (v.status !== 'running') {
			return json({ error: 'VM not running' }, { status: 400 });
		}

		const userMsg = {
			id: crypto.randomUUID(),
			role: 'user' as const,
			content: message,
			createdAt: new Date().toISOString(),
		};
		store.addMessage(params.id, userMsg);

		const baseUrl = vm.getChatUrl(v);
		const hist = store.getMessages(params.id);
		const msgs = hist.map((m) => ({ role: m.role, content: m.content }));

		let fullResponse = '';

		const stream = new ReadableStream({
			async start(controller) {
				try {
					const res = await fetch(`${baseUrl}/v1/chat/completions`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer eddie-${params.id}`,
						},
						body: JSON.stringify({
							model: 'hermes-agent',
							messages: msgs,
							stream: true,
						}),
					});

					if (!res.ok) {
						const errText = await res.text();
						controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: errText })}\n\n`));
						controller.close();
						return;
					}

					const reader = res.body?.getReader();
					if (!reader) throw new Error('no response body');

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
							const data = line.slice(6).trim();
							if (data === '[DONE]') continue;
							try {
								const parsed = JSON.parse(data);
								const content = parsed.choices?.[0]?.delta?.content || '';
								if (content) {
									fullResponse += content;
									controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ token: content })}\n\n`));
								}
							} catch {}
						}
					}

					controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`));
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
				}
				controller.close();

				if (fullResponse) {
					store.addMessage(params.id, {
						id: crypto.randomUUID(),
						role: 'assistant',
						content: fullResponse,
						createdAt: new Date().toISOString(),
					});
				}
			},
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	}

	return json({ error: 'unknown action' }, { status: 400 });
}
