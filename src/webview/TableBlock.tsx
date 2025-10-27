/**
 * @file TableBlock.tsx
 * @description: Displays a file/folder-like table with expandable rows. Shows multiple projects
 *               at the same level, each with their own backlogs, epics, sprints, and tasks.
 *
 * @author khmammed
 * @version 0.0.4
 * @since 2025-10-27
 * @license iTTyni.com (Corp). All rights reserved.
 */

import React, { ReactElement, useMemo, useState, useEffect } from 'react';

// Define TypeScript interfaces
interface SprintDeskItem {
  name: string;
  lastCommit: string;
  lastUpdate: string;
}

interface SprintDeskProject {
  name: string;
  path: string;
  lastCommit: string;
  lastUpdate: string;
  backlogs: SprintDeskItem[];
  epics: SprintDeskItem[];
  sprints: SprintDeskItem[];
  tasks: SprintDeskItem[];
}

interface TableProps {
  projects?: SprintDeskProject[] | null;
}

const TableBlock: React.FC<TableProps> = ({ projects }) => {
  const [expandedItems, setExpandedItems] = useState<{ [key: string]: boolean }>({});

  const toggleExpand = (itemKey: string) => {
    setExpandedItems(prev => ({ ...prev, [itemKey]: !prev[itemKey] }));
  };

  const defaultProject: SprintDeskProject = {
    name: 'Project',
    path: '',
    lastCommit: 'init structure',
    lastUpdate: 'today',
    backlogs: [{ name: 'README.md', lastCommit: 'explain backlogs', lastUpdate: 'today' }],
    epics: [{ name: 'README.md', lastCommit: 'explain epics', lastUpdate: 'today' }],
    sprints: [{ name: 'README.md', lastCommit: 'explain sprints', lastUpdate: 'today' }],
    tasks: [{ name: 'README.md', lastCommit: 'explain tasks', lastUpdate: 'today' }]
  };

  // Enhanced folder structure with nested folders (demo fallback)
  const activeProjects = projects || [defaultProject];

  const getIcon = (category: string): string => {
    switch (category) {
      case 'backlogs': return '📌';
      case 'epics': return '🧩';
      case 'sprints': return '⏱️';
      case 'tasks': return '✅';
      case 'project': return '📂';
      case 'file': return '📄';
      default: return '📄';
    }
  };

  const renderItems = (items: SprintDeskItem[], projectName: string, category: string): ReactElement[] => {
    return items.map((item, index) => (
      <tr key={`${projectName}-${category}-${index}`} style={styles.itemStyle}>
        <td style={{ ...styles.cellStyle, paddingLeft: '60px' }}>
          <div style={styles.itemContentStyle}>
            <span style={{ fontSize: '16px' }}>{getIcon('file')}</span>
            <span>{item.name}</span>
          </div>
        </td>
        <td style={styles.cellStyle}>
          <div style={styles.commitStyle}>{item.lastCommit}</div>
        </td>
        <td style={styles.cellStyle}>
          <div style={styles.updateStyle}>{item.lastUpdate}</div>
        </td>
      </tr>
    ));
  };

  const renderCategory = (
    project: SprintDeskProject,
    category: 'backlogs' | 'epics' | 'sprints' | 'tasks'
  ): ReactElement => {
    const items = project[category];
    const categoryKey = `${project.name}-${category}`;
    const isExpanded = expandedItems[categoryKey];

    return (
      <React.Fragment key={categoryKey}>
        <tr style={styles.itemStyle} onClick={() => toggleExpand(categoryKey)}>
          <td style={{ ...styles.cellStyle, paddingLeft: '40px' }}>
            <div style={styles.itemContentStyle}>
              <span style={{ fontSize: '16px', cursor: 'pointer' }}>
                {isExpanded ? '▼' : '▶'} {getIcon(category)}
              </span>
              <span style={{ textTransform: 'capitalize' }}>{category}</span>
            </div>
          </td>
          <td style={styles.cellStyle}>
            <div style={styles.commitStyle}>{items.length} items</div>
          </td>
          <td style={styles.cellStyle}>
            <div style={styles.updateStyle}>{category}</div>
          </td>
        </tr>
        {isExpanded && renderItems(items, project.name, category)}
      </React.Fragment>
    );
  };

  // Define styles
  const styles = {
    container: {
      backgroundColor: '#f5f5f5',
      display: 'flex',
      justifyContent: 'center',
      margin: 0,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
    },
    tableContainer: {
      backgroundColor: 'black',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      overflow: 'hidden',
      width: '100%',
      minWidth: '400px',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
    },
    headerCell: {
      textAlign: 'left' as const,
      padding: '12px 16px',
      color: '#9ca3af',
      fontWeight: '500',
      borderBottom: '1px solid black',
    },
    itemStyle: {
      borderBottom: '1px solid black',
      transition: 'background-color 0.2s ease',
      backgroundColor: '#111827',
      cursor: 'pointer',
    },
    cellStyle: {
      padding: '12px 16px',
    },
    itemContentStyle: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: '#f3f4f6',
    },
    commitStyle: {
      color: '#d1d5db',
      maxWidth: '300px',
      whiteSpace: 'nowrap' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    updateStyle: {
      color: '#d1d5db',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.headerCell}>Name</th>
              <th style={styles.headerCell}>Last commit</th>
              <th style={styles.headerCell}>Last update</th>
            </tr>
          </thead>
          <tbody>
            {activeProjects.map((project) => (
              <React.Fragment key={project.name}>
                <tr
                  style={styles.itemStyle}
                  onClick={() => toggleExpand(`${project.name}-root`)}
                >
                  <td style={styles.cellStyle}>
                    <div style={styles.itemContentStyle}>
                      <span style={{ fontSize: '16px', cursor: 'pointer' }}>
                        {expandedItems[`${project.name}-root`] ? '▼' : '▶'} {getIcon('project')}
                      </span>
                      <span>{project.name}</span>
                    </div>
                  </td>
                  <td style={styles.cellStyle}>
                    <div style={styles.commitStyle}>{project.lastCommit}</div>
                  </td>
                  <td style={styles.cellStyle}>
                    <div style={styles.updateStyle}>{project.lastUpdate}</div>
                  </td>
                </tr>
                {expandedItems[`${project.name}-root`] && (
                  <>
                    {renderCategory(project, 'backlogs')}
                    {renderCategory(project, 'epics')}
                    {renderCategory(project, 'sprints')}
                    {renderCategory(project, 'tasks')}
                  </>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TableBlock;
