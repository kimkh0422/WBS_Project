// @ts-nocheck — React 19 타입에서 class component의 this.props 타입 추론 이슈
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  viewName?: string;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// React class component — ErrorBoundary는 함수 컴포넌트로 구현 불가
// eslint-disable-next-line react/prefer-stateless-function
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(`[ErrorBoundary · ${this.props.viewName ?? ''}]`, error, errorInfo);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const viewLabel = this.props.viewName || '이 화면';
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--color-bg)]">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-ink)]">
              {viewLabel}에서 오류가 발생했습니다
            </h2>
            <p className="text-sm text-[var(--color-ink-muted)] mt-1">
              다른 탭으로 이동하거나 아래 버튼을 눌러 다시 시도해 주세요.
            </p>
          </div>
          {this.state.error && (
            <details className="text-left bg-[var(--color-line-soft)] rounded-lg p-3 text-xs text-[var(--color-ink-muted)]">
              <summary className="cursor-pointer font-semibold">오류 상세</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono">
                {this.state.error.message}
              </pre>
            </details>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn-primary inline-flex items-center gap-2"
          >
            <RefreshCw size={14} />
            다시 시도
          </button>
        </div>
      </div>
    );
  }
}
