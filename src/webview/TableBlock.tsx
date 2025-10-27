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
import { acquireVsCodeApiOnce } from './vscodeApi';

// Define TypeScript interfaces
interface SprintDeskItem {
  name: string;
  path?: string;
  lastCommit: string;
  lastUpdate: string;
  meta?: any;
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
  const [editingItems, setEditingItems] = useState<{ [key: string]: boolean }>({});
  const [editedTables, setEditedTables] = useState<{ [key: string]: { headers: string[]; rows: string[][] } }>({});

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

  const getStatusColor = (status: any) => {
    if (!status) return '#94a3b8';
    const s = String(status).toLowerCase();
    if (['done', 'complete', 'closed', 'true', 'yes'].includes(s)) return '#86efac'; // green
    if (['in progress', 'progress', 'doing'].includes(s)) return '#facc15'; // yellow
    if (['blocked', 'stalled', 'failed', 'no'].includes(s)) return '#f87171'; // red
    return '#94a3b8'; // gray
  };

  const parseSprintDates = (item: SprintDeskItem) => {
    // First try to get dates from meta.sprint
    if (item.meta?.sprint?.start && item.meta?.sprint?.end) {
      return {
        startDate: item.meta.sprint.start,
        endDate: item.meta.sprint.end
      };
    }
    
    // If not found in meta, try to parse from filename or path
    const datePattern = /\[Sprint\]_(\d{2})-(\d{2})_(\d{2})-(\d{2})_(\d{4})/;
    const match = item.name.match(datePattern) || item.path?.match(datePattern);
    
    if (match) {
      const [_, startDay, startMonth, endDay, endMonth, year] = match;
      return {
        startDate: `${year}-${startMonth}-${startDay}`,
        endDate: `${year}-${endMonth}-${endDay}`
      };
    }
    
    return null;
  };

  const getSprintStatus = (startDate: string, endDate: string): { status: string; color: string } => {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (now < start) {
      return { status: 'Upcoming', color: '#1f2937' };
    } else if (now > end) {
      return { status: 'Closed', color: '#065f46' };
    } else {
      return { status: 'In Progress', color: '#1e3a8a' };
    }
  };

  const renderItems = (items: SprintDeskItem[], projectName: string, category: string): ReactElement[] => {
    const vscode = acquireVsCodeApiOnce();
    return items.flatMap((item, index) => {
      const itemKey = `${projectName}-${category}-${index}-details`;
      const isDetailsExpanded = !!expandedItems[itemKey];
      const isEditing = !!editingItems[itemKey];

      const startEditing = () => {
        if (item.meta && item.meta.sprintTable) {
          const rowsCopy = (item.meta.sprintTable.rows as string[][]).map((r: string[]) => r.slice());
          setEditedTables(prev => ({ ...prev, [itemKey]: { headers: (item.meta.sprintTable.headers as string[]).slice(), rows: rowsCopy } }));
          setEditingItems(prev => ({ ...prev, [itemKey]: true }));
        }
      };

      const cancelEditing = () => {
        setEditingItems(prev => ({ ...prev, [itemKey]: false }));
        setEditedTables(prev => {
          const copy = { ...prev };
          delete copy[itemKey];
          return copy;
        });
      };

      const saveEditing = () => {
        const table = editedTables[itemKey];
        if (!table) return;
        // build markdown table
        const headerLine = '| ' + table.headers.join(' | ') + ' |';
        const sepLine = '|' + table.headers.map(() => ' --- ').join('|') + '|';
        const rows = table.rows.map(r => '| ' + table.headers.map((_, ci) => (r[ci] || '')).join(' | ') + ' |');
        const md = [headerLine, sepLine, ...rows].join('\n');
        try {
          vscode.postMessage({ command: 'SAVE_SPRINT_TABLE', payload: { path: item.path, content: md } });
        } catch (e) {
          console.error('Failed to post save message', e);
        }
        // optimistic UI: stop editing
        setEditingItems(prev => ({ ...prev, [itemKey]: false }));
      };

      const row = (
        <tr
          key={`${projectName}-${category}-${index}`}
          style={styles.itemStyle}
          onClick={() => {
            // open file when clicking the row (dev/mock-safe)
            try {
              if (item.path) {
                vscode.postMessage({ command: 'REQUEST_OPEN_FILE', payload: { path: item.path } });
              }
            } catch (e) {
              // ignore in dev
            }
          }}
        >
          <td style={{ ...styles.cellStyle, paddingLeft: '60px' }}>
            <div style={styles.itemContentStyle}>
              {category === 'sprints' && item.meta && item.meta.sprintTable ? (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(itemKey);
                  }}
                  style={{ fontSize: '14px', cursor: 'pointer', userSelect: 'none' }}
                >
                  {isDetailsExpanded ? '▼' : '▶'}
                </span>
              ) : (
                <span style={{ fontSize: '16px' }}>{getIcon('file')}</span>
              )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{item.name}</span>
                    {category === 'sprints' && (
                      (() => {
                        const dates = parseSprintDates(item);
                        if (!dates) return null;
                        const { startDate, endDate } = dates;
                        
                        if (startDate && endDate) {
                          const { status, color } = getSprintStatus(startDate, endDate);
                          const styleMap: any = {
                            Closed: { bg: '#065f46', fg: '#10b981', border: '#064e3b' },
                            'In Progress': { bg: '#1e3a8a', fg: '#60a5fa', border: '#1e40af' },
                            Upcoming: { bg: '#1f2937', fg: '#9ca3af', border: '#374151' }
                          };
                          const c = styleMap[status] || styleMap['In Progress'];
                          return (
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: c.bg,
                              color: c.fg,
                              border: `1px solid ${c.border}`,
                              fontSize: 12,
                              fontWeight: 600,
                              whiteSpace: 'nowrap'
                            }}>{status}</span>
                          );
                        }
                        return null;
                      })()
                    )}
                  </div>
                  {item.path && (
                    <span style={{
                      fontSize: '12px',
                      color: '#9ca3af',
                      opacity: 0.8
                    }}>
                      {item.path}
                    </span>
                  )}
                </div>
            </div>
          </td>
                    <td style={styles.cellStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {category === 'sprints' && item.meta ? (() => {
                const startDate = item.meta?.startDate || item.meta?.sprintTime?.startDate;
                const endDate = item.meta?.endDate || item.meta?.sprintTime?.endDate;
                
                if (startDate && endDate) {
                  const { status } = getSprintStatus(startDate, endDate);
                  const styleMap: any = {
                    Closed: { bg: '#065f46', fg: '#10b981', border: '#064e3b' },
                    'In Progress': { bg: '#1e3a8a', fg: '#60a5fa', border: '#1e40af' },
                    Upcoming: { bg: '#1f2937', fg: '#9ca3af', border: '#374151' }
                  };
                  const c = styleMap[status] || styleMap['In Progress'];
                  return (
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: c.bg,
                      color: c.fg,
                      border: `1px solid ${c.border}`,
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: 'nowrap'
                    }}>{status}</span>
                  );
                }
                return null;
              })() : null}
              <div style={styles.commitStyle}>{item.lastCommit}</div>
            </div>
          </td>
          <td style={styles.cellStyle}>
            {category === 'sprints' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ height: 8, background: '#374151', borderRadius: 4, overflow: 'hidden', width: '120px' }}>
                  <div style={{ 
                    height: '100%', 
                    background: '#10b981', 
                    width: '65%'
                  }} />
                </div>
                <div style={{ color: '#9ca3af', fontSize: 12 }}>
                  65% complete
                </div>
              </div>
            ) : (
              <div style={styles.updateStyle}>{item.lastUpdate}</div>
            )}
          </td>
        </tr>
      );

      const details: ReactElement[] = [];
        if (isDetailsExpanded && category === 'sprints' && item.meta && item.meta.sprintTable) {
        const table = (isEditing && editedTables[itemKey]) ? editedTables[itemKey] : (item.meta.sprintTable as { headers: string[]; rows: string[][] });
        // header row for table
        details.push(
          <tr key={`${projectName}-${category}-${index}-hdr`} style={{ background: '#0f172a' }}>
            <td colSpan={3} style={{ padding: '8px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600 }}>{item.name} — Tasks</div>
                <div>
                  {!isEditing && <button onClick={(e) => { e.stopPropagation(); startEditing(); }} style={{ marginRight: 8, padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4 }}>Edit</button>}
                  {isEditing && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); saveEditing(); }} style={{ marginRight: 8, padding: '6px 8px', background: '#065f46', color: '#fff', border: 'none', borderRadius: 4 }}>Save</button>
                      <button onClick={(e) => { e.stopPropagation(); cancelEditing(); }} style={{ padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4 }}>Cancel</button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {table.headers.map((h, hi) => (
                        <th key={`h-${hi}`} style={{ textAlign: 'left', padding: '6px 8px', color: '#9ca3af', fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r, ri) => (
                      <tr key={`r-${ri}`} style={{ borderTop: '1px solid #111827' }}>
                        {table.headers.map((_, ci) => {
                          const cell = r[ci] || '';
                          // If editing, render inputs
                          if (isEditing) {
                            return (
                              <td key={`c-${ci}`} style={{ padding: '6px 8px' }}>
                                <input
                                  value={cell}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditedTables(prev => {
                                      const copy = { ...prev };
                                      const tbl = copy[itemKey];
                                      if (!tbl) return prev;
                                      // ensure row exists
                                      tbl.rows[ri] = tbl.rows[ri] || [];
                                      tbl.rows[ri][ci] = val;
                                      return copy;
                                    });
                                  }}
                                  style={{ width: '100%', padding: '6px 8px', background: '#0b1220', color: '#d1d5db', border: '1px solid #111827', borderRadius: 4 }}
                                />
                              </td>
                            );
                          }

                          // Not editing: render cell, make clickable if looks like path or header is "path"
                          const headerLower = (table.headers[ci] || '').toLowerCase();
                          const looksLikePath = typeof cell === 'string' && (cell.includes('/') || cell.endsWith('.md'));
                          return (
                            <td key={`c-${ci}`} style={{ padding: '6px 8px', color: '#d1d5db', fontSize: 13 }}>
                              {(headerLower === 'path' || looksLikePath) ? (
                                <button onClick={(e) => { e.stopPropagation(); try { if (cell) { const vscode = acquireVsCodeApiOnce(); vscode.postMessage({ command: 'REQUEST_OPEN_FILE', payload: { path: cell } }); } } catch (_) {} }} style={{ background: 'transparent', color: '#60a5fa', border: 'none', padding: 0, cursor: 'pointer' }}>{cell}</button>
                              ) : (
                                // color-coded status chip
                                headerLower === 'status' || headerLower === 'state' ? (
                                  <span style={{ padding: '4px 8px', borderRadius: 999, background: getStatusColor(cell), color: '#000', fontWeight: 600, fontSize: 12 }}>{cell}</span>
                                ) : (
                                  <span>{cell}</span>
                                )
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        );
      }

      return [row, ...details];
    });
  };

  const renderCategory = (
    project: SprintDeskProject,
    category: 'backlogs' | 'epics' | 'sprints' | 'tasks'
  ): ReactElement => {
    const items = project[category];
    const categoryKey = `${project.name}-${category}`;
    const isExpanded = expandedItems[categoryKey];
    const categoryPath = `${project.path}/.SprintDesk/${category}`;
    console.log('items', items);
    return (
      <React.Fragment key={categoryKey}>
        <tr style={styles.itemStyle} onClick={() => toggleExpand(categoryKey)}>
          <td style={{ ...styles.cellStyle, paddingLeft: '40px' }}>
            <div style={styles.itemContentStyle}>
              <span style={{ fontSize: '16px', cursor: 'pointer' }}>
                {isExpanded ? '▼' : '▶'} {getIcon(category)}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ textTransform: 'capitalize' }}>{category}</span>
                <span style={{ 
                  fontSize: '12px', 
                  color: '#9ca3af',
                  opacity: 0.8 
                }}>
                  {categoryPath}
                </span>
              </div>
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>{project.name}</span>
                        {project.path && (
                          <span style={{ 
                            fontSize: '12px', 
                            color: '#9ca3af',
                            opacity: 0.8 
                          }}>
                            {project.path}
                          </span>
                        )}
                      </div>
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
