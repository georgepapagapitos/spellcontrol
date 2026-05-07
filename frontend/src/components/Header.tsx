import { NavLink } from 'react-router-dom';
import { ThemePicker } from './ThemePicker';

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink className="site-brand" to="/collection" aria-label="MTG Binder Planner">
          <span className="site-brand-mark" aria-hidden="true">
            MBP
          </span>
          <span className="site-brand-text">MTG Binder Planner</span>
        </NavLink>
        <nav className="site-nav-links">
          <NavLink
            to="/collection"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            Collection
          </NavLink>
          <NavLink
            to="/binder"
            className={({ isActive }) => (isActive ? 'site-nav-link active' : 'site-nav-link')}
          >
            Binders
          </NavLink>
        </nav>
        <nav className="site-nav">
          <ThemePicker />
        </nav>
      </div>
    </header>
  );
}
