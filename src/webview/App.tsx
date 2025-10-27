// src/webview/App.tsx
import * as React from "react";
import { messageHandler } from "@estruyf/vscode/dist/client";
import { acquireVsCodeApiOnce } from "./vscodeApi";
import "./styles.css";
import { TasksTable } from "./TasksTable";
import { BacklogsList } from "./BacklogsList";
import { AddMultipleTasksForm } from "./AddMultipleTasksForm";
import { EpicsList } from "./EpicsList";
import { EpicsTree } from "../components/EpicsTree";
import TableBlock from "./TableBlock";


export interface IAppProps { }

export const App: React.FunctionComponent<IAppProps> = ({ }) => {
  const [message, setMessage] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [tasks, setTasks] = React.useState<{ task: string; epic: string; file: string }[]>([]);
  const [backlogs, setBacklogs] = React.useState<{ title: string; tasks: string[] }[]>([]);
  const [epics, setEpics] = React.useState<{ title: string; tasks: string[]; rawContent?: string; color?: string; meta?: Record<string, string> }[]>([]);
  const [view, setView] = React.useState<string | null>(null);
  const [showEpicsTree, setShowEpicsTree] = React.useState<boolean>(false);
  const [projects, setProjects] = React.useState<{
    projectName: string;
    backlogs: { name: string; lastCommit: string; lastUpdate: string }[];
    epics: { name: string; lastCommit: string; lastUpdate: string }[];
    sprints: { name: string; lastCommit: string; lastUpdate: string }[];
    tasks: { name: string; lastCommit: string; lastUpdate: string }[];
    parentProject?: {
      name: string;
      path: string;
      lastCommit: string;
      lastUpdate: string;
    };
    subProjects?: {
      name: string;
      path: string;
      lastCommit: string;
      lastUpdate: string;
      backlogs: { name: string; lastCommit: string; lastUpdate: string }[];
      epics: { name: string; lastCommit: string; lastUpdate: string }[];
      sprints: { name: string; lastCommit: string; lastUpdate: string }[];
      tasks: { name: string; lastCommit: string; lastUpdate: string }[];
    }[];
  } | null>(null);
  
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setView(params.get("view"));
  }, []);

  // When the projects view is opened, request the projects payload from the extension
  React.useEffect(() => {
    if (view === 'projects') {
      console.log('Requesting projects data from extension...');
      const vscode = acquireVsCodeApiOnce();
      try {
        vscode.postMessage({ command: 'REQUEST_PROJECTS' });
      } catch (e) {
        console.error('Error requesting projects:', e);
        // Show sample data for development
        setProjects({
          projectName: 'Development Sample',
          backlogs: [
            { name: 'Sample Backlog 1', lastCommit: 'Initial commit', lastUpdate: 'today' },
            { name: 'Sample Backlog 2', lastCommit: 'Added feature', lastUpdate: 'yesterday' }
          ],
          epics: [
            { name: 'Sample Epic 1', lastCommit: 'Created epic', lastUpdate: 'today' }
          ],
          sprints: [
            { name: 'Sprint 1', lastCommit: 'Sprint planning', lastUpdate: 'today' }
          ],
          tasks: [
            { name: 'Task 1', lastCommit: 'Task created', lastUpdate: 'today' }
          ]
        });
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
    console.log('Received projects:', payload);
    setProjects(payload);
  }
  else if (command === "SET_PROJECT_STRUCTURE") {
    const projectData = {
      projectName: payload.parentProject.name,
      backlogs: payload.parentProject.backlogs || [],
      epics: payload.parentProject.epics || [],
      sprints: payload.parentProject.sprints || [],
      tasks: payload.parentProject.tasks || [],
      parentProject: payload.parentProject,
      subProjects: payload.subProjects
    };
    console.log('Setting project structure:', projectData);
    setProjects(projectData);
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
    return <div className="app">
      <h1>Project Structure</h1>
      <TableBlock
        projects={projects ? [{
          name: projects.projectName || 'Project',
          path: '',
          lastCommit: 'initial commit',
          lastUpdate: 'today',
          backlogs: projects.backlogs || [],
          epics: projects.epics || [],
          sprints: projects.sprints || [],
          tasks: projects.tasks || []
        }] : null}
      />
      <div style={{ marginTop: 12 }}>
        <h3 style={{ color: '#9ca3af' }}>Project files</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {projects?.backlogs?.map((t: any, i: number) => (
            <button key={`b-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>📌</span>
              {t.name}
            </button>
          ))}
          {projects?.epics?.map((t: any, i: number) => (
            <button key={`e-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>🧩</span>
              {t.name}
            </button>
          ))}
          {projects?.sprints?.map((t: any, i: number) => (
            <button key={`s-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>⏱️</span>
              {t.name}
            </button>
          ))}
          {projects?.tasks?.map((t: any, i: number) => (
            <button key={`t-${i}`} onClick={() => requestOpenFile(t.path)} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>✅</span>
              <div>
                <div>{t.name}</div>
                {t.status && <div style={{ fontSize: '12px', color: '#9ca3af' }}>Status: {t.status}</div>}
                {t.assignee && <div style={{ fontSize: '12px', color: '#9ca3af' }}>Assigned: {t.assignee}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>;
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
