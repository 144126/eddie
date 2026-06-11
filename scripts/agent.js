// Hermes agent process — runs inside Firecracker microVM
// Listens on Unix socket, socat bridges AF_VSOCK port 52 → Unix socket

import { createServer } from 'node:net';
import { readFileSync, unlinkSync } from 'node:fs';

const NOUS_API_KEY = (readFileSync('/run/metadata/nous_api_key', 'utf-8') || '').trim();
const API_BASE = (readFileSync('/run/metadata/api_base_url', 'utf-8') || 'https://openrouter.ai/api/v1').trim();
const SOCKET_PATH = '/tmp/agent.sock';

let currentHistory = [];

try { unlinkSync(SOCKET_PATH); } catch {}

const server = createServer((socket) => {
  let buf = '';

  socket.on('data', async (chunk) => {
    buf += chunk.toString();

    // Try to parse complete message
    try {
      const msg = JSON.parse(buf.trim());
      buf = '';

      if (msg.type === 'reset') {
        currentHistory = [];
        socket.write('OK\n__END__\n');
        return;
      }

      if (msg.type === 'chat') {
        const { text, history } = msg;
        const messages = history || [];
        if (text) messages.push({ role: 'user', content: text });

        currentHistory = messages;

        const response = await fetch(`${API_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${NOUS_API_KEY}`,
            'HTTP-Referer': 'https://eddie.local',
          },
          body: JSON.stringify({
            model: msg.model || 'nvidia/nemotron-3-ultra-550b-a55b:free',
            messages,
            stream: true,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          socket.write(`ERROR: ${err}\n__END__\n`);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content || '';
              if (token) {
                fullText += token;
                socket.write(token);
              }
            } catch {}
          }
        }

        currentHistory.push({ role: 'assistant', content: fullText });
        socket.write('__END__\n');
        return;
      }

      socket.write(`ERR unknown message type: ${msg.type}\n__END__\n`);
    } catch (e) {
      if (e instanceof SyntaxError) return; // incomplete JSON, wait for more
      socket.write(`ERR: ${e.message}\n__END__\n`);
    }
  });

  socket.on('error', () => {});
});

server.listen(SOCKET_PATH, () => {
  console.log(`[agent] Listening on ${SOCKET_PATH}`);
});
