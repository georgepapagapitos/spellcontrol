import { useState } from 'react';
import { useParams } from 'react-router-dom';
import './CubePage.css';
import { Tabs } from '../components/Tabs';
import { BuildCube } from './cube/BuildCube';
import { CollabCube } from './cube/CollabCube';
import { ImportCube } from './cube/ImportCube';

export function CubePage() {
  // `/collection/cube/:id` deep-links a specific saved cube — it lives in the
  // build tab's "My cubes" list, so a deep-link always lands on build mode.
  const { id: deepLinkId } = useParams();
  const [mode, setMode] = useState<'build' | 'import' | 'collaborate'>('build');
  return (
    <div className="cube-page">
      {/* Hero band — joins the .binder-hero family every sibling hub page
          uses (Collection/Binders/Lists); the bare <h1> read as unfinished. */}
      <header className="binder-hero">
        <h1 className="binder-hero-name">Cube workshop</h1>
        <p className="binder-hero-meta cube-page-sub">
          Build a draftable singleton cube from your collection, or import one from CubeCobra to see
          how much of it you own.
        </p>
      </header>
      <Tabs
        ariaLabel="Cube tools"
        variant="underline"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'build', label: 'Build from my collection', controls: 'cube-panel' },
          { id: 'import', label: 'Import a cube', controls: 'cube-panel' },
          { id: 'collaborate', label: 'Build with friends', controls: 'cube-panel' },
        ]}
      />
      <div
        id="cube-panel"
        role="tabpanel"
        aria-labelledby={`sc-tab-${mode}`}
        className="cube-panel"
      >
        {mode === 'build' ? (
          <BuildCube highlightId={deepLinkId} />
        ) : mode === 'import' ? (
          <ImportCube />
        ) : (
          <CollabCube />
        )}
      </div>
    </div>
  );
}
