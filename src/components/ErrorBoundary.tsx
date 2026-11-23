import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected application error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('RangLive ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0E14] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#131822] border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold text-white">
              Something went wrong
            </h2>
            <p className="text-sm text-slate-400 break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              Reload RangLive
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
