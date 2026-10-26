'use client';

import { VARIABLES } from './quick-replies';

const chip = 'rounded-input border border-border-strong px-2 py-1 text-12';

/** "Chèn biến": one button per variable of Đợt 1 (N163), for the text box of a template. */
export function VariableButtons({ onInsert }: { onInsert: (name: string) => void }) {
  return (
    <div role="group" aria-label="Chèn biến" className="flex flex-wrap items-center gap-2">
      <span className="text-12 text-text-muted">Chèn biến:</span>
      {VARIABLES.map(([name, label]) => (
        <button key={name} type="button" className={chip} onClick={() => onInsert(name)}>
          {label}
        </button>
      ))}
    </div>
  );
}
