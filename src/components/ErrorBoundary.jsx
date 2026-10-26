import { Component } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * If the interface itself breaks, show a plain message and a way out instead of a blank page.
 * Nothing technical is shown; the error goes to the console for debugging.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error(error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="crash">
        <section className="card error" role="alert">
          <div className="error__icon"><AlertTriangle size={22} /></div>
          <div className="error__text">
            <h1 className="h2">Something went wrong on this page</h1>
            <p>Your bookmarks and saved results are safe. Reload the page and open your file again.</p>
          </div>
          <button type="button" className="button" onClick={() => location.reload()}>Reload page</button>
        </section>
      </main>
    );
  }
}
