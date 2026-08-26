import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';

const IMAGE_EXTS = /\.(png|jpe?g|gif|svg)$/i;

/**
 * Inline preview for images and PDFs opened from the Explorer.
 * Supports zoom, fit-width and rotate. PDFs render in an <iframe> using the
 * browser's built-in viewer.
 */
export function ImageViewer({ path }: { path: string }) {
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const [rotation, setRotation] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const url = api.rawFileUrl(path);
  const isPdf = path.toLowerCase().endsWith('.pdf');
  const isSvg = /\.svg$/i.test(path);

  // Reset view when switching files
  useEffect(() => {
    setScale(1);
    setFit(true);
    setRotation(0);
  }, [path]);

  const computeFit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
  }, []);

  useEffect(() => {
    computeFit();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => computeFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeFit]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-200 px-2 text-xs dark:border-zinc-800">
        <span className="truncate font-mono text-[11px] text-zinc-500">{path}</span>
        <div className="flex-1" />
        {!isPdf && (
          <>
            <button
              className={tbBtn}
              title="Zoom out"
              onClick={() => {
                setFit(false);
                setScale((s) => Math.max(0.1, s - 0.15));
              }}
            >
              −
            </button>
            <span className="w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
            <button
              className={tbBtn}
              title="Zoom in"
              onClick={() => {
                setFit(false);
                setScale((s) => Math.min(6, s + 0.15));
              }}
            >
              +
            </button>
            <button
              className={`${tbBtn} ${fit ? 'text-blue-600 dark:text-blue-400' : ''}`}
              onClick={() => setFit(true)}
            >
              Fit
            </button>
          </>
        )}
        <button
          className={tbBtn}
          title="Rotate"
          onClick={() => {
            setFit(false);
            setRotation((r) => (r + 90) % 360);
          }}
        >
          ⟳
        </button>
        <a className={tbBtn} href={url} download title="Download">
          ⭳
        </a>
      </div>

      {/* Content */}
      <div ref={containerRef} className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-zinc-100 p-4 dark:bg-[#141416]">
        {isPdf ? (
          <iframe src={url} title={path} className="h-full w-full border-0 bg-white" />
        ) : (
          <img
            src={url}
            alt={path}
            draggable={false}
            style={
              isSvg || IMAGE_EXTS.test(path)
                ? {
                    transform: `rotate(${rotation}deg)`,
                    maxWidth: fit ? '100%' : undefined,
                    width: fit ? undefined : `${Math.round(600 * scale)}px`,
                    height: 'auto',
                    transition: fit ? 'max-width .12s' : 'width .08s linear',
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

const tbBtn =
  'rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 select-none cursor-pointer';
