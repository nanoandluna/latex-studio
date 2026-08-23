import { useEffect, useRef, useState, useCallback } from 'react';

interface SplitterProps {
  orientation: 'vertical' | 'horizontal';
  onResize: (deltaPx: number) => void;
  className?: string;
}

/** A draggable divider. Reports pixel deltas while dragging. */
export function Splitter({ orientation, onResize, className = '' }: SplitterProps) {
  const [active, setActive] = useState(false);
  const lastPos = useRef(0);

  const handleMove = useCallback(
    (e: MouseEvent | MouseEvent) => {
      const pos = orientation === 'vertical' ? e.clientX : e.clientY;
      onResize(pos - lastPos.current);
      lastPos.current = pos;
    },
    [orientation, onResize]
  );

  useEffect(() => {
    if (!active) return;
    const move = (e: MouseEvent) => handleMove(e);
    const up = () => setActive(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [active, handleMove, orientation]);

  return (
    <div
      className={`splitter ${orientation === 'vertical' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'} shrink-0 bg-zinc-200 transition-colors dark:bg-zinc-800 ${active ? 'splitter-active' : ''} ${className}`}
      onMouseDown={(e) => {
        lastPos.current = orientation === 'vertical' ? e.clientX : e.clientY;
        setActive(true);
      }}
    />
  );
}
