import type { NotionPage, Task, ParsedData } from '$lib/types.js';

function extractProp(props: Record<string, any>, name: string, type: string, sub?: string): any {
	if (sub) return props[name]?.[type]?.[sub] ?? null;
	return props[name]?.[type] ?? null;
}

function extractMultiSelect(
	props: Record<string, any>,
	name: string
): { name: string; color: string }[] {
	return (props[name]?.multi_select || []).map((t: { name: string; color: string }) => ({
		name: t.name,
		color: t.color
	}));
}

export const PRIORITY_ORDER = ['High', 'Medium', 'Low', '(No Priority)'];

/**
 * Extract project name from the "Project Title" rollup field.
 * The rollup returns: { rollup: { array: [{ title: [{ plain_text: "Name" }] }] } }
 */
function extractProjectTitle(props: Record<string, any>): string {
	const rollup = props['Project Title']?.rollup;
	if (!rollup?.array || rollup.array.length === 0) return '(No Project)';
	const titleEntry = rollup.array[0];
	if (titleEntry?.type === 'title' && titleEntry.title?.length > 0) {
		return titleEntry.title[0].plain_text || '(No Project)';
	}
	return '(No Project)';
}

function parseTask(page: NotionPage): Task {
	const props = page.properties;
	const tagObjects = extractMultiSelect(props, 'Tags');
	if (tagObjects.length === 0) {
		const fallback = extractMultiSelect(props, 'Tag');
		tagObjects.push(...fallback);
	}

	const projectName = extractProjectTitle(props);
	const priority = extractProp(props, 'Priority', 'select', 'name') || '(No Priority)';

	return {
		id: page.id,
		created: extractProp(props, 'Date Created', 'created_time'),
		completed: extractProp(props, 'Completed Date', 'date', 'start'),
		dueDate: extractProp(props, 'Due Date', 'date', 'start'),
		status: extractProp(props, 'Status', 'status', 'name'),
		tags: tagObjects.map((t) => t.name),
		priority,
		projectName,
		aiCompleted: props['AI Completed']?.checkbox ?? false,
		hasProject: projectName !== '(No Project)',
		lastEditedTime: page.last_edited_time
	};
}

export function parseTasks(pages: NotionPage[]): ParsedData {
	const allTagsSet = new Set<string>();
	const allPrioritiesSet = new Set<string>();
	const allProjectsSet = new Set<string>();
	const tagColors: Record<string, string> = {};

	const allParsed = pages.map((page) => {
		const props = page.properties;
		const tagObjects = (props['Tags']?.multi_select || props['Tag']?.multi_select || []) as {
			name: string;
			color: string;
		}[];
		for (const t of tagObjects) {
			tagColors[t.name] = t.color;
			allTagsSet.add(t.name);
		}

		const task = parseTask(page);
		allPrioritiesSet.add(task.priority);
		allProjectsSet.add(task.projectName);
		return task;
	});

	const tasks = allParsed;

	allTagsSet.add('(Untagged)');
	tagColors['(Untagged)'] = 'default';

	return {
		tasks,
		allTags: Array.from(allTagsSet).sort(),
		allPriorities: PRIORITY_ORDER.filter((p) => allPrioritiesSet.has(p)),
		allProjects: Array.from(allProjectsSet).sort(),
		tagColors
	};
}
