import './cube.css';
import { BackLink } from '../../components/BackLink';
import { PageHeader } from '../../components/PageHeader';
import { CollabCube } from './CollabCube';

/**
 * `/decks/cube/new/friends` — the "With friends" start from the chooser.
 * `CollabCube` is moved here unchanged; folding it into the "Draw from"
 * disclosure every other build uses is a later lane's work (board note).
 */
export function CubeFriendsPage() {
  return (
    <div className="cube-page">
      <BackLink to="/decks/cube/new" label="New cube" />
      <PageHeader title="With friends" meta="Pool your cards with up to 3 friends' collections." />
      <CollabCube />
    </div>
  );
}
