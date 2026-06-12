<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { VM } from '$lib/types';

	let vms = $state<VM[]>([]);
	let showForm = $state(false);
	let n = $state('');
	let p = $state('openrouter');
	let m = $state('nvidia/nemotron-3-ultra-550b-a55b:free');
	let k = $state('');
	let creating = $state(false);
	let err = $state('');

	onMount(() => load());

	async function load() {
		const r = await fetch('/api/vms');
		if (r.ok) vms = await r.json();
	}

	async function create() {
		if (!n || !k) return;
		creating = true;
		err = '';
		const r = await fetch('/api/vms', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ n, p, m, k })
		});
		if (r.ok) {
			showForm = false;
			n = '';
			k = '';
			await load();
		} else {
			const e = await r.json();
			err = e.e || 'Failed to create VM';
		}
		creating = false;
	}

	async function startVM(id: string) {
		await fetch(`/api/vms/${id}/actions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'start' })
		});
		await load();
	}

	async function stopVM(id: string) {
		await fetch(`/api/vms/${id}/actions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'stop' })
		});
		await load();
	}

	async function deleteVM(id: string) {
		if (!confirm('Delete this VM?')) return;
		await fetch(`/api/vms/${id}`, { method: 'DELETE' });
		await load();
	}
</script>

<div style="padding: var(--spacing-3xl) var(--spacing-xl);">
	<div class="container-site">
		<div
			style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-2xl);"
		>
			<h1 style="font-size: var(--text-display-sm); margin: 0;">Eddie</h1>
			<button class="btn-primary" onclick={() => (showForm = !showForm)}>
				{showForm ? 'Cancel' : '+ New VM'}
			</button>
		</div>

		{#if showForm}
			<div class="card" style="margin-bottom: var(--spacing-xl);">
				<form
					onsubmit={(e) => {
						e.preventDefault();
						create();
					}}
				>
					<div style="display: flex; flex-direction: column; gap: var(--spacing-md);">
						<input class="input" placeholder="VM name" bind:value={n} required />
						<select class="input" bind:value={p}>
							<option value="openrouter">OpenRouter</option>
							<option value="nous">Nous Portal</option>
							<option value="openai">OpenAI</option>
						</select>
						<input class="input" placeholder="Model" bind:value={m} required />
						<input class="input" type="password" placeholder="API key" bind:value={k} required />
						{#if err}
							<p
								style="color: var(--color-accent-sunset); font-size: var(--text-body-sm); margin: 0;"
							>
								{err}
							</p>
						{/if}
						<button class="btn-primary" type="submit" disabled={creating}>
							{creating ? 'Creating...' : 'Create VM'}
						</button>
					</div>
				</form>
			</div>
		{/if}

		{#if vms.length === 0}
			<div class="card" style="text-align: center;">
				<p style="color: var(--color-body-mid); margin: 0;">
					No VMs yet. Create one to get started.
				</p>
			</div>
		{:else}
			<div style="display: grid; gap: var(--spacing-lg);">
				{#each vms as vm (vm.i)}
					<div
						class="card"
						style="display: flex; justify-content: space-between; align-items: center;"
					>
						<div>
							<h3 style="font-size: var(--text-body-lg); margin: 0;">{vm.n}</h3>
							<p
								style="font-size: var(--text-body-sm); color: var(--color-body-mid); margin: var(--spacing-xs) 0 0 0;"
							>
								{vm.p} / {vm.m}
							</p>
							<span
								class="eyebrow eyebrow-sm"
								style="display: inline-block; margin-top: var(--spacing-sm);"
							>
								{vm.s}
							</span>
						</div>
						<div style="display: flex; gap: var(--spacing-sm); align-items: center;">
							{#if vm.s === 'running'}
								<button class="btn-outline btn-outline-sm" onclick={() => stopVM(vm.i)}>Stop</button
								>
								<button class="btn-primary" onclick={() => goto(`/vm/${vm.i}`)}>Chat</button>
							{:else if vm.s === 'stopped' || vm.s === 'error'}
								<button class="btn-outline btn-outline-sm" onclick={() => startVM(vm.i)}
									>Start</button
								>
							{/if}
							<button class="btn-outline btn-outline-sm" onclick={() => deleteVM(vm.i)}>
								Delete
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
