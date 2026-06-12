import { Sandbox } from '@e2b/code-interpreter';
import * as store from './store';
import type { VM } from '$lib/types';

const DEFAULT_TEMPLATE = 'code-interpreter-v1';
const DEFAULT_TIMEOUT_MS = 3_600_000;

function log(step: string, msg: string) {
	console.log(`[E2B-MGR] [${step}] ${msg} (${new Date().toISOString()})`);
}

function genId(): string {
	return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function connOpts() {
	const apiKey = process.env['E2B_API_KEY'];
	const accessToken = process.env['E2B_ACCESS_TOKEN'];
	const domain = process.env['E2B_DOMAIN'];
	if (!apiKey && !accessToken) {
		throw new Error(
			'Set E2B_API_KEY (or E2B_ACCESS_TOKEN for self-host) in .env before creating a sandbox.'
		);
	}
	return {
		apiKey,
		accessToken,
		domain,
		timeoutMs: DEFAULT_TIMEOUT_MS
	};
}

function connectSB(sandboxId: string): Promise<InstanceType<typeof Sandbox>> {
	return Sandbox.connect(sandboxId, connOpts());
}

export function listVMs(): VM[] {
	return store.getVMs();
}

export function getVM(id: string): VM | undefined {
	return store.getVM(id);
}

export async function createVM(
	n: string,
	p: string,
	m: string,
	k: string,
	t: string = DEFAULT_TEMPLATE
): Promise<VM> {
	const i = genId();
	const vm: VM = { i, n, s: 'creating', p, m, k, t, c: new Date().toISOString() };
	store.putVM(vm);
	log('createVM', `i=${i} n=${n} t=${t}`);
	try {
		const sb = await Sandbox.create(t, connOpts());
		vm.b = sb.sandboxId;
		vm.s = 'running';
		store.putVM(vm);
		log('createVM', `sandbox=${sb.sandboxId} status=running`);
	} catch (e) {
		vm.s = 'error';
		store.putVM(vm);
		log('createVM', `FAILED: ${e instanceof Error ? e.message : e}`);
	}
	return vm;
}

export async function startVM(i: string): Promise<VM | null> {
	const existing = store.getVM(i);
	if (!existing) return null;
	if (existing.s === 'running' && existing.b) return existing;
	log('startVM', `i=${i} t=${existing.t}`);
	const vm: VM = { ...existing, s: 'creating' };
	store.putVM(vm);
	try {
		const sb = await Sandbox.create(existing.t, connOpts());
		vm.b = sb.sandboxId;
		vm.s = 'running';
		store.putVM(vm);
		log('startVM', `sandbox=${sb.sandboxId} status=running`);
	} catch (e) {
		vm.s = 'error';
		store.putVM(vm);
		log('startVM', `FAILED: ${e instanceof Error ? e.message : e}`);
	}
	return vm;
}

export async function killVM(i: string): Promise<boolean> {
	const vm = store.getVM(i);
	if (!vm) return false;
	if (vm.b) {
		try {
			const sb = await connectSB(vm.b);
			await sb.kill();
			log('killVM', `i=${i} sandbox=${vm.b} killed`);
		} catch (e) {
			log('killVM', `i=${i} kill error: ${e instanceof Error ? e.message : e}`);
		}
	}
	vm.s = 'stopped';
	vm.b = undefined;
	store.putVM(vm);
	return true;
}

export async function deleteVM(i: string): Promise<boolean> {
	await killVM(i);
	store.removeVM(i);
	return true;
}

export async function connectRunning(sandboxId: string): Promise<InstanceType<typeof Sandbox>> {
	return connectSB(sandboxId);
}

export async function killAllVMs(): Promise<void> {
	const all = store.getVMs();
	await Promise.all(all.filter((v) => v.s === 'running').map((v) => killVM(v.i)));
}
