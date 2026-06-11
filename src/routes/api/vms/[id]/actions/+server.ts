import { json } from '@sveltejs/kit';
import * as vm from '$lib/server/vm-manager';
import * as store from '$lib/server/store';
import { streamMessage } from '$lib/server/vsock';

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
		const result = await vm.killVM(params.id);
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

		const hist = store.getMessages(params.id);
		const msgs = hist.map((m) => ({ role: m.role, content: m.content }));

		let fullResponse = '';

		const stream = new ReadableStream({
			async start(controller) {
				try {
					await streamMessage(
						v.vsockPath,
						{
							type: 'chat',
							text: message,
							history: msgs.slice(0, -1),
							model: v.model,
						},
						(token: string) => {
							fullResponse += token;
							controller.enqueue(
								new TextEncoder().encode(`data: ${JSON.stringify({ token })}\n\n`),
							);
						},
					);

					controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`));
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					controller.enqueue(
						new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
					);
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
