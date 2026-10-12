// Browser regression driver for local synthetic fixtures. Uses the existing agent Chrome.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const [target, origin = 'http://127.0.0.1:5173', port = '9222'] = process.argv.slice(2);
assert(
	['127.0.0.1', 'localhost'].includes(new URL(origin).hostname),
	'Only local synthetic fixtures are allowed'
);
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const tab = tabs.find((t) => t.id === target);
assert(tab, 'Explicit test target required');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const ownershipWarnings = [];
const loadWaiters = [];
ws.addEventListener('message', ({ data }) => {
	const m = JSON.parse(data);
	if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach((resolve) => resolve());
	if (m.method === 'Runtime.consoleAPICalled') {
		const message = m.params.args.map((a) => a.value ?? '').join(' ');
		if (message.includes('ownership_invalid_')) ownershipWarnings.push(message);
	}
	if (m.id) {
		const p = pending.get(m.id);
		pending.delete(m.id);
		m.error ? p.reject(m.error) : p.resolve(m.result);
	}
});
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expression) => {
	const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
	if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
	return r.result.value;
};
let injection;
try {
	// A hidden tab never finishes a list's exit animation, leaving the page click-locked.
	await send('Page.bringToFront');
	await send('Page.enable');
	await send('Runtime.discardConsoleEntries');
	await send('Runtime.enable');
	injection = await send('Page.addScriptToEvaluateOnNewDocument', {
		source: `(()=>{const nativeFetch=window.fetch; window.fetch=(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(path==='/api/tasks')return Promise.resolve(new Response(JSON.stringify({tasks:[{id:'fixture-1',created:'2025-02-01T12:00:00Z',completed:null,dueDate:null,status:'To Do',tags:['Alpha'],priority:'High',projectName:'Example',hasProject:true,aiCompleted:false,lastEditedTime:'2026-10-01T12:00:00Z'},{id:'fixture-2',created:'2025-02-01T12:00:00Z',completed:null,dueDate:null,status:'In Progress',tags:['Gamma'],priority:'High',projectName:'Example',hasProject:true,aiCompleted:false,lastEditedTime:'2026-10-01T12:00:00Z'}],allTags:['(Untagged)','Alpha','Gamma'],allPriorities:['High'],allProjects:['Example'],tagColors:{},lastFullRefreshAt:null}),{headers:{'Content-Type':'application/json'}}));if(path==='/api/settings'){if(init?.method==='PUT'){sessionStorage.setItem('fixture-settings',init.body);window.__settingsPuts=[...(window.__settingsPuts||[]),init.body]}return Promise.resolve(new Response(sessionStorage.getItem('fixture-settings')||'{"dayStartMinutes":0}',{headers:{'Content-Type':'application/json'}}))}if(path==='/api/markers')return Promise.resolve(new Response('[]',{headers:{'Content-Type':'application/json'}}));if(path.startsWith('/api/'))return Promise.resolve(new Response(JSON.stringify({needsFull:false,freshCount:0}),{headers:{'Content-Type':'application/json'}}));return nativeFetch(input,init)};})();`
	});
	const pause = () => new Promise((r) => setTimeout(r, 150));
	// Poll instead of sleeping a fixed time: a loaded machine renders slowly.
	const waitFor = async (expression, message) => {
		for (const end = Date.now() + 15000; Date.now() < end; await pause()) {
			if (await evaluate(expression).catch(() => false)) return;
		}
		assert.fail(message ?? `Timed out waiting for ${expression}`);
	};
	// Loaded = the controls are mounted and the fixture tasks reached the stats row.
	const loaded = `!!document.querySelector('button[title="Group by"]')&&!!document.querySelector('section span')`;
	const load = async (method, params) => {
		const fired = new Promise((resolve) => loadWaiters.push(resolve));
		await send(method, params);
		await fired;
		await waitFor(loaded, 'The dashboard did not finish loading');
	};
	const reload = () => load('Page.reload');
	await load('Page.navigate', { url: origin });
	const click = async (expression) => {
		const { x, y } = await evaluate(
			`(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
		);
		await send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x,
			y,
			button: 'left',
			clickCount: 1
		});
		await send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x,
			y,
			button: 'left',
			clickCount: 1
		});
	};
	// A closed list can linger in the DOM until its exit animation ends: only the open one counts.
	const openList = `[data-slot=select-content][data-state=open]`;
	const listClosed = `!document.querySelector('${openList}')`;
	const choose = async (title, option) => {
		// A list still open or closing swallows the next trigger click.
		await waitFor(listClosed, 'A select list stayed open');
		await click(`document.querySelector('button[title="${title}"]')`);
		await waitFor(
			`!![...document.querySelectorAll('${openList} [role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(option)})`,
			`Missing ${title} option ${option}`
		);
		await pause();
		await click(
			`[...document.querySelectorAll('${openList} [role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(option)})`
		);
		await pause();
	};
	// Tall enough that the 24-entry day start list opens without scroll buttons.
	await send('Emulation.setDeviceMetricsOverride', {
		width: 1440,
		height: 1000,
		deviceScaleFactor: 1,
		mobile: false
	});
	// A zone no fixed picker entry uses, so "This device" provably follows the device.
	await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
	await evaluate('localStorage.clear(); sessionStorage.clear()');
	await reload();
	// Rendered (visible, CSS-uppercased) trigger text, lowercased for comparison.
	const text = async (title) =>
		(
			await evaluate(`document.querySelector('button[title="${title}"]').innerText.trim()`)
		).toLowerCase();
	const prefs = () => evaluate(`JSON.parse(localStorage.getItem('burndown:prefs:v1'))`);
	const endDay = () =>
		evaluate(
			`Number(document.querySelector('[aria-label="End date"]').getAttribute('aria-valuenow'))`
		);
	// Expected "today" (days since epoch) for a day start, from the page's wall clock.
	const wallDay = (dayStart) =>
		evaluate(
			`(()=>{const n=new Date();const d=Date.UTC(n.getFullYear(),n.getMonth(),n.getDate())/86400000;return n.getHours()*60+n.getMinutes()<${dayStart}?d-1:d})()`
		);
	const DEVICE = 'This device (Asia/Tokyo)';
	// The headline open count, read off the stat labelled "active ...".
	const active = () =>
		evaluate(
			`Number([...document.querySelectorAll('section span')].find(s=>/^active/i.test(s.textContent.trim())).previousElementSibling.textContent)`
		);
	assert.equal(await text('Group by'), 'tag');
	assert.equal(await active(), 2, 'Every tag in the data counts toward Active');
	await choose('Group by', 'Status');
	assert.equal(await text('Group by'), 'status');
	assert.equal(await active(), 2, 'The status breakdown keeps the same Active count');
	await reload();
	assert.equal(await text('Group by'), 'status', 'The status breakdown persists');
	await choose('Group by', 'Tag');
	console.log('PASS every tag counts toward Active; status breakdown persists');
	assert.equal(await text('Timezone'), DEVICE.toLowerCase(), 'This device is the default');
	assert.equal(await text('Day starts at'), 'day starts 00:00');
	assert.equal(await endDay(), await wallDay(0));
	await choose('Day starts at', '23:00');
	assert.deepEqual(await evaluate('window.__settingsPuts'), ['{"dayStartMinutes":1380}']);
	assert.equal(await text('Day starts at'), 'day starts 23:00');
	assert.equal(await endDay(), await wallDay(1380), 'Today follows the day start');
	await reload();
	assert.equal(await text('Day starts at'), 'day starts 23:00', 'Day start loads from the server');
	assert.equal(await endDay(), await wallDay(1380));
	assert.equal('dayStartMinutes' in (await prefs()), false, 'Day start is not device-local');
	await choose('Day starts at', '00:00');
	assert.equal(await endDay(), await wallDay(0));
	await evaluate(
		`localStorage.setItem('burndown:prefs:v1',JSON.stringify({version:1,timezone:'America/Chicago',groupBy:'priority',preset:'90D'}))`
	);
	await reload();
	assert.equal(
		await text('Timezone'),
		DEVICE.toLowerCase(),
		'A pre-device saved zone is discarded'
	);
	assert.equal(await text('Group by'), 'priority', 'Other saved fields survive');
	assert.equal((await prefs()).timezone, 'device');
	await choose('Timezone', 'Chicago (CT)');
	await reload();
	assert.equal(await text('Timezone'), 'chicago (ct)', 'An explicit pick persists');
	await choose('Timezone', DEVICE);
	assert.equal((await prefs()).timezone, 'device');
	await evaluate('localStorage.clear()');
	await reload();
	console.log('PASS This device default, discard-once, shared day start through reload');
	const projectLens = 'Which tasks count: with a project, without, or both';
	await choose(projectLens, 'Without project');
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
	await pause();
	assert.deepEqual(
		await evaluate(`JSON.parse(localStorage.getItem('burndown:prefs:v1')).projectKinds`),
		['project']
	);
	await reload();
	assert.equal(
		await evaluate(`document.querySelector('button[title="${projectLens}"]').textContent.trim()`),
		'With project'
	);
	await choose(projectLens, 'With project');
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
	await pause();
	assert.deepEqual(
		await evaluate(`JSON.parse(localStorage.getItem('burndown:prefs:v1')).projectKinds`),
		['project', 'none'],
		'Deselecting last lens value restores all'
	);
	assert.deepEqual(ownershipWarnings, [], 'Select bindings must preserve state ownership');
	await choose('Time bucket', 'Month');
	await choose('Group by', 'Priority');
	await evaluate(`document.querySelector('button[title="Include canceled tasks"]').click()`);
	await pause();
	const stored = await evaluate(`JSON.parse(localStorage.getItem('burndown:prefs:v1'))`);
	assert.equal(stored.flowBucket, 'month');
	assert.equal(stored.groupBy, 'priority');
	assert.equal(stored.includeCanceled, true);
	await reload();
	assert.equal(
		await evaluate(`document.querySelector('button[title="Time bucket"]').textContent.trim()`),
		'Month'
	);
	assert.equal(
		await evaluate(`document.querySelector('button[title="Group by"]').textContent.trim()`),
		'Priority'
	);
	console.log('PASS filter and bucket persistence through reload');
	const selected = () =>
		evaluate(
			`[...document.querySelectorAll('[role=slider]')].map(e=>Number(e.getAttribute('aria-valuenow')))`
		);
	const view = () =>
		evaluate(
			`document.querySelector('nav[aria-label="Date viewport"] [aria-live]').textContent.trim()`
		);
	assert.equal((await selected()).length, 2);
	const originalSelection = await selected();
	const originalView = await view();
	await click(`document.querySelector('[aria-label="Show earlier dates"]')`);
	await pause();
	assert.deepEqual(await selected(), originalSelection, 'Viewport pan must preserve selection');
	assert.notEqual(await view(), originalView);
	await choose('Date range', 'ALL');
	const allSelection = await selected();
	assert(allSelection[1] - allSelection[0] > 90, 'ALL selects archive');
	const allView = await view();
	const [left, right] = allView.split(' - ');
	assert.equal((Date.parse(right) - Date.parse(left)) / 86400000, 90, 'ALL keeps bounded viewport');
	await click(`document.querySelector('[aria-label="Start date"]')`);
	await send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'ArrowRight',
		code: 'ArrowRight',
		windowsVirtualKeyCode: 39
	});
	await send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'ArrowRight',
		code: 'ArrowRight',
		windowsVirtualKeyCode: 39
	});
	await pause();
	assert.deepEqual(
		await selected(),
		[allSelection[0] + 1, allSelection[1]],
		'Keyboard changes only focused bound'
	);
	assert.equal(
		await evaluate(`document.querySelector('button[title="Date range"]').textContent.trim()`),
		'Custom'
	);
	const custom = await selected();
	await reload();
	assert.deepEqual(await selected(), custom, 'Custom dates survive reload');
	for (const [handle, key, expectedDate] of [
		['Start date', 'End', '2025-05-01'],
		['End date', 'Home', '2025-04-01']
	]) {
		await evaluate(
			`localStorage.setItem('burndown:prefs:v1',JSON.stringify({...JSON.parse(localStorage.getItem('burndown:prefs:v1')),preset:null,dateStart:'2025-04-01',dateEnd:'2025-05-01'}))`
		);
		await reload();
		const historicalView = await view();
		await click(`document.querySelector('[aria-label="${handle}"]')`);
		await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
		await pause();
		const expected = Date.parse(expectedDate + 'T00:00:00Z') / 86400000;
		assert.deepEqual(await selected(), [expected, expected]);
		assert.equal(
			await view(),
			historicalView,
			`${handle} ${key} must follow its actual clamped date`
		);
	}
	await choose('Date range', '30D');
	const beforeDrag = await selected();
	const track = await evaluate(
		`(()=>{const r=document.querySelector('[aria-label="Start date"]').parentElement.getBoundingClientRect();return {left:r.left,right:r.right,y:r.y+24}})()`
	);
	const handle = await evaluate(
		`(()=>{const r=document.querySelector('[aria-label="Start date"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`
	);
	await send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		...handle,
		button: 'left',
		clickCount: 1
	});
	await send('Input.dispatchMouseEvent', {
		type: 'mouseMoved',
		x: track.left - 10,
		y: track.y,
		button: 'left',
		buttons: 1
	});
	await new Promise((r) => setTimeout(r, 600));
	await send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: track.left - 10,
		y: track.y,
		button: 'left',
		clickCount: 1
	});
	await pause();
	const afterDrag = await selected();
	assert(
		afterDrag[0] < beforeDrag[1] - 90,
		'Holding beyond edge extends selection into older history'
	);
	assert.equal(afterDrag[1], beforeDrag[1], 'Dragging start preserves selected end');
	const shot = async (suffix) => {
		if (!process.env.BURNDOWN_SCREENSHOT) return;
		const { data } = await send('Page.captureScreenshot', { format: 'png' });
		await writeFile(
			process.env.BURNDOWN_SCREENSHOT.replace(/\.png$/, suffix + '.png'),
			data,
			'base64'
		);
	};
	await choose('Day starts at', '05:00');
	await shot('-desktop');
	await send('Emulation.setDeviceMetricsOverride', {
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		mobile: true
	});
	await pause();
	assert.equal(
		await evaluate('document.documentElement.scrollWidth<=innerWidth'),
		true,
		'No mobile horizontal overflow'
	);
	assert.equal(await text('Timezone'), 'device', 'Phones show the short device label');
	assert.equal(await text('Day starts at'), '05:00');
	assert.equal(
		await evaluate(
			`(()=>{const a=document.querySelector('button[title="Timezone"]').getBoundingClientRect(),b=document.querySelector('button[title="Day starts at"]').getBoundingClientRect();return a.top===b.top})()`
		),
		true,
		'Zone and day start share a row on phones'
	);
	await shot('');
	await click(`document.querySelector('button[title="Day starts at"]')`);
	await pause();
	assert.equal(
		await evaluate(
			`(()=>{const r=document.querySelector('${openList}').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`
		),
		true,
		'Day start list stays inside the phone viewport'
	);
	await shot('-open');
	await click(
		`[...document.querySelectorAll('${openList} [role=option]')].find(e=>e.textContent.trim()==='00:00')`
	);
	await pause();
	assert.equal(await text('Day starts at'), '00:00');
	console.log('PASS viewport panning, ALL, keyboard, custom reload, held edge drag, 390px layout');
} finally {
	await evaluate(
		`localStorage.clear(); sessionStorage.clear(); caches.delete('dashboard-data-v1')`
	);
	await send('Emulation.clearDeviceMetricsOverride');
	await send('Emulation.setTimezoneOverride', { timezoneId: '' });
	if (injection)
		await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
	ws.close();
}
