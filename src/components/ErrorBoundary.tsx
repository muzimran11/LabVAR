import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render/runtime errors anywhere in the tree and shows the message
 * instead of a blank white screen. Without this, any thrown error unmounts
 * the whole React app and paints nothing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Also surface it in the devtools console.
    console.error('LabVAR crashed:', error, info);
    this.setState({ info });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 overflow-auto">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-lg font-semibold text-red-400 mb-2">Something went wrong</h1>
          <p className="text-sm text-zinc-400 mb-4">
            The app hit an error while rendering. The details below help pin down the cause.
          </p>
          <pre className="text-xs font-mono bg-zinc-900 border border-zinc-800 rounded-lg p-4 whitespace-pre-wrap text-red-300">
            {this.state.error.message}
          </pre>
          {this.state.error.stack && (
            <pre className="mt-3 text-[11px] font-mono bg-zinc-900 border border-zinc-800 rounded-lg p-4 whitespace-pre-wrap text-zinc-500 max-h-72 overflow-auto">
              {this.state.error.stack}
            </pre>
          )}
          <button
            onClick={() => this.setState({ error: null, info: null })}
            className="mt-4 px-4 py-2 text-sm bg-teal-600 hover:bg-teal-500 text-white rounded font-medium"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
