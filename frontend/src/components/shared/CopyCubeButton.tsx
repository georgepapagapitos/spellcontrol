import { Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { copySharedCube } from '../../lib/copy-shared-cube';
import { toast } from '../../store/toasts';
import type { PublicCube } from '../../lib/shared-types';

interface Props {
  data: PublicCube;
}

/**
 * CTA that copies a shared cube into the visitor's saved cubes and sends them
 * to the cube page. Mirrors CopyDeckButton — works for logged-out visitors.
 */
export function CopyCubeButton({ data }: Props) {
  const navigate = useNavigate();

  function handleCopy() {
    copySharedCube(data);
    toast.show({ message: 'Cube copied to your cubes.', tone: 'success' });
    void navigate('/collection/cube');
  }

  return (
    <button type="button" className="btn btn-primary shared-copy-btn" onClick={handleCopy}>
      <Copy width={14} height={14} strokeWidth={2} aria-hidden />
      Copy cube
    </button>
  );
}
