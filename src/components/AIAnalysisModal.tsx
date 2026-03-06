import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { X, Sparkles, Loader2, Check, AlertCircle, Settings, GitBranch } from 'lucide-react';
import { Task, TaskStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface AIAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (tasks: Task[], replace?: boolean) => void;
  currentProjectId: string;
  existingTasks?: Task[];
}

interface AIResponseTask {
  name: string;
  startDate: string;
  endDate: string;
  status: TaskStatus;
  assignee: string;
  progress: number;
  workEffort: number;
  subtasks?: AIResponseTask[];
}

export function AIAnalysisModal({ isOpen, onClose, onImport, currentProjectId, existingTasks = [] }: AIAnalysisModalProps) {
  const [inputText, setInputText] = useState('');
  const [userRequest, setUserRequest] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedTasks, setGeneratedTasks] = useState<Task[]>([]);
  const [step, setStep] = useState<'input' | 'preview' | 'settings'>('input');
  const [analysisMode, setAnalysisMode] = useState<'generate' | 'reanalyze' | 'dependency'>('generate');
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [dependencyResults, setDependencyResults] = useState<{ taskId: string; dependsOn: string[] }[]>([]);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini-api-key') || '');
  const [tempApiKey, setTempApiKey] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          target.blur();
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSaveApiKey = () => {
    if (!tempApiKey.trim()) {
      setError("API 키를 입력해주세요.");
      return;
    }
    localStorage.setItem('gemini-api-key', tempApiKey.trim());
    setApiKey(tempApiKey.trim());
    setStep('input');
    setError(null);
  };

  const handleAnalyze = async (useExisting: boolean = false) => {
    if (!apiKey) {
      setTempApiKey('');
      setStep('settings');
      return;
    }

    if (!useExisting && !inputText.trim()) return;

    setIsLoading(true);
    setIsReanalyzing(useExisting);
    setError(null);

    try {
      if (!apiKey) {
        throw new Error("Gemini API Key가 누락되었습니다.");
      }

      const ai = new GoogleGenAI({ apiKey });

      let prompt = '';

      if (useExisting) {
        const tasksJson = JSON.stringify(existingTasks.map(t => ({
          name: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.status,
          assignee: t.assignee,
          progress: t.progress,
          workEffort: t.workEffort,
          parentId: t.parentId,
          id: t.id
        })), null, 2);

        prompt = `
          당신은 프로젝트 관리 전문가입니다. 현재 등록된 다음 WBS 작업 목록을 분석하여 더 체계적이고 논리적인 구조로 재구성(Restructure)해 주세요.
          
          현재 날짜: ${new Date().toISOString().split('T')[0]}
          
          ${userRequest ? `사용자 특별 요청 사항 (최우선 준수):\n"${userRequest}"\n` : ''}
          
          현재 작업 목록 (JSON):
          ${tasksJson}
          
          요구사항:
          1. 기존 작업들의 내용을 유지하면서, 프로젝트를 주요 단계(Phase) 또는 작업 유형별로 더 명확하게 그룹화하세요.
          2. 계층 구조가 불분명한 작업들을 적절한 상위 작업 아래로 배치하세요.
          3. 작업 이름(name)을 작성할 때 번호나 'WP', 'Task' 같은 접두사(예: "WP1.", "Task1.1.")를 절대 포함하지 마세요. 오직 순수한 작업 이름만 작성하세요.
          4. 일정(시작일, 종료일)이 비논리적인 경우(예: 하위 작업이 상위 작업 범위를 벗어남) 현실적으로 조정하세요.
          5. 중복되거나 누락된 단계가 있다면 보완하세요.
          6. 반드시 "tasks" 키를 포함하는 유효한 JSON 객체만 반환하세요.
          7. 모든 작업 이름과 설명은 반드시 **한국어**로 작성되어야 합니다.
          
          작업 스키마:
          {
            "name": "string",
            "startDate": "YYYY-MM-DD",
            "endDate": "YYYY-MM-DD",
            "status": "todo" | "in-progress" | "done" | "blocked",
            "assignee": "string",
            "progress": number,
            "workEffort": number,
            "subtasks": [] (동일한 작업 객체의 선택적 배열)
          }
        `;
      } else {
        prompt = `
          당신은 프로젝트 관리 전문가입니다. 다음 프로젝트 설명을 분석하여 체계적인 WBS(Work Breakdown Structure)를 작성해 주세요.
          
          현재 날짜: ${new Date().toISOString().split('T')[0]}
          
          ${userRequest ? `사용자 특별 요청 사항 (최우선 준수):\n"${userRequest}"\n` : ''}
          
          입력 텍스트:
          "${inputText}"
          
          요구사항:
          1. 프로젝트를 주요 단계(Phase) 또는 작업 유형(예: 기획, 디자인, 개발, 테스트, 배포 등)으로 그룹화하여 최상위 작업으로 설정하세요.
          2. 각 주요 단계 아래에 세부 작업(Subtask)을 계층적으로 구성하세요.
          3. 작업 이름(name)을 작성할 때 번호나 'WP', 'Task' 같은 접두사(예: "WP1.", "Task1.1.")를 절대 포함하지 마세요. 오직 순수한 작업 이름만 작성하세요.
          4. 현재 날짜를 기준으로 현실적인 시작일과 종료일을 추정하세요. 상위 작업의 기간은 하위 작업들의 기간을 포괄해야 합니다.
          5. 진행률(0-100), 작업 노력(일 단위), 상태(todo, in-progress, done)를 추정하세요.
          6. 반드시 "tasks" 키를 포함하는 유효한 JSON 객체만 반환하세요.
          7. 구조는 중첩되어야 합니다: 작업은 "subtasks" 배열을 가질 수 있습니다.
          8. 모든 작업 이름과 설명은 반드시 **한국어**로 작성되어야 합니다.
          
          작업 스키마:
          {
            "name": "string",
            "startDate": "YYYY-MM-DD",
            "endDate": "YYYY-MM-DD",
            "status": "todo" | "in-progress" | "done" | "blocked",
            "assignee": "string",
            "progress": number,
            "workEffort": number,
            "subtasks": []
          }
        `;
      }

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const responseText = result.text;
      if (!responseText) {
        throw new Error("AI로부터 응답이 없습니다.");
      }
      const parsed = JSON.parse(responseText);

      if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
        throw new Error("AI 응답 형식이 올바르지 않습니다.");
      }

      // Process and flatten the tasks
      const flattenedTasks: Task[] = [];

      const processTask = (aiTask: AIResponseTask, parentId: string | null = null) => {
        const id = uuidv4();
        const task: Task = {
          id,
          projectId: currentProjectId,
          parentId,
          name: aiTask.name,
          startDate: aiTask.startDate,
          endDate: aiTask.endDate,
          status: aiTask.status,
          assignee: aiTask.assignee || '',
          progress: aiTask.progress || 0,
          workEffort: aiTask.workEffort || 1,
          expanded: true,
          dependencies: []
        };

        flattenedTasks.push(task);

        if (aiTask.subtasks && aiTask.subtasks.length > 0) {
          aiTask.subtasks.forEach(sub => processTask(sub, id));
        }
      };

      parsed.tasks.forEach((t: AIResponseTask) => processTask(t));

      setGeneratedTasks(flattenedTasks);
      setStep('preview');

    } catch (err: any) {
      console.error("AI Analysis Error:", err);
      setError(err.message || "텍스트 분석에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDependencyAnalysis = async () => {
    if (!apiKey) { setTempApiKey(''); setStep('settings'); return; }
    if (existingTasks.length === 0) return;

    setIsLoading(true);
    setAnalysisMode('dependency');
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const taskList = existingTasks.map(t => ({
        id: t.id,
        name: t.name,
        parentId: t.parentId,
        startDate: t.startDate,
        endDate: t.endDate,
      }));

      const prompt = `
        당신은 프로젝트 관리 전문가입니다. 다음 WBS 작업 목록을 분석하여 작업 간의 선행관계(Finish-to-Start 의존성)를 파악해 주세요.

        작업 목록 (JSON):
        ${JSON.stringify(taskList, null, 2)}

        ${userRequest ? `사용자 특별 요청 사항 (최우선 준수):\n"${userRequest}"\n` : ''}

        요구사항:
        1. 논리적으로 선행되어야 하는 작업 관계만 연결하세요 (예: 설계가 완료되어야 개발 가능).
        2. 같은 레벨의 형제 작업 간 순서 관계, 또는 다른 상위 작업에 속한 작업 간의 명확한 의존성만 포함하세요.
        3. 상위 작업이 하위 작업에 의존하거나, 하위 작업이 상위 작업에 의존하는 관계는 제외하세요.
        4. 선행관계가 없는 작업은 결과에 포함하지 마세요.
        5. dependsOn 배열에는 반드시 위 목록에 있는 실제 id 값만 사용하세요.
        6. 반드시 "dependencies" 키를 포함하는 유효한 JSON 객체만 반환하세요.

        응답 스키마:
        {
          "dependencies": [
            { "taskId": "작업의id", "dependsOn": ["선행작업id1", "선행작업id2"] }
          ]
        }
      `;

      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const responseText = result.text;
      if (!responseText) throw new Error("AI로부터 응답이 없습니다.");

      const parsed = JSON.parse(responseText);
      if (!parsed.dependencies || !Array.isArray(parsed.dependencies)) {
        throw new Error("AI 응답 형식이 올바르지 않습니다.");
      }

      // Validate IDs exist in existingTasks
      const validIds = new Set(existingTasks.map(t => t.id));
      const validated = parsed.dependencies
        .filter((d: any) => validIds.has(d.taskId))
        .map((d: any) => ({
          taskId: d.taskId,
          dependsOn: (d.dependsOn || []).filter((id: string) => validIds.has(id)),
        }))
        .filter((d: any) => d.dependsOn.length > 0);

      setDependencyResults(validated);
      setStep('preview');
    } catch (err: any) {
      console.error("Dependency Analysis Error:", err);
      setError(err.message || "선행관계 분석에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportDependencies = () => {
    const depMap = new Map<string, string[]>(dependencyResults.map(d => [d.taskId, d.dependsOn]));
    const updatedTasks: Task[] = existingTasks.map(t => ({
      ...t,
      dependencies: depMap.has(t.id) ? depMap.get(t.id)! : (t.dependencies || []),
    }));
    onImport(updatedTasks, true);
    handleClose();
  };

  const handleImport = () => {
    onImport(generatedTasks, isReanalyzing);
    handleClose();
  };

  const handleClose = () => {
    setInputText('');
    setUserRequest('');
    setGeneratedTasks([]);
    setDependencyResults([]);
    setStep('input');
    setAnalysisMode('generate');
    setError(null);
    setIsLoading(false);
    setIsReanalyzing(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[var(--color-line)] flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-stone-50">
          <div className="flex items-center gap-2">
            <div className="bg-purple-100 p-1.5 rounded-lg text-purple-600">
              {step === 'settings' ? <Settings size={18} /> : <Sparkles size={18} />}
            </div>
            <h2 className="font-bold text-lg text-[var(--color-ink)]">
              {step === 'settings' ? 'API 설정'
                : step === 'preview' && analysisMode === 'dependency' ? '선행관계 분석 결과'
                  : step === 'preview' && isReanalyzing ? 'WBS 재분석 결과'
                    : 'AI 프로젝트 분석'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {step !== 'settings' && (
              <button
                onClick={() => {
                  setTempApiKey(apiKey);
                  setStep('settings');
                }}
                className="p-1.5 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]"
                title="API 키 설정"
              >
                <Settings size={18} />
              </button>
            )}
            <button onClick={handleClose} className="p-1.5 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]" title="닫기">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 'settings' ? (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-sm text-blue-800 leading-relaxed">
                <p className="font-bold mb-2 flex items-center gap-2">
                  <AlertCircle size={16} />
                  Gemini API 키가 필요합니다
                </p>
                <p className="mb-2">AI 기능을 사용하려면 Google Gemini API 키가 필요합니다. 이 키는 브라우저에만 안전하게 저장됩니다.</p>
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-medium underline hover:text-blue-800">
                  Google AI Studio에서 무료 API 키 발급받기 &rarr;
                </a>
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-2">API Key</label>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full p-3 rounded-lg border border-stone-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all font-mono"
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveApiKey();
                  }}
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
            </div>
          ) : step === 'input' ? (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">
                프로젝트 요구사항, 회의록 또는 대략적인 계획을 아래에 붙여넣으세요.
                AI가 분석하여 단계별로 그룹화된 체계적인 WBS를 생성합니다.
              </p>
              <textarea
                className="w-full h-48 p-4 rounded-xl border border-stone-200 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-blue-100 outline-none resize-none text-sm leading-relaxed"
                placeholder="예시: 새로운 전자상거래 웹사이트를 구축해야 합니다. 기획, 디자인, 개발(프론트엔드/백엔드), 테스트 단계로 진행될 예정입니다. 주요 기능으로는 회원가입, 상품 목록, 장바구니, 결제 시스템이 필요하며, 전체 일정은 약 3개월입니다..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isLoading}
              />

              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">AI 추가 요청 사항 (선택)</label>
                <textarea
                  className="w-full h-16 p-3 rounded-lg border border-stone-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none resize-none text-sm leading-relaxed"
                  placeholder="예: 설계는 반드시 개발 이전에 완료되어야 함. 특정 담당자에게 작업이 집중되지 않도록 배분할 것."
                  value={userRequest}
                  onChange={(e) => setUserRequest(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
            </div>
          ) : analysisMode === 'dependency' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-stone-700">감지된 선행관계 ({dependencyResults.length}건)</h3>
                <button onClick={() => setStep('input')} className="text-xs text-stone-500 hover:text-[var(--color-ink)] underline">
                  다시 분석
                </button>
              </div>
              {dependencyResults.length === 0 ? (
                <div className="text-center py-10 text-stone-400 text-sm">
                  명확한 선행관계가 감지되지 않았습니다.
                </div>
              ) : (
                <div className="border border-stone-200 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto bg-stone-50">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-stone-100 text-stone-500 font-medium text-xs uppercase sticky top-0">
                      <tr>
                        <th className="px-4 py-2">작업명</th>
                        <th className="px-4 py-2">선행 작업 (이것이 완료되어야 시작 가능)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {dependencyResults.map((dep) => {
                        const task = existingTasks.find(t => t.id === dep.taskId);
                        const predecessors = dep.dependsOn.map(id => existingTasks.find(t => t.id === id)?.name).filter(Boolean);
                        return (
                          <tr key={dep.taskId} className="bg-white hover:bg-stone-50">
                            <td className="px-4 py-2 font-medium text-stone-800 truncate max-w-[180px]">{task?.name || dep.taskId}</td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap gap-1">
                                {predecessors.map((name, i) => (
                                  <span key={i} className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded text-xs">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-stone-700">생성된 작업 미리보기 ({generatedTasks.length})</h3>
                <button
                  onClick={() => setStep('input')}
                  className="text-xs text-stone-500 hover:text-[var(--color-ink)] underline"
                >
                  수정하기
                </button>
              </div>

              <div className="border border-stone-200 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto bg-stone-50">
                <table className="w-full text-sm text-left">
                  <thead className="bg-stone-100 text-stone-500 font-medium text-xs uppercase sticky top-0">
                    <tr>
                      <th className="px-4 py-2">작업명</th>
                      <th className="px-4 py-2">시작일</th>
                      <th className="px-4 py-2">종료일</th>
                      <th className="px-4 py-2">담당자</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {generatedTasks.map((task) => (
                      <tr key={task.id} className="bg-white hover:bg-stone-50">
                        <td className="px-4 py-2">
                          <div style={{ paddingLeft: task.parentId ? '20px' : '0' }} className="truncate max-w-[200px]">
                            {task.parentId && <span className="text-stone-400 mr-1">↳</span>}
                            {task.name}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{task.startDate}</td>
                        <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{task.endDate}</td>
                        <td className="px-4 py-2 text-stone-600">
                          {task.assignee ? (
                            <span className="bg-stone-100 px-2 py-0.5 rounded text-xs border border-stone-200">
                              {task.assignee}
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[var(--color-line)] bg-stone-50 flex justify-end gap-3">
          {step === 'settings' ? (
            <>
              {apiKey && (
                <button onClick={() => setStep('input')} className="btn-ghost mr-auto">
                  취소
                </button>
              )}
              <button
                onClick={handleSaveApiKey}
                className="btn-primary bg-purple-600 hover:bg-purple-700 border-transparent flex items-center gap-2 ml-auto"
              >
                저장 및 계속
              </button>
            </>
          ) : step === 'input' ? (
            <>
              <button onClick={handleClose} className="btn-ghost mr-auto">
                취소
              </button>

              {existingTasks.length > 0 && (
                <>
                  <button
                    onClick={handleDependencyAnalysis}
                    disabled={isLoading}
                    className="btn-secondary text-blue-600 border-blue-200 hover:bg-blue-50 flex items-center gap-2"
                  >
                    {isLoading && analysisMode === 'dependency' ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <GitBranch size={16} />
                    )}
                    선행관계 분석
                  </button>
                  <button
                    onClick={() => handleAnalyze(true)}
                    disabled={isLoading}
                    className="btn-secondary text-purple-600 border-purple-200 hover:bg-purple-50 flex items-center gap-2"
                  >
                    {isLoading && isReanalyzing ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    현재 작업 재분석
                  </button>
                </>
              )}

              <button
                onClick={() => handleAnalyze(false)}
                disabled={!inputText.trim() || isLoading}
                className="btn-primary bg-purple-600 hover:bg-purple-700 border-transparent flex items-center gap-2"
              >
                {isLoading && !isReanalyzing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    분석 중...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    WBS 생성
                  </>
                )}
              </button>
            </>
          ) : analysisMode === 'dependency' ? (
            <>
              <button onClick={() => { setStep('input'); setAnalysisMode('generate'); }} className="btn-ghost">
                취소
              </button>
              <button
                onClick={handleImportDependencies}
                disabled={dependencyResults.length === 0}
                className="btn-primary flex items-center gap-2"
              >
                <Check size={16} />
                선행관계 적용
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('input')} className="btn-ghost">
                삭제
              </button>
              <button
                onClick={handleImport}
                className="btn-primary flex items-center gap-2"
              >
                <Check size={16} />
                {isReanalyzing ? '작업 덮어쓰기' : '작업 가져오기'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
