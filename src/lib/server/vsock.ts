import net from 'node:net';
import { existsSync } from 'node:fs';

const VSOCK_PORT = 52;
const TIMEOUT = 60000;

export type VsockStreamCb = (token: string) => void;

function log(step: string, msg: string) {
	console.log(`[VSOCK-HOST] [${step}] ${msg} (${new Date().toISOString()})`);
}

function createConnection(vsockPath: string): Promise<net.Socket> {
	log('createConnection', `called with vsockPath=${vsockPath}`);

	if (!existsSync(vsockPath)) {
		log('createConnection', `FAIL: socket file does not exist at ${vsockPath}`);
		return Promise.reject(new Error(`VM not running — vsock socket not found at ${vsockPath}`));
	}
	log('createConnection', `socket file exists at ${vsockPath}, proceeding to connect`);

	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ path: vsockPath }, () => {
			log('createConnection', `connected to ${vsockPath}, sending 'CONNECT ${VSOCK_PORT}\\n'`);
			socket.write(`CONNECT ${VSOCK_PORT}\n`);
		});

		const timer = setTimeout(() => {
			log('createConnection', `TIMEOUT after ${TIMEOUT}ms waiting for handshake 'OK' from guest`);
			socket.destroy();
			reject(new Error('Vsock connection timeout'));
		}, TIMEOUT);

		socket.once('data', (chunk) => {
			const str = chunk.toString();
			log('createConnection', `received raw data from guest: ${JSON.stringify(str)}`);

			if (!str.startsWith('OK')) {
				clearTimeout(timer);
				log('createConnection', `FAIL: handshake did not start with 'OK', got: ${str.trim()}`);
				socket.destroy();
				reject(new Error(`Vsock handshake failed: ${str.trim()}`));
				return;
			}
			clearTimeout(timer);
			log('createConnection', `handshake OK received, connection established to guest vsock port ${VSOCK_PORT}`);
			resolve(socket);
		});

		socket.on('error', (err) => {
			clearTimeout(timer);
			log('createConnection', `socket error: ${err.message} (code=${(err as NodeJS.ErrnoException).code})`);
			reject(err);
		});
	});
}

export async function sendMessage(
	vsockPath: string,
	message: Record<string, unknown>
): Promise<string> {
	log('sendMessage', `starting, vsockPath=${vsockPath}`);
	log('sendMessage', `message type=${message.type}, model=${message.model}`);

	const socket = await createConnection(vsockPath);
	log('sendMessage', 'createConnection succeeded, writing JSON message');

	return new Promise((resolve, reject) => {
		const chunks: string[] = [];
		let totalBytes = 0;

		let timer = setTimeout(() => {
			log('sendMessage', `TIMEOUT after ${TIMEOUT}ms — received ${totalBytes} bytes so far`);
			socket.destroy();
			reject(new Error('Vsock message timeout'));
		}, TIMEOUT);

		socket.on('data', (chunk) => {
			const str = chunk.toString();
			totalBytes += str.length;
			chunks.push(str);
			log('sendMessage', `received data chunk (${str.length} bytes, total=${totalBytes}): ${JSON.stringify(str.slice(0, 200))}`);

			if (str.includes('__END__')) {
				clearTimeout(timer);
				log('sendMessage', `found __END__ marker, response complete (${totalBytes} total bytes)`);
				socket.end();
				resolve(chunks.join('').replace('__END__', '').trim());
			}
		});

		socket.on('error', (err) => {
			clearTimeout(timer);
			log('sendMessage', `socket error: ${err.message} (code=${(err as NodeJS.ErrnoException).code})`);
			reject(err);
		});

		const msg = JSON.stringify(message);
		log('sendMessage', `writing message payload (${msg.length} bytes): ${JSON.stringify(msg.slice(0, 150))}`);
		socket.write(msg + '\n');
	});
}

export async function streamMessage(
	vsockPath: string,
	message: Record<string, unknown>,
	onToken: VsockStreamCb
): Promise<string> {
	log('streamMessage', `starting, vsockPath=${vsockPath}`);
	log('streamMessage', `message type=${message.type}, model=${message.model}`);

	const socket = await createConnection(vsockPath);
	log('streamMessage', 'createConnection succeeded, writing JSON message');

	return new Promise((resolve, reject) => {
		const chunks: string[] = [];
		let totalBytes = 0;

		let timer = setTimeout(() => {
			log('streamMessage', `TIMEOUT after ${TIMEOUT}ms — received ${totalBytes} bytes so far`);
			socket.destroy();
			reject(new Error('Vsock stream timeout'));
		}, TIMEOUT);

		socket.on('data', (chunk) => {
			const str = chunk.toString();
			totalBytes += str.length;
			log('streamMessage', `received data chunk (${str.length} bytes, total=${totalBytes}): ${JSON.stringify(str.slice(0, 200))}`);

			if (str.includes('__END__')) {
				clearTimeout(timer);
				const final = str.replace('__END__', '');
				if (final) {
					chunks.push(final);
					onToken(final);
				}
				log('streamMessage', `found __END__ marker, stream complete (${totalBytes} total bytes)`);
				socket.end();
				resolve(chunks.join(''));
				return;
			}
			chunks.push(str);
			onToken(str);
		});

		socket.on('error', (err) => {
			clearTimeout(timer);
			log('streamMessage', `socket error: ${err.message} (code=${(err as NodeJS.ErrnoException).code})`);
			reject(err);
		});

		const msg = JSON.stringify(message);
		log('streamMessage', `writing message payload (${msg.length} bytes): ${JSON.stringify(msg.slice(0, 150))}`);
		socket.write(msg + '\n');
	});
}
