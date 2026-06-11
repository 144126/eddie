// Hermes agent process — runs inside Firecracker microVM
// Listens on vsock port 52, receives chat messages, calls LLM API, streams response back

import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';

const VSOCK_PORT = 52;
const NOUS_API_KEY = (readFileSync('/run/metadata/nous_api_key', 'utf-8') || '').trim();
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

let currentHistory = [];

const server = createServer((socket) => {
  let buf = '';
  let handshakeDone = false;

  socket.on('data', async (chunk) => {
    buf += chunk.toString();

    if (!handshakeDone) {
      if (buf.includes('\n')) {
        const line = buf.split('\n')[0].trim();
        buf = buf.slice(line.length + 1);
        if (line === `CONNECT ${VSOCK_PORT}`) {
          handshakeDone = true;
          socket.write('OK\n');
        } else {
          socket.write('ERR unknown protocol\n');
          socket.end();
        }
      }
      return;
    }

    // Parse message
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

        // Call OpenRouter with streaming
        const response = await fetch(OPENROUTER_URL, {
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
      socket.write(`ERR: ${e.message}\n__END__\n`);
    }
  });

  socket.on('error', () => {});
});

server.listen(VSOCK_PORT, () => {
  console.log(`[agent] Listening on vsock port ${VSOCK_PORT}`);
});
