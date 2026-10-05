<script>
	import { onMount, tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	onMount(async () => {
		document.getElementById('dashboard-loading')?.remove();
		await tick();
		const url = new URL(location.href);
		if (url.searchParams.has('online')) {
			url.searchParams.delete('online');
			replaceState(url, {});
		}
	});
	import '@fontsource-variable/inter';
	import '@fontsource-variable/space-grotesk';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>Task Burndown</title>
</svelte:head>

<div class="min-h-screen bg-[var(--color-void)] text-white antialiased">
	{@render children()}
</div>
