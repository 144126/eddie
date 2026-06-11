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

export function getVMs(): VM[] {
	return readJson<VM[]>(VMS_PATH, []);
}

export function getVM(id: string): VM | undefined {
	return getVMs().find((v) => v.id === id);
}

export function putVM(vm: VM): void {
	const all = getVMs();
	const i = all.findIndex((v) => v.id === vm.id);
	if (i >= 0) all[i] = vm;
	else all.push(vm);
	writeJson(VMS_PATH, all);
}

export function removeVM(id: string): void {
	writeJson(
		VMS_PATH,
		getVMs().filter((v) => v.id !== id)
	);
	const mp = path.join(DATA_DIR, `msgs-${id}.json`);
	try {
		fs.unlinkSync(mp);
	} catch {}
}

export function getMessages(vmId: string): Message[] {
	return readJson<Message[]>(path.join(DATA_DIR, `msgs-${vmId}.json`), []);
}

export function addMessage(vmId: string, msg: Message): void {
	const all = getMessages(vmId);
	all.push(msg);
	writeJson(path.join(DATA_DIR, `msgs-${vmId}.json`), all);
}
