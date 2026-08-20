export interface NotionPage {
	id: string;
	created_time: string;
	last_edited_time: string;
	properties: Record<string, any>;
	archived: boolean;
	in_trash: boolean;
	url: string;
}

export interface Task {
	id: string;
	created: string;
	completed: string | null;
	dueDate: string | null;
	status: string;
	tags: string[];
	priority: string;
	projectName: string;
	hasProject: boolean;
	lastEditedTime: string;
}

export type DueDateCategory = 'Future' | 'Overdue' | 'Undated';
export type GroupBy = 'tag' | 'priority' | 'project' | 'age';
export type ChartMode = 'active' | 'flow';

export interface DayCount {
	date: string;
	total: number;
	[key: string]: number | string;
}

export interface TaskEvent {
	created: Task[];
	completed: Task[];
	stateChange: Task[];
}

export interface ParsedData {
	tasks: Task[];
	allTags: string[];
	allPriorities: string[];
	allProjects: string[];
	tagColors: Record<string, string>;
}

export interface TaskCache extends ParsedData {
	lastFullRefreshAt: string | null;
}
