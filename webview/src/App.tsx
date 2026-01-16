import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef, SelectionChangedEvent } from 'ag-grid-community';
import Editor from '@monaco-editor/react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

// Chart colors for multiple series
const CHART_COLORS = [
  '#0078d4', '#107c10', '#d83b01', '#5c2d91', '#008272',
  '#ffb900', '#e81123', '#0063b1', '#00cc6a', '#ff8c00'
];

// SVG Icons as components
const ChevronLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" d="M10.354 3.146a.5.5 0 0 1 0 .708L6.207 8l4.147 4.146a.5.5 0 0 1-.708.708l-4.5-4.5a.5.5 0 0 1 0-.708l4.5-4.5a.5.5 0 0 1 .708 0z" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" d="M5.646 3.146a.5.5 0 0 1 .708 0l4.5 4.5a.5.5 0 0 1 0 .708l-4.5 4.5a.5.5 0 0 1-.708-.708L9.793 8 5.646 3.854a.5.5 0 0 1 0-.708z" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-.5H3v10h10V6a.5.5 0 0 1 1 0v6.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9.5z" />
    <path d="M12.354 1.646a.5.5 0 0 1 0 .708L7.707 7H10.5a.5.5 0 0 1 0 1H6a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 1 0v2.793l4.646-4.647a.5.5 0 0 1 .708 0z" />
  </svg>
);

const TableIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 0 0 1-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 0 0 1 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z" />
  </svg>
);

const ChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 11H2v3h2v-3zm5-4H7v7h2V7zm5-5h-2v12h2V2zm-2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1h-2zM6 7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zm-5 4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-3z" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z" />
    <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
    <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
  </svg>
);

// Visualization type from Kusto render operator
interface KustoVisualization {
  type: string;
  xColumn?: string;
  yColumns?: string[];
  series?: string;
  title?: string;
  xTitle?: string;
  yTitle?: string;
  legend?: string;
  yScale?: string;
}

type QueryStatus = 'running' | 'success' | 'error' | 'cancelled';

// Execution info synced from extension (lightweight, no result data)
interface SerializedExecution {
  id: string;
  cluster: string;
  database: string;
  originalQuery: string;
  startTime: number;  // milliseconds since epoch
  endTime: number | undefined;  // milliseconds since epoch, or undefined
  status: QueryStatus;
  totalRows?: number;
  errorMessage?: string;
}

// Full data for a specific execution (fetched on demand)
interface ExecutionFullData {
  id: string;
  cluster: string;
  database: string;
  originalQuery: string;
  resolvedQuery: string;
  startTime: number;
  endTime: number | undefined;
  status: QueryStatus;
  result?: {
    columns: string[];
    rows: unknown[][];
    totalRows: number;
    resolvedQuery: string;
    visualization?: KustoVisualization;
  };
  errorMessage?: string;
}

// Types for messages from VS Code extension
interface QueryResultMessage {
  type: 'queryResult';
  data: {
    columns: string[];
    rows: unknown[][];
    totalRows: number;
    cluster: string;
    database: string;
    timestamp: string;
    originalQuery: string;
    resolvedQuery: string;
    visualization?: KustoVisualization;
  };
}

interface QueryErrorMessage {
  type: 'queryError';
  data: {
    error: string;
    cluster: string;
    database: string;
    timestamp: string;
    originalQuery: string;
    resolvedQuery: string;
  };
}

interface HistorySyncMessage {
  type: 'historySync';
  data: {
    executions: SerializedExecution[];
    selectedId: string | null;
  };
}

interface FullDataMessage {
  type: 'fullData';
  id: string;
  data: ExecutionFullData;
}

interface EjectedEditorClosedMessage {
  type: 'ejectedEditorClosed';
}

type WebviewMessage = QueryResultMessage | QueryErrorMessage | HistorySyncMessage | FullDataMessage | EjectedEditorClosedMessage;

// Declare VS Code API
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type ViewMode = 'table' | 'chart';

function App() {
  const [resultData, setResultData] = useState<QueryResultMessage['data'] | null>(null);
  const [errorData, setErrorData] = useState<QueryErrorMessage['data'] | null>(null);
  const [selectedRows, setSelectedRows] = useState<Record<string, unknown>[]>([]);
  const [showSidePanel, setShowSidePanel] = useState(true);
  const [isEjected, setIsEjected] = useState(false);
  const [panelWidth, setPanelWidth] = useState(350);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [executions, setExecutions] = useState<SerializedExecution[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [cachedFullData, setCachedFullData] = useState<Map<string, ExecutionFullData>>(new Map());
  const [showHistory, setShowHistory] = useState(false);
  const [, setTick] = useState(0); // For forcing re-renders for elapsed time
  const gridRef = useRef<AgGridReact>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Find currently running query (if any)
  const runningExecution = executions.find(e => e.status === 'running');
  const selectedExecution = executions.find(e => e.id === selectedExecutionId);

  // Determine if visualization is available and what type
  const hasVisualization = resultData?.visualization &&
    resultData.visualization.type &&
    resultData.visualization.type !== 'table';

  // Auto-switch to chart view when visualization is present
  useEffect(() => {
    if (hasVisualization) {
      setViewMode('chart');
    } else {
      setViewMode('table');
    }
  }, [hasVisualization]);

  // Update elapsed time ticker while a query is running
  useEffect(() => {
    if (!runningExecution) {
      return;
    }

    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 100);

    return () => clearInterval(interval);
  }, [runningExecution]);

  const handleCancel = useCallback((queryId: string) => {
    vscode.postMessage({ type: 'cancel', queryId });
  }, []);

  // Generate JSON for selected rows
  const selectedJson = useMemo(() => {
    if (selectedRows.length === 0) return '';
    if (selectedRows.length === 1) return JSON.stringify(selectedRows[0], null, 2);
    return JSON.stringify(selectedRows, null, 2);
  }, [selectedRows]);

  // Update ejected editor when selection changes or results change
  useEffect(() => {
    if (isEjected) {
      // Always update ejected editor with current selection (which may be empty after results change)
      const json = selectedRows.length === 0
        ? '[]'
        : selectedRows.length === 1
          ? JSON.stringify(selectedRows[0], null, 2)
          : JSON.stringify(selectedRows, null, 2);
      vscode.postMessage({ type: 'updateEjectedEditor', json });
    }
  }, [isEjected, selectedRows]);

  // Splitter drag handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const container = document.querySelector('.content-area');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      setPanelWidth(Math.max(150, Math.min(newWidth, rect.width - 200)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    const selected = event.api.getSelectedRows();
    setSelectedRows(selected);
  }, []);

  const handleToggleSidePanel = useCallback(() => {
    setShowSidePanel(prev => !prev);
  }, []);

  const handleEject = useCallback(() => {
    if (selectedJson) {
      vscode.postMessage({ type: 'ejectToEditor', json: selectedJson });
      setIsEjected(true);
    }
  }, [selectedJson]);

  const handleToggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'table' ? 'chart' : 'table');
  }, []);

  const handleToggleHistory = useCallback(() => {
    setShowHistory(prev => !prev);
  }, []);

  const handleSelectHistoryItem = useCallback((execution: SerializedExecution) => {
    vscode.postMessage({ type: 'selectHistoryItem', id: execution.id });
    // Request full data for this execution
    vscode.postMessage({ type: 'requestFullData', id: execution.id });
  }, []);

  const handleDeleteHistoryItem = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    vscode.postMessage({ type: 'deleteHistoryItem', id });
  }, []);

  const handleClearHistory = useCallback(() => {
    vscode.postMessage({ type: 'clearHistory' });
  }, []);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent<WebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case 'historySync': {
          setExecutions(message.data.executions);
          const newSelectedId = message.data.selectedId;
          setSelectedExecutionId(newSelectedId);

          // If we have a selected execution, check if we need to update display
          if (newSelectedId) {
            const exec = message.data.executions.find(e => e.id === newSelectedId);
            // If the execution is complete and we don't have cached data, request it
            if (exec && exec.status !== 'running' && !cachedFullData.has(newSelectedId)) {
              vscode.postMessage({ type: 'requestFullData', id: newSelectedId });
            } else if (exec && exec.status === 'running') {
              // Clear display while running
              setResultData(null);
              setErrorData(null);
            }
          }

          setSelectedRows([]);
          break;
        }
        case 'fullData': {
          // Cache the full data
          setCachedFullData(prev => new Map(prev).set(message.id, message.data));
          
          // If this is for the currently selected execution, update display
          if (message.id === selectedExecutionId) {
            const exec = executions.find(e => e.id === message.id);
            if (message.data.result && exec) {
              setResultData({
                columns: message.data.result.columns,
                rows: message.data.result.rows,
                totalRows: message.data.result.totalRows,
                cluster: exec.cluster,
                database: exec.database,
                timestamp: exec.endTime ? new Date(exec.endTime).toLocaleTimeString() : '',
                originalQuery: exec.originalQuery,
                resolvedQuery: message.data.result.resolvedQuery,
                visualization: message.data.result.visualization,
              });
              setErrorData(null);
            } else if (message.data.errorMessage && exec) {
              setErrorData({
                error: message.data.errorMessage,
                cluster: exec.cluster,
                database: exec.database,
                timestamp: exec.endTime ? new Date(exec.endTime).toLocaleTimeString() : '',
                originalQuery: exec.originalQuery,
                resolvedQuery: message.data.resolvedQuery,
              });
              setResultData(null);
            }
          }
          break;
        }
        case 'ejectedEditorClosed':
          setIsEjected(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [selectedExecutionId, executions, cachedFullData]);

  // Build column definitions from result data
  const columnDefs = useMemo((): ColDef[] => {
    if (!resultData) return [];

    return resultData.columns.map((col) => ({
      field: col,
      headerName: col,
      sortable: true,
      filter: true,
      resizable: true,
      cellRenderer: ({ value }: { value: unknown }) => formatCellValue(value),
      minWidth: 80,
    }));
  }, [resultData]);

  // Convert rows to row data objects
  const rowData = useMemo(() => {
    if (!resultData) return [];

    return resultData.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      resultData.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }, [resultData]);

  const defaultColDef = useMemo((): ColDef => ({
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 100,
  }), []);

  const onGridReady = useCallback(() => {
    // Grid is ready
  }, []);

  // Empty state - only show if truly empty (no results, no errors, no running query, and no history)
  if (!resultData && !errorData && !runningExecution && executions.length === 0) {
    return (
      <div className="app-container">
        <div className="empty-state">
          <div className="icon">📊</div>
          <div className="message">No query results yet</div>
          <div className="hint">Run a query with Ctrl+Enter to see results here</div>
        </div>
      </div>
    );
  }

  // Loading state - rendered inline below

  // Error state - rendered inline below

  // Compute shared values
  const showJsonPanel = showSidePanel && !isEjected && selectedRows.length > 0 && viewMode === 'table' && resultData && !errorData && !runningExecution;
  const vizType = resultData?.visualization?.type?.toLowerCase() || 'table';
  const hasResults = resultData && !errorData && !runningExecution;
  const currentExecution = selectedExecution || runningExecution;
  const currentData = currentExecution ? {
    cluster: currentExecution.cluster,
    database: currentExecution.database,
    timestamp: currentExecution.endTime ? new Date(currentExecution.endTime).toLocaleTimeString() : '',
  } : null;
  const loadingSeconds = runningExecution?.startTime ? ((Date.now() - runningExecution.startTime) / 1000).toFixed(1) : null;

  return (
    <div className="app-container">
      <div className="header">
        <div className="header-left">
          <button
            className={`icon-button ${showHistory ? 'active' : ''}`}
            onClick={handleToggleHistory}
            title={showHistory ? 'Hide history' : 'Show history'}
          >
            <HistoryIcon />
            {executions.length > 0 && <span className="history-badge">{executions.length}</span>}
          </button>
        </div>
        <div className="header-info">
          {currentData && (
            <>
              <span className="cluster">{currentData.cluster}</span>
              <span className="database">{currentData.database}</span>
            </>
          )}
          {runningExecution && (
            <span className="elapsed-time">{loadingSeconds}s</span>
          )}
          {hasResults && (
            <>
              <span className="row-count">{resultData.totalRows.toLocaleString()} rows</span>
              {vizType !== 'table' && (
                <span className="viz-type">{vizType}</span>
              )}
              <span className="timestamp">{resultData.timestamp}</span>
            </>
          )}
          {errorData && !runningExecution && (
            <span className="timestamp">{errorData.timestamp}</span>
          )}
        </div>
        <div className="header-actions">
          {hasResults && hasVisualization && (
            <button
              className="icon-button"
              onClick={handleToggleViewMode}
              title={viewMode === 'table' ? 'Show chart' : 'Show table'}
            >
              {viewMode === 'table' ? <ChartIcon /> : <TableIcon />}
            </button>
          )}
          {hasResults && viewMode === 'table' && selectedRows.length > 0 && (
            <>
              <span className="selection-count">{selectedRows.length} selected</span>
              {!isEjected && (
                <button
                  className="icon-button"
                  onClick={handleToggleSidePanel}
                  title={showSidePanel ? 'Hide JSON panel' : 'Show JSON panel'}
                >
                  {showSidePanel ? <ChevronRightIcon /> : <ChevronLeftIcon />}
                </button>
              )}
              <button
                className="icon-button"
                onClick={handleEject}
                title={isEjected ? 'Ejected to editor' : 'Open in editor'}
                disabled={isEjected}
              >
                <ExternalLinkIcon />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="main-content">
        {showHistory && (
          <div className="history-panel">
            <div className="history-header">
              <span>History</span>
              {executions.length > 0 && (
                <button
                  className="icon-button small"
                  onClick={handleClearHistory}
                  title="Clear history"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
            <div className="history-list">
              {executions.length === 0 ? (
                <div className="history-empty">No queries yet</div>
              ) : (
                executions.map(exec => {
                  const isAI = exec.originalQuery.startsWith('[AI] ');
                  const displayQuery = isAI ? exec.originalQuery.slice(5) : exec.originalQuery;
                  const elapsedMs = exec.status === 'running' ? Date.now() - exec.startTime : 0;
                  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
                  const timestamp = exec.endTime
                    ? new Date(exec.endTime).toLocaleTimeString()
                    : new Date(exec.startTime).toLocaleTimeString();
                  const cachedData = cachedFullData.get(exec.id);
                  return (
                  <div
                    key={exec.id}
                    className={`history-item ${selectedExecutionId === exec.id ? 'selected' : ''} ${exec.status}`}
                    onClick={() => handleSelectHistoryItem(exec)}
                  >
                    <div className="history-item-header">
                      <span className="history-time">
                        {isAI && <span className="history-ai-badge" title="Query from AI">AI</span>}
                        {exec.status === 'running' ? `${elapsedSeconds}s` : timestamp}
                      </span>
                      {exec.status !== 'running' && (
                        <button
                          className="history-delete"
                          onClick={(e) => handleDeleteHistoryItem(e, exec.id)}
                          title="Remove from history"
                        >
                          ×
                        </button>
                      )}
                      {exec.status === 'running' && (
                        <button
                          className="history-cancel"
                          onClick={(e) => { e.stopPropagation(); handleCancel(exec.id); }}
                          title="Cancel query"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="history-query" title={displayQuery}>
                      {displayQuery.length > 60
                        ? displayQuery.substring(0, 57) + '...'
                        : displayQuery}
                    </div>
                    <div className="history-meta">
                      <span>{exec.database}</span>
                      {exec.status === 'success' && exec.totalRows !== undefined && <span>{exec.totalRows} rows</span>}
                      {exec.status === 'success' && exec.totalRows === undefined && cachedData?.result && <span>{cachedData.result.totalRows} rows</span>}
                      {exec.status === 'error' && <span className="history-error-badge">Error</span>}
                      {exec.status === 'running' && <span className="history-running-badge">Running</span>}
                      {exec.status === 'cancelled' && <span className="history-cancelled-badge">Cancelled</span>}
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        )}
        <div className="content-area">
          {runningExecution ? (
            <div className="loading-container">
              <div className="loading-spinner"></div>
              <div className="loading-text">Executing query...</div>
              <button className="cancel-button" onClick={() => handleCancel(runningExecution.id)}>
                Cancel
              </button>
            </div>
          ) : errorData ? (
            <div className="error-container">
              <div className="error-header">
                ⚠️ Query Error
              </div>
              <div className="error-message">{errorData.error}</div>
              <details className="query-section">
                <summary>Show Original Query</summary>
                <pre>{errorData.originalQuery}</pre>
              </details>
              <details className="query-section">
                <summary>Show Resolved Query</summary>
                <pre>{errorData.resolvedQuery}</pre>
              </details>
            </div>
          ) : hasResults && viewMode === 'table' ? (
            <>
              <div className={`grid-container ag-theme-quartz-dark ${showJsonPanel ? 'with-panel' : ''}`}>
                <AgGridReact
                  ref={gridRef}
                  rowData={rowData}
                  columnDefs={columnDefs}
                  defaultColDef={defaultColDef}
                  onGridReady={onGridReady}
                  onSelectionChanged={handleSelectionChanged}
                  rowSelection="multiple"
                  animateRows={false}
                  suppressCellFocus={true}
                  enableCellTextSelection={true}
                />
              </div>
              {showJsonPanel && (
                <>
                  <div
                    ref={splitterRef}
                    className="splitter"
                    onMouseDown={handleSplitterMouseDown}
                  />
                  <div className="json-panel" style={{ width: panelWidth }}>
                    <Editor
                      height="100%"
                      language="json"
                      value={selectedJson}
                      theme="vs-dark"
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 12,
                        lineNumbers: 'off',
                        folding: true,
                        wordWrap: 'on',
                      }}
                    />
                  </div>
                </>
              )}
            </>
          ) : hasResults ? (
            <div className="chart-container">
              <ChartRenderer
                data={rowData}
                columns={resultData!.columns}
                visualization={resultData!.visualization}
              />
            </div>
          ) : (
            <div className="empty-state">
              <div className="icon">📊</div>
              <div className="message">Select a query from history</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Chart renderer component
interface ChartRendererProps {
  data: Record<string, unknown>[];
  columns: string[];
  visualization?: KustoVisualization;
}

function ChartRenderer({ data, columns, visualization }: ChartRendererProps) {
  const vizType = visualization?.type?.toLowerCase() || 'linechart';

  // Determine X and Y columns
  // If not specified, use first column as X and remaining numeric columns as Y
  const xColumn = visualization?.xColumn || columns[0];
  const yColumns = visualization?.yColumns || columns.slice(1).filter(col =>
    data.length > 0 && typeof data[0][col] === 'number'
  );

  // Format data for Recharts
  const chartData = data.map(row => {
    const formatted: Record<string, unknown> = {};
    columns.forEach(col => {
      const value = row[col];
      // Convert datetime strings to Date objects for time axis
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        formatted[col] = new Date(value).getTime();
      } else {
        formatted[col] = value;
      }
    });
    return formatted;
  });

  // Custom tooltip formatter
  const formatTooltipValue = (value: unknown) => {
    if (typeof value === 'number') {
      // Check if it looks like a timestamp
      if (value > 1000000000000) {
        return new Date(value).toLocaleString();
      }
      return value.toLocaleString();
    }
    return String(value);
  };

  // Custom X-axis tick formatter
  const formatXAxisTick = (value: unknown) => {
    if (typeof value === 'number' && value > 1000000000000) {
      const date = new Date(value);
      return date.toLocaleDateString();
    }
    if (typeof value === 'string' && value.length > 20) {
      return value.substring(0, 17) + '...';
    }
    return String(value);
  };

  const renderChart = () => {
    switch (vizType) {
      case 'linechart':
      case 'timechart':
        return (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
            <XAxis
              dataKey={xColumn}
              stroke="#888"
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={formatXAxisTick}
            />
            <YAxis
              stroke="#888"
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={(v) => typeof v === 'number' ? v.toLocaleString() : v}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #444' }}
              labelFormatter={formatTooltipValue}
              formatter={formatTooltipValue}
            />
            {yColumns.length > 1 && <Legend />}
            {yColumns.map((col, i) => (
              <Line
                key={col}
                type="monotone"
                dataKey={col}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                dot={chartData.length < 50}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        );

      case 'barchart':
      case 'columnchart':
        return (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
            <XAxis
              dataKey={xColumn}
              stroke="#888"
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={formatXAxisTick}
            />
            <YAxis
              stroke="#888"
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={(v) => typeof v === 'number' ? v.toLocaleString() : v}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #444' }}
              formatter={formatTooltipValue}
            />
            {yColumns.length > 1 && <Legend />}
            {yColumns.map((col, i) => (
              <Bar
                key={col}
                dataKey={col}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
              />
            ))}
          </BarChart>
        );

      case 'areachart':
      case 'stackedareachart':
        return (
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
            <XAxis
              dataKey={xColumn}
              stroke="#888"
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={formatXAxisTick}
            />
            <YAxis
              stroke="#888"
              tick={{ fill: '#888', fontSize: 11 }}
              tickFormatter={(v) => typeof v === 'number' ? v.toLocaleString() : v}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #444' }}
              formatter={formatTooltipValue}
            />
            {yColumns.length > 1 && <Legend />}
            {yColumns.map((col, i) => (
              <Area
                key={col}
                type="monotone"
                dataKey={col}
                stackId={vizType === 'stackedareachart' ? '1' : undefined}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        );

      case 'piechart':
        // For pie chart, use first column as name, second as value
        const nameKey = columns[0];
        const valueKey = columns[1];
        return (
          <PieChart>
            <Pie
              data={chartData}
              dataKey={valueKey}
              nameKey={nameKey}
              cx="50%"
              cy="50%"
              outerRadius="80%"
              label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={{ stroke: '#888' }}
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #444' }}
              formatter={formatTooltipValue}
            />
            <Legend />
          </PieChart>
        );

      default:
        return (
          <div className="chart-unsupported">
            <p>Visualization type "{vizType}" is not yet supported.</p>
            <p>Switch to table view to see the data.</p>
          </div>
        );
    }
  };

  if (data.length === 0) {
    return <div className="chart-empty">No data to display</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      {renderChart()}
    </ResponsiveContainer>
  );
}

function formatCellValue(value: unknown): JSX.Element {
  if (value === null || value === undefined) {
    return <span className="cell-null">null</span>;
  }

  if (typeof value === 'object') {
    return <span className="cell-object">{JSON.stringify(value)}</span>;
  }

  if (typeof value === 'number') {
    return <span className="cell-number">{value.toLocaleString()}</span>;
  }

  if (typeof value === 'boolean') {
    return <span className="cell-boolean">{value ? 'true' : 'false'}</span>;
  }

  // Check if it looks like a datetime
  const strValue = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(strValue)) {
    return <span className="cell-datetime">{strValue}</span>;
  }

  return <span>{strValue}</span>;
}

export default App;
