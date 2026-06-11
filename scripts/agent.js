// Hermes agent process — runs inside Firecracker microVM
// Listens on Unix socket, socat bridges AF_VSOCK port 52 → Unix socket

import { createServer } from 'node:net';
import { readFileSync, unlinkSync } from 'node:fs';

function log(step: string, msg: string) {
	console.log(`[VSOCK-GUEST] [${step}] ${msg} (${new Date().toISOString()})`);
}

log('init', 'agent starting up');

let NOUS_API_KEY = '';
let API_BASE = 'https://openrouter.ai/api/v1';

try {
	NOUS_API_KEY = (readFileSync('/run/metadata/nous_api_key', 'utf-8') || '').trim();
	log('init', `read nous_api_key from /run/metadata/nous_api_key, length=${NOUS_API_KEY.length}`);
} catch (e) {
	log('init', `FAILED to read /run/metadata/nous_api_key: ${e.message}`);
}

try {
	API_BASE = (readFileSync('/run/metadata/api_base_url', 'utf-8') || API_BASE).trim();
	log('init', `api_base_url = ${API_BASE}`);
} catch (e) {
	log('init', `FAILED to read /run/metadata/api_base_url: ${e.message}, using default: ${API_BASE}`);
}

const SOCKET_PATH = '/tmp/agent.sock';
let currentHistory = [];

try {
	unlinkSync(SOCKET_PATH);
	log('init', `cleaned up stale socket at ${SOCKET_PATH}`);
} catch {
	log('init', `no stale socket to clean at ${SOCKET_PATH}`);
}

const server = createServer((socket) => {
	let buf = '';
	log('server', 'new connection accepted from socat');

	socket.on('data', async (chunk) => {
		const raw = chunk.toString();
		log('server', `received raw data (${raw.length} bytes): ${JSON.stringify(raw.slice(0, 300))}`);

		buf += raw;

		// Try to parse complete message
		try {
			const msg = JSON.parse(buf.trim());
			buf = '';
			log('server', `JSON parsed successfully: type=${msg.type}, keys=${Object.keys(msg).join(',')}`);

			if (msg.type === 'reset') {
				log('server', 'handling reset message');
				currentHistory = [];
				socket.write('OK\n__END__\n');
				log('server', 'wrote OK\n__END__\n for reset');
				return;
			}

			if (msg.type === 'chat') {
				const { text, history, model } = msg;
				const messages = history || [];
				if (text) messages.push({ role: 'user', content: text });

				currentHistory = messages;
				log('server', `chat message: text="${(text || '').slice(0, 100)}", history_len=${(history || []).length}, model=${model}`);

				const url = `${API_BASE}/chat/completions`;
				const payload = {
					model: model || 'nvidia/nemotron-3-ultra-550b-a55b:free',
					messages,
					stream: true,
				};
				log('server', `calling LLM API: POST ${url}`);
				log('server', `request payload: ${JSON.stringify(payload).slice(0, 300)}`);
				log('server', `auth header: Bearer ${NOUS_API_KEY.slice(0, 8)}...`);

				let response;
				try {
					response = await fetch(url, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': `Bearer ${NOUS_API_KEY}`,
							'HTTP-Referer': 'https://eddie.local',
						},
						body: JSON.stringify(payload),
					});
				} catch (fetchErr) {
					log('server', `FETCH FAILED: ${fetchErr.message}`);
					socket.write(`ERROR: fetch failed — ${fetchErr.message}\n__END__\n`);
					return;
				}

				log('server', `LLM API response status=${response.status} ${response.statusText}`);

				if (!response.ok) {
					let err;
					try { err = await response.text(); } catch { err = 'unknown error'; }
					log('server', `LLM API error (${response.status}): ${err.slice(0, 300)}`);
					socket.write(`ERROR: ${err}\n__END__\n`);
					return;
				}

				log('server', 'LLM API returned 200 OK, reading streaming response body');

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let fullText = '';
				let tokenCount = 0;

				while (true) {
					let result;
					try {
						result = await reader.read();
					} catch (readErr) {
						log('server', `stream read error: ${readErr.message}`);
						break;
					}

					const { done, value } = result;
					if (done) {
						log('server', `stream read complete, total tokens=${tokenCount}, fullText length=${fullText.length}`);
						break;
					}

					const text = decoder.decode(value, { stream: true });
					log('server', `stream chunk (${value.length} bytes): ${JSON.stringify(text.slice(0, 200))}`);

					const lines = text.split('\n');
					for (const line of lines) {
						if (!line.startsWith('data: ')) continue;
						const data = line.slice(6).trim();
						if (data === '[DONE]') {
							log('server', 'received [DONE] signal from API');
							continue;
						}
						try {
							const parsed = JSON.parse(data);
							const token = parsed.choices?.[0]?.delta?.content || '';
							if (token) {
								tokenCount++;
								fullText += token;
								log('server', `token #${tokenCount}: ${JSON.stringify(token)}`);
								socket.write(token);
							}
						} catch (parseErr) {
							log('server', `failed to parse SSE line: ${JSON.stringify(data)}`);
						}
					}
				}

				currentHistory.push({ role: 'assistant', content: fullText });
				log('server', `writing __END__ marker (total tokens=${tokenCount}, chars=${fullText.length})`);
				socket.write('__END__\n');
				return;
			}

			log('server', `unknown message type: ${msg.type}`);
			socket.write(`ERR unknown message type: ${msg.type}\n__END__\n`);
		} catch (e) {
			if (e instanceof SyntaxError) {
				log('server', `incomplete JSON in buffer (${buf.length} bytes), waiting for more data`);
				return;
			}
			log('server', `error processing message: ${e.message}`);
			socket.write(`ERR: ${e.message}\n__END__\n`);
		}
	});

	socket.on('error', (err) => {
		log('server', `socket error: ${err.message}`);
	});

	socket.on('close', () => {
		log('server', 'connection closed');
	});
});

server.listen(SOCKET_PATH, () => {
	log('server', `LISTENING on ${SOCKET_PATH}`);
});

server.on('error', (err) => {
	log('server', `server error: ${err.message}`);
});
