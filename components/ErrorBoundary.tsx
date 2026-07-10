import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createLogger } from '@/lib/log';

const log = createLogger('app');

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Faengt Render-Fehler ab und zeigt sie im Overlay an, statt einen leeren
 * Shadow Tree zu hinterlassen. Beim Debuggen der schnellste Weg zur Ursache.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('UI-Fehler', error, info.componentStack);
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#1a0d0d',
          color: '#ffb4b4',
          font: '13px/1.5 ui-monospace, monospace',
          padding: 20,
          overflow: 'auto',
          zIndex: 2147483647,
        }}
      >
        <h2 style={{ color: '#ff8080' }}>Inkspect ist abgestuerzt</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {error.name}: {error.message}
          {'\n\n'}
          {error.stack}
          {info?.componentStack ? `\n\nKomponenten:\n${info.componentStack}` : ''}
        </pre>
      </div>
    );
  }
}
