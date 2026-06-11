<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { VM } from '$lib/types';

	let vms = $state<VM[]>([]);
	let showForm = $state(false);
	let name = $state('');
	let provider = $state('openrouter');
	let model = $state('anthropic/claude-sonnet-4');
	let apiKey = $state('');
	let creating = $state(false);
	let error = $state('');

	onMount(() => load());

	async function load() {
		const r = await fetch('/api/vms');
		if (r.ok) vms = await r.json();
	}

	async function create() {
		if (!name || !apiKey) return;
		creating = true;
		error = '';
		const r = await fetch('/api/vms', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, provider, model, apiKey }),
		});
		if (r.ok) {
			showForm = false;
			name = '';
			apiKey = '';
			await load();
		} else {
			const e = await r.json();
			error = e.error || 'Failed to create VM';
		}
		creating = false;
	}

	async function startVM(id: string) {
		await fetch(`/api/vms/${id}/actions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'start' }),
		});
		await load();
	}

	async function stopVM(id: string) {
		await fetch(`/api/vms/${id}/actions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'stop' }),
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
		<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-2xl);">
			<h1 style="font-size: var(--text-display-sm); margin: 0;">Eddie</h1>
			<button class="btn-primary" onclick={() => (showForm = !showForm)}>
				{showForm ? 'Cancel' : '+ New VM'}
			</button>
		</div>

		{#if showForm}
			<div class="card" style="margin-bottom: var(--spacing-xl);">
				<form onsubmit={(e) => { e.preventDefault(); create(); }}>
					<div style="display: flex; flex-direction: column; gap: var(--spacing-md);">
						<input class="input" placeholder="VM name" bind:value={name} required />
						<select class="input" bind:value={provider}>
							<option value="openrouter">OpenRouter</option>
							<option value="anthropic">Anthropic</option>
							<option value="openai">OpenAI</option>
						</select>
						<input class="input" placeholder="Model (e.g. anthropic/claude-sonnet-4)" bind:value={model} required />
						<input class="input" type="password" placeholder="API key" bind:value={apiKey} required />
						{#if error}
							<p style="color: var(--color-accent-sunset); font-size: var(--text-body-sm); margin: 0;">{error}</p>
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
				<p style="color: var(--color-body-mid); margin: 0;">No VMs yet. Create one to get started.</p>
			</div>
		{:else}
			<div style="display: grid; gap: var(--spacing-lg);">
				{#each vms as vm}
					<div class="card" style="display: flex; justify-content: space-between; align-items: center;">
						<div>
							<h3 style="font-size: var(--text-body-lg); margin: 0;">{vm.name}</h3>
							<p style="font-size: var(--text-body-sm); color: var(--color-body-mid); margin: var(--spacing-xs) 0 0 0;">
								{vm.provider} / {vm.model}
							</p>
							<span
								class="eyebrow eyebrow-sm"
								style="display: inline-block; margin-top: var(--spacing-sm);"
							>
								{vm.status}
							</span>
						</div>
						<div style="display: flex; gap: var(--spacing-sm); align-items: center;">
							{#if vm.status === 'running'}
								<button class="btn-outline btn-outline-sm" onclick={() => stopVM(vm.id)}>Stop</button>
								<button class="btn-primary" onclick={() => goto(`/vm/${vm.id}`)}>Chat</button>
							{:else if vm.status === 'stopped' || vm.status === 'error'}
								<button class="btn-outline btn-outline-sm" onclick={() => startVM(vm.id)}>Start</button>
							{/if}
							<button
								class="btn-outline btn-outline-sm"
								onclick={() => deleteVM(vm.id)}
							>
								Delete
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
