import { useState } from 'react';
import { useParams } from 'react-router-dom';
import './CubePage.css';
import { Tabs } from '../components/Tabs';
import { DecksHubTabs } from '../components/DecksHubTabs';
import { PageHeader } from '../components/PageHeader';
import { BackLink } from '../components/BackLink';
import { BuildCube } from './cube/BuildCube';
import { CollabCube } from './cube/CollabCube';
import { ImportCube } from './cube/ImportCube';

export function CubePage() {
  // `/decks/cube/:id` deep-links a specific saved cube — it lives in the
  // build tab's "My cubes" list, so a deep-link always lands on build mode.
  const { id: deepLinkId } = useParams();
  const [mode, setMode] = useState<'build' | 'import' | 'collaborate'>('build');
  return (
    <>
      <DecksHubTabs />
      <div className="cube-page">
        {/* Cube is a hub tab (DecksHubTabs above already reads "Decks"), but
          it's also the deepest, most tool-like surface in the family — a
          deliberate exit path back to the plain deck list, matching the
          Compare/New/Brew siblings rather than staying silent about it. */}
        <BackLink to="/decks" label="All decks" />
        {/* Hero band — joins the .binder-hero family every sibling hub page
          uses (Collection/Binders/Lists); the bare <h1> read as unfinished. */}
        <PageHeader
          title="Cube workshop"
          metaClassName="cube-page-sub"
          meta="Build a draftable singleton cube from your collection, or import one from CubeCobra to see how much of it you own."
        />
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
    </>
  );
}
