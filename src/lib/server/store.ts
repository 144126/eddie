import fs from 'node:fs';
import path from 'node:path';
import type { VM, Message } from '$lib/types';

const DATA_DIR = process.env['DATA_DIR'] || path.join(process.cwd(), 'data');
const VMS_PATH = path.join(DATA_DIR, 'vms.json');

function ensureDir(fp: string) {
	fs.mkdirSync(path.dirname(fp), { recursive: true });
}

function readJson<T>(fp: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(fp, 'utf-8'));
	} catch {
		return fallback;
	}
}

function writeJson(fp: string, data: unknown) {
	ensureDir(fp);
	fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

function migrateVM(v: unknown): VM | null {
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	if (typeof o['i'] === 'string' && typeof o['n'] === 'string') {
		return {
			i: o['i'],
			n: o['n'],
			s: (o['s'] as VM['s']) ?? 'stopped',
			b: typeof o['b'] === 'string' ? o['b'] : undefined,
			p: typeof o['p'] === 'string' ? o['p'] : '',
			m: typeof o['m'] === 'string' ? o['m'] : '',
			k: typeof o['k'] === 'string' ? o['k'] : '',
			t: typeof o['t'] === 'string' ? o['t'] : 'code-interpreter-v1',
			c: typeof o['c'] === 'string' ? o['c'] : new Date().toISOString()
		};
	}
	if (typeof o['id'] === 'string' && typeof o['name'] === 'string') {
		return {
			i: o['id'],
			n: o['name'],
			s: 'stopped',
			b: undefined,
			p: typeof o['provider'] === 'string' ? o['provider'] : '',
			m: typeof o['model'] === 'string' ? o['model'] : '',
			k: typeof o['apiKey'] === 'string' ? o['apiKey'] : '',
			t: 'code-interpreter-v1',
			c: typeof o['createdAt'] === 'string' ? o['createdAt'] : new Date().toISOString()
		};
	}
	return null;
}

function migrateMessage(m: unknown): Message | null {
	if (!m || typeof m !== 'object') return null;
	const o = m as Record<string, unknown>;
	if (typeof o['i'] === 'string') {
		const r = o['r'];
		return {
			i: o['i'],
			r: r === 'assistant' || r === 'tool' ? r : 'user',
			c: typeof o['c'] === 'string' ? o['c'] : '',
			a: typeof o['a'] === 'string' ? o['a'] : new Date().toISOString()
		};
	}
	if (typeof o['id'] === 'string') {
		const r = o['role'];
		return {
			i: o['id'],
			r: r === 'assistant' || r === 'tool' ? r : 'user',
			c: typeof o['content'] === 'string' ? o['content'] : '',
			a: typeof o['createdAt'] === 'string' ? o['createdAt'] : new Date().toISOString()
		};
	}
	return null;
}

function loadVMs(): VM[] {
	const raw = readJson<unknown[]>(VMS_PATH, []);
	const out: VM[] = [];
	for (const v of raw) {
		const m = migrateVM(v);
		if (m) out.push(m);
	}
	return out;
}

function loadMessages(vmId: string): Message[] {
	const raw = readJson<unknown[]>(path.join(DATA_DIR, `msgs-${vmId}.json`), []);
	const out: Message[] = [];
	for (const m of raw) {
		const x = migrateMessage(m);
		if (x) out.push(x);
	}
	return out;
}

export function getVMs(): VM[] {
	return loadVMs();
}

export function getVM(id: string): VM | undefined {
	return getVMs().find((v) => v.i === id);
}

export function putVM(vm: VM): void {
	const all = getVMs();
	const i = all.findIndex((v) => v.i === vm.i);
	if (i >= 0) all[i] = vm;
	else all.push(vm);
	writeJson(VMS_PATH, all);
}

export function removeVM(id: string): void {
	writeJson(
		VMS_PATH,
		getVMs().filter((v) => v.i !== id)
	);
	const mp = path.join(DATA_DIR, `msgs-${id}.json`);
	try {
		fs.unlinkSync(mp);
	} catch {
		// best-effort cleanup
	}
}

export function getMessages(vmId: string): Message[] {
	return loadMessages(vmId);
}

export function addMessage(vmId: string, msg: Message): void {
	const all = getMessages(vmId);
	all.push(msg);
	writeJson(path.join(DATA_DIR, `msgs-${vmId}.json`), all);
}
