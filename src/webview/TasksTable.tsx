// TasksTable.tsx
import React from 'react';

interface Task {
  task: string;
  epic: string;
  file: string;
}

interface TasksTableProps {
  tasks: Task[];
}

export const TasksTable: React.FC<TasksTableProps> = ({ tasks }) => {
  if (tasks.length === 0) return null;

  return (
    <div>
      <h2>Task Table</h2>
      <table className="sprintdesk-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Epic</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task, idx) => (
            <tr key={idx}>
              <td>{task.task}</td>
              <td>{task.epic}</td>
              <td>{task.file}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
