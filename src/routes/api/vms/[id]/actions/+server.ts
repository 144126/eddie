import { json } from '@sveltejs/kit';
import * as sm from '$lib/server/sandbox-manager';
import * as store from '$lib/server/store';
import { chat } from '$lib/server/agent';
import type { LLMMessage } from '$lib/server/agent';

function log(step: string, msg: string) {
	console.log(`[CHAT-API] [${step}] ${msg} (${new Date().toISOString()})`);
}

export function GET({ params }) {
	return json(store.getMessages(params.id));
}

export async function POST({ params, request }) {
	const body = await request.json();
	const { action } = body;
	const v = sm.getVM(params.id);
	if (!v) return json({ e: 'not found' }, { status: 404 });

	if (action === 'start') {
		return json(await sm.startVM(params.id));
	}
	if (action === 'stop') {
		return json(await sm.killVM(params.id));
	}
	if (action === 'chat') {
		const { message } = body;
		if (!message) return json({ e: 'message required' }, { status: 400 });
		if (v.s !== 'running' || !v.b) {
			return json({ e: 'VM not running' }, { status: 400 });
		}

		const userMsg = {
			i: crypto.randomUUID(),
			r: 'user' as const,
			c: message,
			a: new Date().toISOString()
		};
		store.addMessage(params.id, userMsg);

		const hist = store.getMessages(params.id);
		const llmMsgs: LLMMessage[] = hist
			.filter((m) => m.r === 'user' || m.r === 'assistant')
			.map((m) => ({ role: m.r, content: m.c }) as LLMMessage);

		log('chat', `user_msg=${userMsg.i} history=${llmMsgs.length}`);

		let fullResponse = '';
		let hasError = false;

		const stream = new ReadableStream({
			async start(controller) {
				const enc = new TextEncoder();
				const send = (data: unknown) =>
					controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
				try {
					const sb = await sm.connectRunning(v.b!);
					fullResponse = await chat({
						msgs: llmMsgs,
						p: v.p,
						m: v.m,
						k: v.k,
						sb,
						emit: (e) => {
							if (e.t === 'token') {
								fullResponse += e.x;
								send({ t: 'token', x: e.x });
							} else if (e.t === 'code_exec') {
								send({ t: 'code_exec', l: e.l, c: e.c, o: e.o });
							} else if (e.t === 'error') {
								hasError = true;
								send({ t: 'error', m: e.m });
							}
						}
					});
					send({ t: 'done' });
				} catch (e) {
					hasError = true;
					const m = e instanceof Error ? e.message : String(e);
					send({ t: 'error', m });
				}
				controller.close();

				if (fullResponse && !hasError) {
					store.addMessage(params.id, {
						i: crypto.randomUUID(),
						r: 'assistant',
						c: fullResponse,
						a: new Date().toISOString()
					});
				}
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	}

	return json({ e: 'unknown action' }, { status: 400 });
}
