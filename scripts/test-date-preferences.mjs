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
ws.addEventListener('message', ({ data }) => {
	const m = JSON.parse(data);
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
	await send('Page.enable');
	injection = await send('Page.addScriptToEvaluateOnNewDocument', {
		source: `(()=>{const nativeFetch=window.fetch; window.fetch=(input,init)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;if(path==='/api/tasks')return Promise.resolve(new Response(JSON.stringify({tasks:[{id:'fixture-1',created:'2025-02-01T12:00:00Z',completed:null,dueDate:null,status:'To Do',tags:['Chore'],priority:'High',projectName:'Example',hasProject:true,aiCompleted:false,lastEditedTime:'2026-10-01T12:00:00Z'}],allTags:['Chore'],allPriorities:['High'],allProjects:['Example'],tagColors:{},lastFullRefreshAt:null}),{headers:{'Content-Type':'application/json'}}));if(path==='/api/markers')return Promise.resolve(new Response('[]',{headers:{'Content-Type':'application/json'}}));if(path.startsWith('/api/'))return Promise.resolve(new Response(JSON.stringify({needsFull:false,freshCount:0}),{headers:{'Content-Type':'application/json'}}));return nativeFetch(input,init)};})();`
	});
	await send('Page.navigate', { url: origin });
	await new Promise((r) => setTimeout(r, 1800));
	const pause = () => new Promise((r) => setTimeout(r, 150));
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
	const choose = async (title, option) => {
		await click(`document.querySelector('button[title="${title}"]')`);
		await pause();
		const found = await evaluate(
			`!![...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(option)})`
		);
		assert(found, `Missing ${title} option ${option}`);
		await click(
			`[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(option)})`
		);
		await pause();
	};
	await evaluate('localStorage.clear()');
	await send('Page.reload');
	await new Promise((r) => setTimeout(r, 900));
	await choose('Time bucket', 'Month');
	await choose('Group by', 'Priority');
	await evaluate(`document.querySelector('button[title="Include canceled tasks"]').click()`);
	await pause();
	const stored = await evaluate(`JSON.parse(localStorage.getItem('burndown:prefs:v1'))`);
	assert.equal(stored.flowBucket, 'month');
	assert.equal(stored.groupBy, 'priority');
	assert.equal(stored.includeCanceled, true);
	await send('Page.reload');
	await new Promise((r) => setTimeout(r, 900));
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
	await send('Page.reload');
	await new Promise((r) => setTimeout(r, 900));
	assert.deepEqual(await selected(), custom, 'Custom dates survive reload');
	for (const [handle, key, expectedDate] of [
		['Start date', 'End', '2025-05-01'],
		['End date', 'Home', '2025-04-01']
	]) {
		await evaluate(
			`localStorage.setItem('burndown:prefs:v1',JSON.stringify({...JSON.parse(localStorage.getItem('burndown:prefs:v1')),preset:null,dateStart:'2025-04-01',dateEnd:'2025-05-01'}))`
		);
		await send('Page.reload');
		await new Promise((r) => setTimeout(r, 900));
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
	if (process.env.BURNDOWN_SCREENSHOT) {
		const shot = await send('Page.captureScreenshot', { format: 'png' });
		await writeFile(process.env.BURNDOWN_SCREENSHOT, Buffer.from(shot.data, 'base64'));
	}
	console.log('PASS viewport panning, ALL, keyboard, custom reload, held edge drag, 390px layout');
} finally {
	await evaluate(`localStorage.clear(); caches.delete('dashboard-data-v1')`);
	await send('Emulation.clearDeviceMetricsOverride');
	if (injection)
		await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
	ws.close();
}
