// src/webview/AddMultipleTasksForm.tsx
import React, { useState } from "react";
import { BacklogsList } from "./BacklogsList";
import { acquireVsCodeApiOnce } from "./vscodeApi";

import { PROJECT } from '../utils/constant';
import { parseTaskMetadataFromFilename } from '../utils/templateUtils';

// Helper: Extract Epic name from filename
function extractEpic(task: string): string {
  try {
    const { epicName } = parseTaskMetadataFromFilename(task);
    return epicName || "Uncategorized";
  } catch (error) {
    return "Uncategorized";
  }
}

export const AddMultipleTasksForm: React.FC = () => {
  const [input, setInput] = useState<string>("");
  const vscode = acquireVsCodeApiOnce();
  if (!vscode) {
    return <div>Error: VS Code API not available.</div>;
  }
  // Split input into lines
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Group tasks by Epic
  const backlogs: any[] = lines.length
    ? Object.entries(
        lines.reduce<Record<string, string[]>>((acc, task) => {
          const epic = extractEpic(task);
          if (!acc[epic]) acc[epic] = [];
          acc[epic].push(task);
          return acc;
        }, {})
      ).map(([epic, tasks]) => ({
        title: `Epic: ${epic}`,
        tasks,
      }))
    : [];

  const handleSubmit = () => {
    if (lines.length === 0) {
      alert("Please enter at least one task.");
      return;
    }
    vscode.postMessage({
      command: "validateTasks",
      payload: lines,
    });
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h2>➕ Add Multiple Tasks</h2>
      <p>
        Enter one task per line (e.g., <code>{PROJECT.FILE_PREFIX.TASK}name_{PROJECT.FILE_PREFIX.EPIC}parent.md</code>):
      </p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={`${PROJECT.FILE_PREFIX.TASK}add-title_${PROJECT.FILE_PREFIX.EPIC}product.md
${PROJECT.FILE_PREFIX.TASK}add-description_${PROJECT.FILE_PREFIX.EPIC}product.md
${PROJECT.FILE_PREFIX.TASK}fix-login_${PROJECT.FILE_PREFIX.EPIC}auth.md`}
        style={{
          width: "100%",
          height: "180px",
          padding: "12px",
          border: "1px solid #ddd",
          borderRadius: "6px",
          fontFamily: "monospace",
          marginBottom: "16px",
        }}
        autoFocus
      />
      <button
        onClick={handleSubmit}
        style={{
          backgroundColor: "#1a73e8",
          color: "white",
          border: "none",
          padding: "10px 16px",
          borderRadius: "6px",
          cursor: "pointer",
        }}
      >
        ✅ Validate & Create Tasks
      </button>

      <div style={{ marginTop: "20px" }}>
        {backlogs.length > 0 ? (
          backlogs.map((backlog, idx) => (
            <div key={idx} style={{ marginBottom: "2rem" }}>
              <BacklogsList backlogs={[backlog]} />
            </div>
          ))
        ) : (
          <p style={{ color: "#777", fontStyle: "italic" }}>No tasks to preview</p>
        )}
      </div>
    </div>
  );
};