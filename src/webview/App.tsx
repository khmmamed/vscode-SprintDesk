// src/webview/App.tsx
import * as React from "react";
import { messageHandler } from "@estruyf/vscode/dist/client";
import "./styles.css";
import { TasksTable } from "./TasksTable";
import { BacklogsList } from "./BacklogsList";
import { AddMultipleTasksForm } from "./AddMultipleTasksForm";
import { EpicsList } from "./EpicsList";


export interface IAppProps {}

export const App: React.FunctionComponent<IAppProps> = ({}) => {
  const [message, setMessage] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [tasks, setTasks] = React.useState<{ task: string; epic: string; file: string }[]>([]);
  const [backlogs, setBacklogs] = React.useState<{ title: string; tasks: string[] }[]>([]);
  const [epics, setEpics] = React.useState<{ title: string; tasks: string[] }[]>([]);
  const [view, setView] = React.useState<string | null>(null);
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setView(params.get("view"));
  }, []);

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, payload } = event.data;
      if (command === "SET_TASKS") setTasks(payload);
      else if (command === "SET_BACKLOGS") setBacklogs(payload);
      else if (command === "SET_EPICS") setEpics(payload);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (view === "addMultipleTasks") {
    return <AddMultipleTasksForm />;
  }

  return (
    <div className="app">
      <h1>Sprint Desk v0.0.4</h1>
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
};