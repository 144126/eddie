import Docker from 'dockerode';
import * as store from './store';
import type { VM } from '$lib/types';

const docker = new Docker();
const IMAGE = 'eddie-hermes';
const PORT_START = 8642;

function genId(): string {
	return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export async function ensureImage(): Promise<boolean> {
	try {
		await docker.getImage(IMAGE).inspect();
		return true;
	} catch {
		return false;
	}
}

export function listVMs(): VM[] {
	const vms = store.getVMs();
	for (const vm of vms) {
		if (vm.status === 'running') {
			try {
				const c = docker.getContainer(vm.containerId);
				c.inspect().catch(() => {
					vm.status = 'stopped';
					store.putVM(vm);
				});
			} catch {
				vm.status = 'stopped';
				store.putVM(vm);
			}
		}
	}
	return store.getVMs();
}

export function getVM(id: string): VM | undefined {
	return store.getVM(id);
}

export async function createVM(name: string, provider: string, model: string, apiKey: string): Promise<VM> {
	const existing = store.getVMs();
	const usedPorts = new Set(existing.map((v) => v.port));
	let port = PORT_START;
	while (usedPorts.has(port)) port++;

	const id = genId();
	const vm: VM = {
		id,
		name,
		status: 'creating',
		port,
		containerId: '',
		provider,
		model,
		apiKey,
		createdAt: new Date().toISOString(),
	};
	store.putVM(vm);

	try {
		const container = await docker.createContainer({
			Image: IMAGE,
			name: `eddie-vm-${id}`,
			Env: [
				`HERMES_PROVIDER=${provider}`,
				`HERMES_MODEL=${model}`,
				`HERMES_API_KEY=${apiKey}`,
				`API_SERVER_KEY=eddie-${id}`,
			],
			HostConfig: {
				PortBindings: { '8642/tcp': [{ HostPort: String(port) }] },
				AutoRemove: true,
			},
			ExposedPorts: { '8642/tcp': {} },
		});
		await container.start();
		const info = await container.inspect();
		vm.containerId = info.Id;
		vm.status = 'running';
	} catch {
		vm.status = 'error';
	}
	store.putVM(vm);
	return vm;
}

export async function startVM(id: string): Promise<VM | null> {
	const vm = store.getVM(id);
	if (!vm) return null;
	if (vm.status === 'running') return vm;

	try {
		const container = await docker.createContainer({
			Image: IMAGE,
			name: `eddie-vm-${id}`,
			Env: [
				`HERMES_PROVIDER=${vm.provider}`,
				`HERMES_MODEL=${vm.model}`,
				`HERMES_API_KEY=${vm.apiKey}`,
				`API_SERVER_KEY=eddie-${id}`,
			],
			HostConfig: {
				PortBindings: { '8642/tcp': [{ HostPort: String(vm.port) }] },
				AutoRemove: true,
			},
			ExposedPorts: { '8642/tcp': {} },
		});
		await container.start();
		const info = await container.inspect();
		vm.containerId = info.Id;
		vm.status = 'running';
		store.putVM(vm);
	} catch {
		vm.status = 'error';
		store.putVM(vm);
	}
	return vm;
}

export async function stopVM(id: string): Promise<VM | null> {
	const vm = store.getVM(id);
	if (!vm) return null;
	if (vm.status !== 'running') return vm;

	try {
		const container = docker.getContainer(vm.containerId);
		await container.stop();
		vm.status = 'stopped';
		vm.containerId = '';
	} catch {
		vm.status = 'error';
	}
	store.putVM(vm);
	return vm;
}

export async function deleteVM(id: string): Promise<boolean> {
	const vm = store.getVM(id);
	if (!vm) return false;
	if (vm.status === 'running') {
		try {
			const container = docker.getContainer(vm.containerId);
			await container.stop();
		} catch {}
	}
	store.removeVM(id);
	return true;
}

export function getChatUrl(vm: VM): string {
	return `http://127.0.0.1:${vm.port}`;
}
