import { json } from '@sveltejs/kit';
import * as sm from '$lib/server/sandbox-manager';

export function GET() {
	return json(sm.listVMs());
}

export async function POST({ request }) {
	const { n, p, m, k, t } = await request.json();
	if (!n || !p || !m || !k) {
		return json({ e: 'n, p, m, k required' }, { status: 400 });
	}
	const v = await sm.createVM(n, p, m, k, t);
	return json(v, { status: 201 });
}
