import { json } from '@sveltejs/kit';
import * as vm from '$lib/server/vm-manager';

export function GET({ params }) {
	const v = vm.getVM(params.id);
	if (!v) return json({ error: 'not found' }, { status: 404 });
	return json(v);
}

export async function DELETE({ params }) {
	const ok = await vm.deleteVM(params.id);
	if (!ok) return json({ error: 'not found' }, { status: 404 });
	return new Response(null, { status: 204 });
}
