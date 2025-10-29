export type TaskType = 'feature' | 'bug' | 'improvement' | 'documentation' | 'test';
export type TaskStatus = 'not-started' | 'in-progress' | 'done' | 'blocked';
export type Priority = 'high' | 'medium' | 'low';
export type EpicStatus = '⏳ Planned' | '🔄 In Progress' | '✅ Completed' | '⛔ Blocked';

export interface TaskMetadata {
  title: string;
  type?: TaskType;
  category?: string;
  component?: string;
  duration?: string;
  priority?: Priority;
  status?: TaskStatus;
  assignee?: string;
  epicId?: string;
  epicName?: string;
}

export interface EpicMetadata {
  title: string;
  type?: string;
  priority?: Priority;
  status?: EpicStatus;
  owner?: string;
  startDate?: Date;
  endDate?: Date;
}