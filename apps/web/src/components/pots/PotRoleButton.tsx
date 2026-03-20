import { useState } from 'react';
import { PotRoleModal } from './PotRoleModal';

interface PotRoleButtonProps {
  potId: string;
}

export function PotRoleButton({ potId }: PotRoleButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn-secondary"
        onClick={() => setOpen(true)}
        title="Configure AI agent role for this pot"
        style={{ fontSize: '0.8rem', padding: '5px 12px' }}
      >
        Agent Role
      </button>
      {open && <PotRoleModal potId={potId} onClose={() => setOpen(false)} />}
    </>
  );
}
