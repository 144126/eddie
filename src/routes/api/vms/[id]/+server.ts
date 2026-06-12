import { json } from '@sveltejs/kit';
import * as sm from '$lib/server/sandbox-manager';

export async function GET({ params }) {
	const v = sm.getVM(params.id);
	if (!v) return json({ e: 'not found' }, { status: 404 });
	return json(v);
}

export async function DELETE({ params }) {
	const ok = await sm.deleteVM(params.id);
	if (!ok) return json({ e: 'not found' }, { status: 404 });
	return new Response(null, { status: 204 });
}
