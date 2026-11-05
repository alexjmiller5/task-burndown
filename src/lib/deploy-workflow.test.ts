import config from '../../wrangler.jsonc?raw';
import workflow from '../../.github/workflows/deploy.yml?raw';
import { expect, test } from 'vitest';

test('deployment requires a successful static check before build and upload', () => {
	const commands = [...workflow.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map((m) => m[1].trim());
	const check = commands.indexOf('bun run check');
	const build = commands.indexOf('bun run build');
	const deploy = commands.indexOf('bunx wrangler deploy');
	expect(check).toBeGreaterThanOrEqual(0);
	expect(build).toBeGreaterThan(check);
	expect(deploy).toBeGreaterThan(build);
	// GitHub stops on a failed step by default; either override would bypass the gate.
	expect(workflow).not.toMatch(/continue-on-error\s*:\s*(?!false\b)\S+/);
	expect(workflow).not.toMatch(/if\s*:.*(?:always|failure)\s*\(/);
	expect(commands[check]).toBe('bun run check');
});

test('public hub reads have the Workers routing flag and no cross-project binding', () => {
	const worker = JSON.parse(config.replace(/^\s*\/\/.*$/gm, ''));
	expect(worker.compatibility_flags).toContain('global_fetch_strictly_public');
	expect(worker.services ?? []).not.toEqual(
		expect.arrayContaining([expect.objectContaining({ binding: 'SOMA_HUB' })])
	);
});
