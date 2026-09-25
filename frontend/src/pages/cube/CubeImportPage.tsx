import './cube.css';
import { BackLink } from '../../components/BackLink';
import { PageHeader } from '../../components/PageHeader';
import { ImportCube } from './ImportCube';

/**
 * `/decks/cube/new/import` — the "Import a cube" start from the chooser.
 * `ImportCube` is moved here unchanged; folding "Build my version" into the
 * regular build flow is a later lane's work.
 */
export function CubeImportPage() {
  return (
    <div className="cube-page">
      <BackLink to="/decks/cube/new" label="New cube" />
      <PageHeader
        title="Import a cube"
        meta="Paste a public CubeCobra link and see what you already own."
      />
      <ImportCube />
    </div>
  );
}
