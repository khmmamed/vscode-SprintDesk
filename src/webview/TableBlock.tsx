/**
 * @file TableBlock.tsx
 * @description: Displays a file/folder-like table with expandable rows. Includes a top-level
 *               Project folder that expands to show backlogs, epics, sprints, tasks.
 *
 * @author khmammed
 * @version 0.0.3
 * @since 2025-10-25
 * @license iTTyni.com (Corp). All rights reserved.
 */

import React, { ReactElement, useMemo, useState } from 'react';

// Define TypeScript interfaces
interface FileNode {
  name: string;
  lastCommit: string;
  lastUpdate: string;
  isFolder?: boolean;
  isOpen?: boolean;
  children?: FileNode[];
}

interface TableProps {
  projectName?: string | null;
  backlogs?: { name: string; lastCommit: string; lastUpdate: string }[] | null;
  epics?: { name: string; lastCommit: string; lastUpdate: string }[] | null;
  sprints?: { name: string; lastCommit: string; lastUpdate: string }[] | null;
  tasks?: { name: string; lastCommit: string; lastUpdate: string }[] | null;
}

const TableBlock: React.FC<TableProps> = ({ projectName, backlogs, epics, sprints, tasks }) => {
  // Build dynamic project structure if data provided; otherwise fall back to demo data
  const dynamicFiles: FileNode[] | null = useMemo(() => {
    if (!backlogs && !epics && !sprints && !tasks) return null;
    const mapToNodes = (arr?: { name: string; lastCommit: string; lastUpdate: string }[] | null): FileNode[] =>
      (arr || []).map((f) => ({ name: f.name, lastCommit: f.lastCommit || '', lastUpdate: f.lastUpdate || '', isFolder: false }));
    return [
      {
        name: projectName || 'Project',
        lastCommit: '',
        lastUpdate: new Date().toLocaleDateString(),
        isFolder: true,
        isOpen: true,
        children: [
          { name: 'backlogs', lastCommit: '', lastUpdate: '', isFolder: true, isOpen: true, children: mapToNodes(backlogs) },
          { name: 'epics', lastCommit: '', lastUpdate: '', isFolder: true, isOpen: true, children: mapToNodes(epics) },
          { name: 'sprints', lastCommit: '', lastUpdate: '', isFolder: true, isOpen: true, children: mapToNodes(sprints) },
          { name: 'tasks', lastCommit: '', lastUpdate: '', isFolder: true, isOpen: true, children: mapToNodes(tasks) },
        ],
      },
    ];
  }, [projectName, backlogs, epics, sprints, tasks]);

  // Enhanced folder structure with nested folders (demo fallback)
  const initialFiles: FileNode[] = dynamicFiles || [
    // Added top-level Project folder with requested sub-folders
    {
      name: 'Project',
      lastCommit: 'init structure',
      lastUpdate: 'today',
      isFolder: true,
      isOpen: true,
      children: [
        {
          name: 'backlogs',
          lastCommit: 'init',
          lastUpdate: 'today',
          isFolder: true,
          isOpen: false,
          children: [
            { name: 'README.md', lastCommit: 'explain backlogs', lastUpdate: 'today' },
          ],
        },
        {
          name: 'epics',
          lastCommit: 'init',
          lastUpdate: 'today',
          isFolder: true,
          isOpen: false,
          children: [
            { name: 'README.md', lastCommit: 'explain epics', lastUpdate: 'today' },
          ],
        },
        {
          name: 'sprints',
          lastCommit: 'init',
          lastUpdate: 'today',
          isFolder: true,
          isOpen: false,
          children: [
            { name: 'README.md', lastCommit: 'explain sprints', lastUpdate: 'today' },
          ],
        },
        {
          name: 'tasks',
          lastCommit: 'init',
          lastUpdate: 'today',
          isFolder: true,
          isOpen: false,
          children: [
            { name: 'README.md', lastCommit: 'explain tasks', lastUpdate: 'today' },
          ],
        },
      ],
    }
  ];

  const [files, setFiles] = useState<FileNode[]>(initialFiles);

  const toggleFolder = (path: string): void => {
    const pathParts = path.split('-').map(Number);
    const current: FileNode[] = [...files];

    // Navigate immutably through the tree to the target node and toggle isOpen
    const newFiles = [...current];

    let ref: FileNode[] = newFiles;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const idx = pathParts[i];
      if (ref[idx] && ref[idx].children) {
        // Ensure we clone the level to avoid mutating nested arrays across renders
        ref[idx] = { ...ref[idx], children: [...(ref[idx].children as FileNode[])] };
        ref = ref[idx].children as FileNode[];
      }
    }

    const lastIndex = pathParts[pathParts.length - 1];
    if (ref[lastIndex]) {
      ref[lastIndex] = { ...ref[lastIndex], isOpen: !ref[lastIndex].isOpen };
    }

    setFiles(newFiles);
  };

  const getFileIcon = (file: FileNode): string => {
    if (file.isFolder) {
      // Custom icons for project subfolders
      if (['backlogs', 'epics', 'sprints', 'tasks'].includes(file.name)) {
        switch (file.name) {
          case 'backlogs':
            return '📌';
          case 'epics':
            return '🧩';
          case 'sprints':
            return '⏱️';
          case 'tasks':
            return '✅';
        }
      }
      return file.isOpen ? '📂' : '📁';
    } else if (file.name === '.gitignore') {
      return '⚙️';
    } else if (file.name === '.gitlab-ci.yml') {
      return '🚀';
    } else if (file.name === 'README.md') {
      return '📘';
    } else if (file.name === 'eslint.config.mjs') {
      return '✅';
    } else if (file.name === 'next.config.ts') {
      return '🔷';
    } else if (file.name === 'package-lock.json' || file.name === 'package.json') {
      return '📦';
    } else if (file.name === 'store.dev.sh' || file.name === 'store.prod.sh') {
      return '⚡';
    } else if (file.name === 'tsconfig.json') {
      return '{}{}';
    } else if (file.name.endsWith('.md')) {
      return '📝';
    } else if (file.name.endsWith('.json')) {
      return '📋';
    } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
      return '_TS_';
    } else if (file.name.endsWith('.sh')) {
      return '🐚';
    } else if (file.name.endsWith('.pdf')) {
      return '📄';
    } else if (
      file.name.endsWith('.svg') ||
      file.name.endsWith('.png') ||
      file.name.endsWith('.jpg') ||
      file.name.endsWith('.jpeg') ||
      file.name.endsWith('.gif')
    ) {
      return '🖼️';
    } else if (file.name.endsWith('.txt')) {
      return '📃';
    } else {
      return '📄';
    }
  };

  const renderRow = (
    file: FileNode,
    basePath: string,
    depth: number = 0
  ): ReactElement => {
    const paddingLeft = `${depth * 20 + 16}px`;
    const currentPath = basePath;

    return (
      <React.Fragment key={currentPath}>
        <tr
          style={{
            borderBottom: '1px solid black',
            transition: 'background-color 0.2s ease',
            backgroundColor: '#111827',
            cursor: file.isFolder ? 'pointer' : 'default',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1f2937')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#111827')}
          onClick={() => file.isFolder && toggleFolder(currentPath)}
        >
          <td style={{ padding: `12px ${paddingLeft}`, position: 'relative' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#f3f4f6',
              }}
            >
              <span style={{ fontSize: '18px' }}>{getFileIcon(file)}</span>
              <span>{file.name}</span>
            </div>
          </td>
          <td style={{ padding: '12px 16px' }}>
            <div
              style={{
                color: '#d1d5db',
                maxWidth: '300px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {file.lastCommit}
            </div>
          </td>
          <td style={{ padding: '12px 16px' }}>
            <div style={{ color: '#d1d5db' }}>{file.lastUpdate}</div>
          </td>
        </tr>

        {file.isFolder &&
          file.isOpen &&
          file.children &&
          file.children.map((child, childIndex) =>
            renderRow(child, `${currentPath}-${childIndex}`, depth + 1)
          )}
      </React.Fragment>
    );
  };

  return (
    <div
      style={{
        backgroundColor: '#f5f5f5',
        display: 'flex',
        justifyContent: 'center',
        margin: 0,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: 'black',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
          width: '100%',
          minWidth: '400px',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '12px 16px',
                  color: '#9ca3af',
                  fontWeight: '500',
                  borderBottom: '1px solid black',
                }}
              >
                Name
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '12px 16px',
                  color: '#9ca3af',
                  fontWeight: '500',
                  borderBottom: '1px solid black',
                }}
              >
                Last commit
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '12px 16px',
                  color: '#9ca3af',
                  fontWeight: '500',
                  borderBottom: '1px solid black',
                }}
              >
                Last update
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map((file, index) => renderRow(file, index.toString()))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TableBlock;
