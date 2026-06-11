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
	const ok = await vm.ensureImage();
	if (!ok) {
		return json({ error: 'Docker image eddie-hermes not found. Run: pnpm docker:build' }, { status: 400 });
	}
	const v = await vm.createVM(name, provider, model, apiKey);
	return json(v, { status: 201 });
}
