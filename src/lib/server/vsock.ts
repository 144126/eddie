import net from 'node:net';
import { existsSync } from 'node:fs';

const VSOCK_PORT = 52;
const TIMEOUT = 60000;

export type VsockStreamCb = (token: string) => void;

function createConnection(vsockPath: string): Promise<net.Socket> {
	if (!existsSync(vsockPath)) {
		return Promise.reject(new Error(`VM not running — vsock socket not found at ${vsockPath}`));
	}
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ path: vsockPath }, () => {
			socket.write(`CONNECT ${VSOCK_PORT}\n`);
		});

		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error('Vsock connection timeout'));
		}, TIMEOUT);

		socket.once('data', (chunk) => {
			const str = chunk.toString();
			if (!str.startsWith('OK')) {
				clearTimeout(timer);
				socket.destroy();
				reject(new Error(`Vsock handshake failed: ${str.trim()}`));
				return;
			}
			clearTimeout(timer);
			resolve(socket);
		});

		socket.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

export async function sendMessage(
	vsockPath: string,
	message: Record<string, unknown>
): Promise<string> {
	const socket = await createConnection(vsockPath);

	return new Promise((resolve, reject) => {
		const chunks: string[] = [];
		let timer = setTimeout(() => {
			socket.destroy();
			reject(new Error('Vsock message timeout'));
		}, TIMEOUT);

		socket.on('data', (chunk) => {
			const str = chunk.toString();
			chunks.push(str);
			if (str.includes('__END__')) {
				clearTimeout(timer);
				socket.end();
				resolve(chunks.join('').replace('__END__', '').trim());
			}
		});

		socket.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});

		socket.write(JSON.stringify(message) + '\n');
	});
}

export async function streamMessage(
	vsockPath: string,
	message: Record<string, unknown>,
	onToken: VsockStreamCb
): Promise<string> {
	const socket = await createConnection(vsockPath);

	return new Promise((resolve, reject) => {
		const chunks: string[] = [];
		let timer = setTimeout(() => {
			socket.destroy();
			reject(new Error('Vsock stream timeout'));
		}, TIMEOUT);

		socket.on('data', (chunk) => {
			const str = chunk.toString();
			if (str.includes('__END__')) {
				clearTimeout(timer);
				const final = str.replace('__END__', '');
				if (final) {
					chunks.push(final);
					onToken(final);
				}
				socket.end();
				resolve(chunks.join(''));
				return;
			}
			chunks.push(str);
			onToken(str);
		});

		socket.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});

		socket.write(JSON.stringify(message) + '\n');
	});
}
