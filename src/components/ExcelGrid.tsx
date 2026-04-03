import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import type { ColDef, ValueParserParams, ValueFormatterParams } from 'ag-grid-community';
import '@ag-grid-community/styles/ag-grid.css';
import '@ag-grid-community/styles/ag-theme-alpine.css';
import { Task } from '../types';

ModuleRegistry.registerModules([AllCommunityModule]);

interface ExcelGridProps {
  tasks: Task[];
  displayWbsMap: Map<string, string>;
  onTaskChange: (id: string, patch: Partial<Task>) => void;
}

export function ExcelGrid({ tasks, displayWbsMap, onTaskChange }: ExcelGridProps) {
  const rowData = useMemo(
    () =>
      tasks.map((t) => ({
        ...t,
        _wbs: displayWbsMap.get(t.id) ?? '',
        // Excel 편집 모드에서 모든 컬럼 정보를 한눈에 보기 위해
        // 표 컬럼에 대응하는 표시용 텍스트를 함께 포함한다.
        _allocationText: '',
        _dependenciesText: Array.isArray(t.dependencies) && t.dependencies.length > 0
          ? t.dependencies.join(', ')
          : '',
      })),
    [tasks, displayWbsMap],
  );

  const numberParser = (p: ValueParserParams) => {
    const v = String(p.newValue ?? '').trim();
    if (!v) return null;
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : p.oldValue ?? null;
  };

  const percentFormatter = (p: ValueFormatterParams) => {
    const v = typeof p.value === 'number' ? p.value : Number(p.value);
    if (!Number.isFinite(v)) return '';
    return `${v}%`;
  };

  const columnDefs = useMemo<ColDef<Task & { _wbs: string; _allocationText: string; _dependenciesText: string }>[]>(() => {
    return [
      {
        headerName: 'WBS',
        field: '_wbs',
        width: 90,
        editable: false,
      },
      {
        headerName: '작업명',
        field: 'name',
        flex: 2,
        minWidth: 200,
        editable: true,
      },
      {
        headerName: '시작일',
        field: 'startDate',
        width: 110,
        editable: true,
      },
      {
        headerName: '종료일',
        field: 'endDate',
        width: 110,
        editable: true,
      },
      {
        headerName: '담당자',
        field: 'assignee',
        width: 130,
        editable: true,
      },
      {
        headerName: '투입율(%)',
        field: '_allocationText',
        width: 120,
        editable: false,
      },
      {
        headerName: '공수(D)',
        field: 'workEffort',
        width: 110,
        editable: true,
        valueParser: numberParser,
      },
      {
        headerName: '가중치',
        field: 'weight',
        width: 110,
        editable: true,
        valueParser: numberParser,
      },
      {
        headerName: '진행률(%)',
        field: 'progress',
        width: 120,
        editable: true,
        valueParser: numberParser,
        valueFormatter: percentFormatter,
      },
      {
        headerName: '상태',
        field: 'status',
        width: 110,
        editable: true,
      },
      {
        headerName: '산출물',
        field: 'deliverables',
        flex: 2,
        minWidth: 200,
        editable: true,
      },
      {
        headerName: '선행작업',
        field: '_dependenciesText',
        flex: 1.5,
        minWidth: 160,
        editable: false,
      },
    ];
  }, []);

  const defaultColDef: ColDef = {
    resizable: true,
    sortable: false,
    filter: false,
  };

  return (
    <div className="ag-theme-alpine" style={{ width: '100%', height: '100%' }}>
      <AgGridReact<Task & { _wbs: string }>
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        theme="legacy"
        rowSelection={{
          mode: 'singleRow',
          enableClickSelection: true,
        }}
        onCellValueChanged={(e) => {
          const taskId = e.data.id;
          if (!taskId) return;
          const field = e.colDef.field as keyof Task | '_wbs' | undefined;
          if (!field || field === '_wbs') return;
          const newValue = (e.data as Record<string, unknown>)[field];
          onTaskChange(taskId, { [field]: newValue } as Partial<Task>);
        }}
      />
    </div>
  );
}

