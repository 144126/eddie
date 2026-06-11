import { json } from '@sveltejs/kit';
import * as vm from '$lib/server/vm-manager';

export function GET() {
	return json(vm.listVMs());
}

export async function POST({ request }) {
	const body = await request.json();
	const { name, provider, model, apiKey } = body;
	if (!name || !provider || !model || !apiKey) {
		return json({ error: 'name, provider, model, apiKey required' }, { status: 400 });
	}

	const issues = vm.ensureHost();
	if (issues.length > 0) {
		return json({
			error: `Host not ready:\n${issues.join('\n')}\n\nRun scripts/setup-host.sh and ensure assets/vmlinux + assets/rootfs.ext4 exist.`,
		}, { status: 400 });
	}

	const v = await vm.createVM(name, provider, model, apiKey);
	return json(v, { status: 201 });
}
