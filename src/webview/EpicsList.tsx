// BacklogsList.tsx
import React from 'react';

interface Epic {
  title: string;
  tasks: string[];
}

interface EpicsListProps {
  epics: Epic[];
}

export const EpicsList: React.FC<EpicsListProps> = ({ epics }) => {
  if (epics.length === 0) return null;

  return (
    <div>

        {epics.map(({ title, tasks }, epicIndex) => (
          <div className="branch-container" key={`${title}-${epicIndex}`} style={{ marginBottom: '1rem' }}>
            <div className="branch-badge" style={{ alignSelf: "flex-start" }}>
              <img
                src="https://github.com/favicon.ico"
                alt="GitHub Icon"
                className="branch-icon"
              />
              <span className="branch-name">{title}</span>
              <span className="commit-count">+{tasks.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {tasks.map((task, taskIndex) => (
                <div style={{ display: "flex" }} key={`${task}-${taskIndex}`}>
                  <div className="avatar">📌</div>
                  <div className="commit-message">{task}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
};
