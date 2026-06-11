import { killAllVMs } from '$lib/server/vm-manager';

process.on('SIGTERM', async () => {
	await killAllVMs();
	process.exit(0);
});

process.on('SIGINT', async () => {
	await killAllVMs();
	process.exit(0);
});

export {};
