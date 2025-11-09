// Auto-generated global types namespace for SprintDesk
// This file makes types available under the global `SprintDesk` namespace
// so you can refer to them as `SprintDesk.TaskMetadata`, etc., without imports.

declare global {
    namespace SprintDesk {
        type TaskType = 'feature' | 'bug' | 'improvement' | 'documentation' | 'test';
        type TaskStatus = 'waiting' | 'started' | 'done' | 'blocked' | 'canceled';
        type Priority = 'high' | 'medium' | 'low';
        type EpicStatus = 'planned' | 'started' | 'completed' | 'blocked';
        type ITaskBacklog = { _id: string; title: string; path: string; };
        type ITaskSprint = { _id: string; title: string; path: string; };
        interface TaskMetadata {
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
            epicTitle?: string;
            objective?: string;
            backlogs?: ITaskBacklog[];
            sprints?: ITaskSprint[];
        }

        interface EpicMetadata {
            title: string;
            type?: string;
            description?: string;
            priority?: Priority;
            status?: EpicStatus;
            owner?: string;
            startDate?: Date;
            endDate?: Date;
            totalTasks?: number;
            color?: string;
            completedTasks?: number;
            waitingTasks?: number;
            startedTasks?: number;
            doneTasks?: number;
            progress?: string;
            path?: string
        }

        interface TaskRow {
            task: string;
            epic: string;
            file: string;
        }

        interface ProjectItem {
            name: string;
            lastCommit: string;
            lastUpdate: string;
        }

        interface ProjectStructure {
            name: string;
            path: string;
            lastCommit: string;
            lastUpdate: string;
            backlogs: ProjectItem[];
            epics: ProjectItem[];
            sprints: ProjectItem[];
            tasks: ProjectItem[];
        }

        interface IAppProps { }

        interface ITaskMetadata {
            _id: string;
            title: string;
            type: TaskType;
            category?: string;
            component?: string;
            duration?: string;
            priority: Priority;
            status: TaskStatus;
            assignee?: string;
            created_at: string;
            updated_at: string;
            objective?: string;
        }
    }
}

export { };
