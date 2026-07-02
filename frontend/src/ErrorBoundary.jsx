import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#111', color: 'red', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h1 style={{ fontSize: '20px', color: 'white' }}>Something went wrong.</h1>
          <p style={{ marginTop: '10px' }}>{this.state.error && this.state.error.toString()}</p>
          <pre style={{ marginTop: '10px', fontSize: '10px', overflowX: 'auto', background: '#222', padding: '10px' }}>
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </pre>
          <button 
            onClick={() => window.location.reload()} 
            style={{ marginTop: '20px', padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '5px' }}>
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children; 
  }
}
