import { reportError } from '@/lib/util/analytics';
import { logger } from '@/lib/util/logger';
import { Component, type ReactNode } from 'react';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';
import { isChunkLoadError, reloadForNewBuild } from '@/lib/util/chunk-reload';

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
    // A page chunk that a deploy replaced: reload once for the new build
    // rather than show an error the Retry button can never clear.
    if (isChunkLoadError(error) && reloadForNewBuild()) return;
    logger.error('[ErrorBoundary]', error, info.componentStack);
    reportError('render', error);
  }

  render() {
    if (this.state.error && isChunkLoadError(this.state.error)) {
      // The one-time reload already happened (or storage is off): say what
      // it is and offer the only thing that works.
      return (
        <div className="error-boundary-page">
          <Surface as="div" variant="framed" className="error-boundary-card" role="alert">
            <h1 className="auth-title">A new version is ready</h1>
            <p className="auth-subtitle">Reload to open this page.</p>
            <div className="error-boundary-actions">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </Surface>
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div className="error-boundary-page">
          <Surface as="div" variant="framed" className="error-boundary-card" role="alert">
            {/* A raw JS exception message is never user-facing copy (cryptic,
                sometimes alarming) — the real detail already went to
                logger.error above for debugging; this stays a fixed,
                honest line regardless of what actually threw. */}
            <h1 className="auth-title">Something went wrong</h1>
            <p className="auth-subtitle">Your data on this device is safe.</p>
            <div className="error-boundary-actions">
              <Button variant="primary" onClick={() => this.setState({ error: null })}>
                Retry
              </Button>
              <Button onClick={() => window.location.reload()}>Reload page</Button>
            </div>
          </Surface>
        </div>
      );
    }
    return this.props.children;
  }
}
