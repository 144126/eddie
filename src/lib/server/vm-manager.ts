import { spawn, execSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import * as store from './store';
import type { VM } from '$lib/types';

const FC_BINARY = '/usr/local/bin/firecracker';
const KERNEL_PATH = path.resolve('assets/vmlinux');
const ROOTFS_BASE = path.resolve('assets/rootfs.ext4');
const VM_IP_BASE = '172.20.0';
const VCPU = 1;
const MEM_MB = 256;

interface ActiveVM {
	process: ChildProcess;
	tapDevice: string;
}

const activeVMs = new Map<string, ActiveVM>();
let ipCounter = 2;

function nextIP(): string {
	const ip = `${VM_IP_BASE}.${ipCounter}`;
	ipCounter = (ipCounter % 253) + 2;
	return ip;
}

function genId(): string {
	return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function fcAPI(socketPath: string, method: string, apiPath: string, body?: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const bodyStr = body ? JSON.stringify(body) : undefined;
		const req = http.request(
			{
				socketPath,
				path: apiPath.startsWith('/') ? apiPath : `/${apiPath}`,
				method,
				headers: bodyStr
					? {
							'Content-Type': 'application/json',
							'Content-Length': Buffer.byteLength(bodyStr),
						}
					: {},
			},
			(res) => {
				let data = '';
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => {
					if (res.statusCode! >= 200 && res.statusCode! < 300) {
						resolve(data ? JSON.parse(data) : null);
					} else {
						reject(new Error(`FC ${method} ${apiPath}: ${res.statusCode} ${data}`));
					}
				});
			},
		);
		req.on('error', reject);
		if (bodyStr) req.write(bodyStr);
		req.end();
	});
}

function waitForSocket(socketPath: string, timeoutMs = 5000): Promise<void> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const poll = () => {
			if (existsSync(socketPath)) return resolve();
			if (Date.now() > deadline) return reject(new Error(`Socket never appeared: ${socketPath}`));
			setTimeout(poll, 50);
		};
		poll();
	});
}

function setupTAP(vmId: string): string {
	const tap = `tap-${vmId.slice(0, 8)}`;
	execSync(`sudo ip tuntap add dev ${tap} mode tap`);
	execSync(`sudo ip link set ${tap} master fc-br0`);
	execSync(`sudo ip link set ${tap} up`);
	return tap;
}

function teardownTAP(tapDevice: string) {
	try {
		execSync(`sudo ip link del ${tapDevice}`);
	} catch {}
}

function genMAC(vmId: string): string {
	const hex = vmId.replace(/-/g, '').slice(0, 10).padEnd(10, '0');
	return `02:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:${hex.slice(8, 10)}`;
}

export function ensureHost(): string[] {
	const issues: string[] = [];
	if (!existsSync(FC_BINARY)) issues.push(`Firecracker binary not found at ${FC_BINARY}`);
	if (!existsSync(KERNEL_PATH)) issues.push(`Kernel not found at ${KERNEL_PATH}`);
	if (!existsSync(ROOTFS_BASE)) issues.push(`Rootfs not found at ${ROOTFS_BASE}`);
	return issues;
}

export function listVMs(): VM[] {
	return store.getVMs();
}

export function getVM(id: string): VM | undefined {
	return store.getVM(id);
}

export async function createVM(
	name: string,
	provider: string,
	model: string,
	apiKey: string,
): Promise<VM> {
	const id = genId();
	const vmIP = nextIP();
	const socketPath = `/tmp/fc-${id}.sock`;
	const vsockPath = `/tmp/fc-${id}-vsock.sock`;
	const tapDevice = setupTAP(id);

	const vm: VM = {
		id,
		name,
		status: 'creating',
		ip: vmIP,
		socketPath,
		vsockPath,
		tapDevice,
		provider,
		model,
		apiKey,
		createdAt: new Date().toISOString(),
	};
	store.putVM(vm);

	// Clone rootfs
	const rootfsPath = `/tmp/fc-${id}-rootfs.ext4`;
	try {
		execSync(`cp --reflink=auto ${ROOTFS_BASE} ${rootfsPath} 2>/dev/null || cp ${ROOTFS_BASE} ${rootfsPath}`);
	} catch (e) {
		console.error(`[vm ${id}] rootfs copy failed:`, e instanceof Error ? e.message : e);
		vm.status = 'error';
		store.putVM(vm);
		return vm;
	}

	const fcProcess = spawn(FC_BINARY, [
		'--api-sock', socketPath,
	], {
		stdio: 'ignore',
	});

	activeVMs.set(id, { process: fcProcess, tapDevice });

	fcProcess.on('exit', () => {
		activeVMs.delete(id);
		try { unlinkSync(socketPath); } catch {}
		try { unlinkSync(vsockPath); } catch {}
		teardownTAP(tapDevice);
		const v = store.getVM(id);
		if (v && v.status === 'running') {
			v.status = 'stopped';
			store.putVM(v);
		}
	});

	try {
		await waitForSocket(socketPath);

		await fcAPI(socketPath, 'PUT', '/machine-config', {
			vcpu_count: VCPU,
			mem_size_mib: MEM_MB,
		});

		await fcAPI(socketPath, 'PUT', '/boot-source', {
			kernel_image_path: KERNEL_PATH,
			boot_args: `console=ttyS0 reboot=k panic=1 pci=off ip=${vmIP}::172.20.0.1:255.255.255.0`,
		});

		await fcAPI(socketPath, 'PUT', '/drives/rootfs', {
			drive_id: 'rootfs',
			path_on_host: rootfsPath,
			is_root_device: true,
			is_read_only: false,
		});

		await fcAPI(socketPath, 'PUT', '/network-interfaces/eth0', {
			iface_id: 'eth0',
			guest_mac: genMAC(id),
			host_dev_name: tapDevice,
		});

		await fcAPI(socketPath, 'PUT', '/vsock', {
			guest_cid: 3,
			uds_path: vsockPath,
		});

		await fcAPI(socketPath, 'PUT', '/mmds/config', {
			network_interfaces: ['eth0'],
		});
		await fcAPI(socketPath, 'PUT', '/mmds', {
			nous_api_key: apiKey,
		});

		await fcAPI(socketPath, 'PUT', '/actions', {
			action_type: 'InstanceStart',
		});

		vm.status = 'running';
	} catch (e) {
		console.error(`[vm ${id}] create failed:`, e instanceof Error ? e.message : e);
		fcProcess.kill();
		teardownTAP(tapDevice);
		vm.status = 'error';
		try { unlinkSync(rootfsPath); } catch {}
	}

	store.putVM(vm);
	return vm;
}

export async function startVM(id: string): Promise<VM | null> {
	const existing = store.getVM(id);
	if (!existing) return null;
	if (existing.status === 'running') return existing;

	const vmIP = nextIP();
	const socketPath = `/tmp/fc-${id}.sock`;
	const vsockPath = `/tmp/fc-${id}-vsock.sock`;

	// Clean stale state from prior failed attempts
	try { unlinkSync(socketPath); } catch {}
	try { unlinkSync(vsockPath); } catch {}
	teardownTAP(`tap-${id.slice(0, 8)}`);

	const tapDevice = setupTAP(id);

	const vm: VM = { ...existing, ip: vmIP, socketPath, vsockPath, tapDevice, status: 'creating' };
	store.putVM(vm);

	const rootfsPath = `/tmp/fc-${id}-rootfs.ext4`;
	try {
		execSync(`cp --reflink=auto ${ROOTFS_BASE} ${rootfsPath} 2>/dev/null || cp ${ROOTFS_BASE} ${rootfsPath}`);
	} catch (e) {
		console.error(`[vm ${id}] rootfs copy failed:`, e instanceof Error ? e.message : e);
		vm.status = 'error';
		store.putVM(vm);
		return vm;
	}

	const fcProcess = spawn(FC_BINARY, ['--api-sock', socketPath], { stdio: 'ignore' });
	activeVMs.set(id, { process: fcProcess, tapDevice });

	fcProcess.on('exit', () => {
		activeVMs.delete(id);
		try { unlinkSync(socketPath); } catch {}
		try { unlinkSync(vsockPath); } catch {}
		teardownTAP(tapDevice);
		const v = store.getVM(id);
		if (v && v.status === 'running') {
			v.status = 'stopped';
			store.putVM(v);
		}
	});

	try {
		await waitForSocket(socketPath);
		await fcAPI(socketPath, 'PUT', '/machine-config', { vcpu_count: VCPU, mem_size_mib: MEM_MB });
		await fcAPI(socketPath, 'PUT', '/boot-source', {
			kernel_image_path: KERNEL_PATH,
			boot_args: `console=ttyS0 reboot=k panic=1 pci=off ip=${vmIP}::172.20.0.1:255.255.255.0`,
		});
		await fcAPI(socketPath, 'PUT', '/drives/rootfs', {
			drive_id: 'rootfs', path_on_host: rootfsPath, is_root_device: true, is_read_only: false,
		});
		await fcAPI(socketPath, 'PUT', '/network-interfaces/eth0', {
			iface_id: 'eth0', guest_mac: genMAC(id), host_dev_name: tapDevice,
		});
		await fcAPI(socketPath, 'PUT', '/vsock', { guest_cid: 3, uds_path: vsockPath });
		await fcAPI(socketPath, 'PUT', '/mmds/config', { network_interfaces: ['eth0'] });
		await fcAPI(socketPath, 'PUT', '/mmds', { nous_api_key: vm.apiKey });
		await fcAPI(socketPath, 'PUT', '/actions', { action_type: 'InstanceStart' });
		vm.status = 'running';
	} catch (e) {
		console.error(`[vm ${id}] startVM failed:`, e instanceof Error ? e.message : e);
		fcProcess.kill();
		teardownTAP(tapDevice);
		vm.status = 'error';
		try { unlinkSync(rootfsPath); } catch {}
	}

	store.putVM(vm);
	return vm;
}

export async function killVM(id: string): Promise<boolean> {
	const vm = store.getVM(id);
	if (!vm) return false;

	const entry = activeVMs.get(id);
	if (entry) {
		try {
			const api = fcAPI(vm.socketPath, 'PUT', '/actions', { action_type: 'SendCtrlAltDel' });
			await Promise.race([api, new Promise((r) => setTimeout(r, 1000))]);
		} catch {}

		try {
			entry.process.kill('SIGKILL');
		} catch {}

		teardownTAP(entry.tapDevice);
		activeVMs.delete(id);
	}

	vm.status = 'stopped';
	store.putVM(vm);

	try { unlinkSync(vm.socketPath); } catch {}
	try { unlinkSync(vm.vsockPath); } catch {}
	try { unlinkSync(`/tmp/fc-${id}-rootfs.ext4`); } catch {}

	return true;
}

export async function deleteVM(id: string): Promise<boolean> {
	await killVM(id);
	store.removeVM(id);
	return true;
}

export async function killAllVMs(): Promise<void> {
	await Promise.all([...activeVMs.keys()].map(killVM));
}
