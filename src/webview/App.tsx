import * as React from "react";
import { messageHandler } from "@estruyf/vscode/dist/client";
import "./styles.css";
import { TasksTable } from "./TasksTable";
import { BacklogsList } from "./BacklogsList";

export interface IAppProps { }

export const App: React.FunctionComponent<IAppProps> = ({ }: React.PropsWithChildren<IAppProps>) => {
  const [message, setMessage] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [tasks, setTasks] = React.useState<{ task: string; epic: string; file: string }[]>([]);
  const [backlogs, setBacklogs] = React.useState<{ title: string; tasks: string[] }[]>([]);
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, payload } = event.data;
      if (command === "SET_TASKS") {
        setTasks(payload);
      } else if (command === "SET_BACKLOGS") {
        setBacklogs(payload);
        // By default collapse all
        const defaultExpanded: Record<string, boolean> = {};
        payload.forEach((b: { title: string }) => {
          defaultExpanded[b.title] = false;
        });
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const { command, payload } = event.data;
      if (command === "SET_BACKLOGS") {
        setBacklogs(event.data.payload);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const sendMessage = () => {
    messageHandler.send("POST_DATA", { msg: "Hello from the webview" });
  };

  const requestData = () => {
    messageHandler.request<string>("GET_DATA").then((msg) => {
      setMessage(msg);
    });
  };

  const requestWithErrorData = () => {
    messageHandler
      .request<string>("GET_DATA_ERROR")
      .then((msg) => {
        setMessage(msg);
      })
      .catch((err) => {
        setError(err);
      });
  };

  return (
    <div className="app">
      <h1>Hello from the React Webview Starter</h1>

      <div className="app__actions">
        <button onClick={sendMessage}>Send message to extension</button>
        <button onClick={requestData}>Get data from extension</button>
        <button onClick={requestWithErrorData}>Get data with error</button>
      </div>

      {message && (
        <p>
          <strong>Message from the extension</strong>: {message}
        </p>
      )}

      {error && <p className='app__error'><strong>ERROR</strong>: {error}</p>}

       {/* Use the new components */}
      <TasksTable tasks={tasks} />
      <BacklogsList backlogs={backlogs} />
    </div>
  );
};