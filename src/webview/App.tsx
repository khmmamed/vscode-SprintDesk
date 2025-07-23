// src/webview/App.tsx
import * as React from "react";
import { messageHandler } from "@estruyf/vscode/dist/client";
import "./styles.css";
import { TasksTable } from "./TasksTable";
import { BacklogsList } from "./BacklogsList";
import { AddMultipleTasksForm } from "./AddMultipleTasksForm";


export interface IAppProps {}

export const App: React.FunctionComponent<IAppProps> = ({}) => {
  const [message, setMessage] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [tasks, setTasks] = React.useState<{ task: string; epic: string; file: string }[]>([]);
  const [backlogs, setBacklogs] = React.useState<{ title: string; tasks: string[] }[]>([]);

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
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (view === "addMultipleTasks") {
    return <AddMultipleTasksForm />;
  }

  return (
    <div className="app">
      <h1>Hello from the React Webview Starter</h1>
      <div className="app__actions">
        <button onClick={() => messageHandler.send("POST_DATA", { msg: "Hello" })}>
          Send message
        </button>

      </div>
      {message && <p><strong>Message:</strong> {message}</p>}
      {error && <p className="app__error"><strong>ERROR:</strong> {error}</p>}
      <TasksTable tasks={tasks} />
      <BacklogsList backlogs={backlogs} />
    </div>
  );
};