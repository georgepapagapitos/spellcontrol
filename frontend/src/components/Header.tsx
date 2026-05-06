import { ThemePicker } from './ThemePicker';

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="site-brand" href="/">
          MTG Binder Planner
        </a>
        <nav className="site-nav">
          <ThemePicker />
        </nav>
      </div>
    </header>
  );
}
