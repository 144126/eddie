import { json } from '@sveltejs/kit';
import * as vm from '$lib/server/vm-manager';
import * as store from '$lib/server/store';
import { streamMessage } from '$lib/server/vsock';

function log(step: string, msg: string) {
	console.log(`[CHAT-API] [${step}] ${msg} (${new Date().toISOString()})`);
}

export function GET({ params }) {
	log('GET', `params.id=${params.id}`);
	const v = vm.getVM(params.id);
	if (!v) {
		log('GET', 'VM not found');
		return json({ error: 'not found' }, { status: 404 });
	}
	const msgs = store.getMessages(params.id);
	log('GET', `returning ${msgs.length} messages`);
	return json(msgs);
}

export async function POST({ params, request }) {
	const body = await request.json();
	const { action } = body;
	log('POST', `action=${action} params.id=${params.id}`);

	const v = vm.getVM(params.id);
	if (!v) {
		log('POST', 'VM not found');
		return json({ error: 'not found' }, { status: 404 });
	}
	log('POST', `VM status=${v.status} vsockPath=${v.vsockPath}`);

	if (action === 'start') {
		log('POST', 'calling vm.startVM...');
		const result = await vm.startVM(params.id);
		log('POST', `startVM returned status=${result?.status}`);
		return json(result);
	}

	if (action === 'stop') {
		log('POST', 'calling vm.killVM...');
		const result = await vm.killVM(params.id);
		log('POST', `killVM returned ${result}`);
		return json(result);
	}

	if (action === 'chat') {
		const { message } = body;
		log('POST', `chat message="${(message || '').slice(0, 100)}"`);

		if (!message) {
			log('POST', 'chat failed: no message');
			return json({ error: 'message required' }, { status: 400 });
		}

		if (v.status !== 'running') {
			log('POST', `chat failed: VM status is ${v.status}, not running`);
			return json({ error: 'VM not running' }, { status: 400 });
		}

		const userMsg = {
			id: crypto.randomUUID(),
			role: 'user' as const,
			content: message,
			createdAt: new Date().toISOString(),
		};
		store.addMessage(params.id, userMsg);
		log('POST', `stored user message ${userMsg.id}`);

		const hist = store.getMessages(params.id);
		const msgs = hist.map((m) => ({ role: m.role, content: m.content }));
		log('POST', `history has ${msgs.length} messages`);

		let fullResponse = '';
		let hasError = false;

		const stream = new ReadableStream({
			async start(controller) {
				try {
					log('POST', 'calling streamMessage...');
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
					log('POST', `streamMessage completed, fullResponse length=${fullResponse.length}`);
					controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`));
				} catch (e: unknown) {
					hasError = true;
					const msg = e instanceof Error ? e.message : String(e);
					log('POST', `streamMessage FAILED: ${msg}`);
					controller.enqueue(
						new TextEncoder().encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
					);
				}
				controller.close();

				if (fullResponse && !hasError) {
					store.addMessage(params.id, {
						id: crypto.randomUUID(),
						role: 'assistant',
						content: fullResponse,
						createdAt: new Date().toISOString(),
					});
					log('POST', 'stored assistant response');
				}
			},
		});

		log('POST', 'returning SSE Response');
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	}

	log('POST', `unknown action: ${action}`);
	return json({ error: 'unknown action' }, { status: 400 });
}
