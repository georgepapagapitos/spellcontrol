import { logger } from '@/lib/logger';
import { Component, type ReactNode } from 'react';
import { BrandMark } from './shared/BrandMark';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary-page">
          <div className="error-boundary-card" role="alert">
            <div className="auth-brand-hero" aria-hidden="true">
              <BrandMark size={48} />
            </div>
            {/* A raw JS exception message is never user-facing copy (cryptic,
                sometimes alarming) — the real detail already went to
                logger.error above for debugging; this stays a fixed,
                honest line regardless of what actually threw. */}
            <h1 className="auth-title">Something went wrong</h1>
            <p className="auth-subtitle">
              SpellControl hit an unexpected error. Your data on this device is safe — try again, or
              reload if that doesn't help.
            </p>
            <div className="error-boundary-actions">
              <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button className="btn" onClick={() => window.location.reload()}>
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
