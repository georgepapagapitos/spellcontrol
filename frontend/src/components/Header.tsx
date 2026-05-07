import { NavLink } from 'react-router-dom';
import { ThemePicker } from './ThemePicker';

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink className="site-brand" to="/collection">
          MTG Binder Planner
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
            Binder
          </NavLink>
        </nav>
        <nav className="site-nav">
          <ThemePicker />
        </nav>
      </div>
    </header>
  );
}
