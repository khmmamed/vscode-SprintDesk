// src/webview/App.tsx
import * as React from "react";
import { messageHandler } from "@estruyf/vscode/dist/client";
import { acquireVsCodeApiOnce } from "./vscodeApi";
import "./styles.css";
import { TasksTable } from "./TasksTable";
import { BacklogsList } from "./BacklogsList";
import { AddMultipleTasksForm } from "./AddMultipleTasksForm";
import { EpicsList } from "./EpicsList";
import { EpicsTree } from "./EpicsTree";
import TableBlock from "./TableBlock";

interface ProjectFile {
  name: string;
  path: string;
  lastCommit: string;
  lastUpdate: string;
  displayName?: string;
  meta?: any;
}

interface SprintDeskProject {
  name: string;
  path: string;
  lastCommit: string;
  lastUpdate: string;
  backlogs: ProjectFile[];
  epics: ProjectFile[];
  sprints: ProjectFile[];
  tasks: ProjectFile[];
}

export interface IAppProps { }

export const App: React.FunctionComponent<IAppProps> = ({ }) => {
  const [message, setMessage] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [tasks, setTasks] = React.useState<{ task: string; epic: string; file: string }[]>([]);
  const [backlogs, setBacklogs] = React.useState<{ title: string; tasks: string[] }[]>([]);
  const [epics, setEpics] = React.useState<{ title: string; tasks: string[]; rawContent?: string; color?: string; meta?: Record<string, string> }[]>([]);
  const [view, setView] = React.useState<string | null>(null);
  const [showEpicsTree, setShowEpicsTree] = React.useState<boolean>(false);
  const [projects, setProjects] = React.useState<SprintDeskProject[]>([]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setView(params.get("view"));
  }, []);

  React.useEffect(() => {
    if (view === 'projects') {
      console.log('Requesting projects data from extension...');
        console.log('Current view is projects');
        const vscode = acquireVsCodeApiOnce();
        try {
          console.log('Sending REQUEST_PROJECTS message...');
          vscode.postMessage({ command: 'REQUEST_PROJECTS' });
        } catch (e) {
          console.error('Error requesting projects:', e);
          console.log('Falling back to sample data');
        // Show sample data for development
        setProjects([{
          name: 'Development Sample',
          path: 'sample/project',
          lastCommit: 'Initial commit',
          lastUpdate: 'today',
          backlogs: [
            { name: 'Sample Backlog 1', path: '.SprintDesk/backlogs/backlog1.md', lastCommit: 'Initial commit', lastUpdate: 'today' },
            { name: 'Sample Backlog 2', path: '.SprintDesk/backlogs/backlog2.md', lastCommit: 'Added feature', lastUpdate: 'yesterday' }
          ],
          epics: [
            { name: 'Sample Epic 1', path: '.SprintDesk/epics/epic1.md', lastCommit: 'Created epic', lastUpdate: 'today' }
          ],
          sprints: [
            { name: 'Sprint 1', path: '.SprintDesk/sprints/sprint1.md', lastCommit: 'Sprint planning', lastUpdate: 'today' }
          ],
          tasks: [
            { name: 'Task 1', path: '.SprintDesk/tasks/task1.md', lastCommit: 'Task created', lastUpdate: 'today' }
          ]
        }]);
      }
    }
  }, [view]);

  const requestOpenFile = (path: string) => {
    const vscode = acquireVsCodeApiOnce();
    try {
      vscode.postMessage({ command: 'REQUEST_OPEN_FILE', payload: { path } });
    } catch (_e) {
      // ignore in dev server
    }
  };

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, payload } = event.data;
      if (command === "SET_TASKS") setTasks(payload);
      else if (command === "SET_BACKLOGS") setBacklogs(payload);
      else if (command === "SET_EPICS") setEpics(payload);
      else if (command === "SET_PROJECTS") {
          console.log('Received SET_PROJECTS message:', payload);
        if (payload.projects) {
            console.log('Setting projects state with:', payload.projects);
          setProjects(payload.projects);
            console.log('Projects state updated');
        }
          else {
            console.log('No projects in payload');
          }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'showEpicsTree') {
        setShowEpicsTree(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  if (view === "addMultipleTasks") {
    return <AddMultipleTasksForm />;
  }

  if (showEpicsTree) {
    return <EpicsTree />;
  }

  if (view === "projects") {
    const currentProject = projects?.[0];
    return (
      <div className="app">
        <h1>Project Structure</h1>
        <TableBlock projects={projects} />
        {currentProject && (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ color: '#9ca3af' }}>Project files</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {currentProject.backlogs?.map((t, i) => (
                <button key={`b-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>📌</span>
                  {t.name}
                </button>
              ))}
              {currentProject.epics?.map((t, i) => (
                <button key={`e-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>🧩</span>
                  {t.name}
                </button>
              ))}
              {currentProject.sprints?.map((t, i) => (
                <button key={`s-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>⏱️</span>
                  {t.name}
                </button>
              ))}
              {currentProject.tasks?.map((t, i) => (
                <button key={`t-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>✅</span>
                  <div>
                    <div>{t.name}</div>
                    {t.meta?.status && <div style={{ fontSize: '12px', color: '#9ca3af' }}>Status: {t.meta.status}</div>}
                    {t.meta?.assignee && <div style={{ fontSize: '12px', color: '#9ca3af' }}>Assigned: {t.meta.assignee}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <h1>Sprint Desk v0.2.4</h1>
      <div className="app__actions">
        <button onClick={() => messageHandler.send("SET_TASKS", { msg: "Hello" })}>
          refresh tasks
        </button>
      </div>
      {message && <p><strong>Message:</strong> {message}</p>}
      {error && <p className="app__error"><strong>ERROR:</strong> {error}</p>}
      <TasksTable tasks={tasks} />
      <BacklogsList backlogs={backlogs} />
      <EpicsList epics={epics} />
    </div>
  );
}