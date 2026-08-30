import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { authedFetch, api } from '../../api/client';
import { usePreviewStore } from '../../stores/previewStore';
import { useBuildStore } from '../../stores/buildStore';
import { useEditorStore } from '../../stores/editorStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useProjectIndexStore } from '../../stores/projectIndexStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const RENDER_MARGIN_PX = 600;

export function PdfPreview() {
  const { pdfUrl, scale, zoomMode, page, pageCount, rotation } = usePreviewStore();
  const setScale = usePreviewStore((s) => s.setScale);
  const setPage = usePreviewStore((s) => s.setPage);
  const setPageCount = usePreviewStore((s) => s.setPageCount);
  const mainFile = useWorkspaceStore((s) => s.mainFile);
  const index = useProjectIndexStore((s) => s.index);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const activeTasksRef = useRef<Set<{ cancel(): void }>>(new Set());

  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const suppressScroll = useRef(false);
  // V0.5 Reading Workspace rails
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [matchCountPerPage, setMatchCountPerPage] = useState<Record<number, number>>({});
  const [highlights, setHighlights] = useState<Record<number, HighlightRect[]>>({});
  const [currentMatch, setCurrentMatch] = useState(0); // 1-based, 0 = none
  const [searching, setSearching] = useState(false);
  const [synctexDiag, setSynctexDiag] = useState<string | null>(null);

  const totalPages = doc?.numPages ?? 0;

  // Flat match list derived from per-page counts (ordered by page).
  const flatMatches = useMemo(() => {
    const out: { page: number; indexInPage: number }[] = [];
    for (let p = 1; p <= totalPages; p++) {
      const n = matchCountPerPage[p] ?? 0;
      for (let k = 0; k < n; k++) out.push({ page: p, indexInPage: k });
    }
    return out;
  }, [matchCountPerPage, totalPages]);

  const current = useMemo(() => flatMatches[currentMatch - 1] ?? null, [flatMatches, currentMatch]);

  // ---- document lifecycle -------------------------------------------------
  useEffect(() => {
    if (!pdfUrl) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;
    setError(null);
    setMatchCountPerPage({});
    setHighlights({});
    setQuery('');
    setCurrentMatch(0);
    (async () => {
      try {
        const buf = await authedFetch(pdfUrl).then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body?.error?.message ?? `${r.status}`);
          }
          return r.arrayBuffer();
        });
        loaded = await pdfjsLib.getDocument({ data: buf }).promise;
        if (!cancelled) {
          setDoc(loaded);
          setPageCount(loaded.numPages);
          // V0.3 SyncTeX diagnostics (non-fatal indicator)
          fetch('/api/build/latest')
            .then((r) => r.json())
            .then((latest) => {
              if (!latest?.buildId) return;
              return fetch(
                `/api/build/${encodeURIComponent(latest.buildId)}/synctex/diagnostics`
              ).then((r) => r.json());
            })
            .then((d) => {
              if (!d) return;
              setSynctexDiag(d.ok ? null : `SyncTeX unavailable — ${d.reason ?? ''} ${d.suggestion ?? ''}`);
            })
            .catch(() => {});
        } else {
          void loaded.destroy();
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || 'Failed to load PDF');
          setDoc(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
      for (const t of activeTasksRef.current) {
        try {
          t.cancel();
        } catch {
          /* noop */
        }
      }
      activeTasksRef.current.clear();
      observerRef.current?.disconnect();
    };
  }, [pdfUrl, setPageCount]);

  // ---- fit computation ----------------------------------------------------
  const computeFit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !doc) return;
    void doc.getPage(1).then((p) => {
      const vp = p.getViewport({ scale: 1, rotation });
      const availW = el.clientWidth - 24;
      const availH = el.clientHeight - 24;
      setFitScale(
        zoomMode === 'fit-page'
          ? Math.min(availW / vp.width, availH / vp.height)
          : availW / vp.width
      );
    });
  }, [doc, zoomMode, rotation]);

  useEffect(() => {
    computeFit();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => computeFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeFit]);

  const effectiveScale = zoomMode === 'percent' ? scale : fitScale;

  useEffect(() => {
    if (!doc) return;
    setRenderVersion((v) => v + 1);
  }, [doc, effectiveScale, rotation]);

  // ---- lazy page rendering (virtualized via IntersectionObserver) ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !doc) return;

    observerRef.current?.disconnect();

    const renderPage = async (pageIndex: number) => {
      const canvas = canvasesRef.current[pageIndex];
      if (!canvas || !doc) return;
      const versionKey = String(renderVersion);
      if (canvas.dataset.rendered === versionKey) return;
      canvas.dataset.rendered = versionKey;

      try {
        const p = await doc.getPage(pageIndex + 1);
        const viewport = p.getViewport({
          scale: effectiveScale * window.devicePixelRatio,
          rotation,
        });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / window.devicePixelRatio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / window.devicePixelRatio)}px`;
        const ctx = canvas.getContext('2d')!;
        const task = p.render({ canvasContext: ctx, viewport });
        activeTasksRef.current.add(task as unknown as { cancel(): void });
        await task.promise.catch(() => {});
        activeTasksRef.current.delete(task as unknown as { cancel(): void });

        if (query.trim()) {
          const cssViewport = p.getViewport({ scale: effectiveScale, rotation });
          const rects = await computeHighlights(p, cssViewport, query.trim());
          setHighlights((h) => ({ ...h, [pageIndex + 1]: rects }));
        }
      } catch {
        /* cancelled or destroyed */
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.pageIndex ?? -1);
            if (idx >= 0) void renderPage(idx);
          }
        }
      },
      { root: el, rootMargin: `${RENDER_MARGIN_PX}px` }
    );
    observerRef.current = io;

    for (let i = 0; i < doc.numPages; i++) {
      const holder = pageRefs.current[i];
      const canvas = canvasesRef.current[i];
      if (holder) io.observe(holder);
      // Clear stale canvases from a previous render version
      if (canvas && canvas.dataset.rendered !== undefined && canvas.dataset.rendered !== String(renderVersion)) {
        canvas.dataset.rendered = '';
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    return () => io.disconnect();
  }, [doc, effectiveScale, rotation, renderVersion, query]);

  // ---- search -------------------------------------------------------------
  const scrollToPage = useCallback(
    (n: number) => {
      const el = containerRef.current;
      const target = pageRefs.current[n - 1];
      if (el && target) {
        suppressScroll.current = true;
        el.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
        setPage(n);
        setTimeout(() => (suppressScroll.current = false), 500);
      }
    },
    [setPage]
  );

  const runSearch = useCallback(async () => {
    if (!doc || !query.trim()) {
      setMatchCountPerPage({});
      setHighlights({});
      setCurrentMatch(0);
      return;
    }
    setSearching(true);
    try {
      const counts: Record<number, number> = {};
      const allHighlights: Record<number, HighlightRect[]> = {};
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const viewport = p.getViewport({ scale: effectiveScale, rotation });
        const rects = await computeHighlights(p, viewport, query.trim());
        if (rects.length > 0) {
          counts[i] = rects.length;
          allHighlights[i] = rects;
        }
      }
      setMatchCountPerPage(counts);
      setHighlights(allHighlights);
      const firstPage = Number(Object.keys(counts)[0] ?? 0);
      setCurrentMatch(firstPage ? 1 : 0);
      if (firstPage) scrollToPage(firstPage);
    } finally {
      setSearching(false);
    }
  }, [doc, query, effectiveScale, rotation]);

  const step = useCallback(
    (delta: number) => {
      if (flatMatches.length === 0) return;
      const next = ((currentMatch - 1 + delta + flatMatches.length) % flatMatches.length) + 1;
      setCurrentMatch(next);
      const target = flatMatches[next - 1];
      if (target) scrollToPage(target.page);
    },
    [flatMatches, currentMatch, scrollToPage]
  );

  // ---- scrolling / paging ---------------------------------------------------
  const handleScroll = useCallback(() => {
    if (suppressScroll.current) return;
    const el = containerRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let current2 = 1;
    for (const h of pageRefs.current) {
      if (h && h.offsetTop <= mid) current2 = Number(h.dataset.pageIndex ?? 0) + 1;
    }
    if (current2 !== usePreviewStore.getState().page) setPage(current2);
  }, [setPage]);

  const goToPage = useCallback(
    (n: number) => scrollToPage(Math.min(Math.max(1, n), Math.max(1, pageCount))),
    [pageCount, scrollToPage]
  );

  // ---- V0.5 Reading Workspace: remember where the reader stopped -----------
  const renderPageDirect = useCallback(
    async (pageNum: number) => {
      // Render a page immediately, bypassing the virtualizer: unrendered
      // pages have placeholder heights, so a resume scroll into unrendered
      // territory would land wrong and never settle.
      const canvas = canvasesRef.current[pageNum - 1];
      if (!canvas || !doc) return;
      try {
        const p = await doc.getPage(pageNum);
        const viewport = p.getViewport({
          scale: effectiveScale * window.devicePixelRatio,
          rotation,
        });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / window.devicePixelRatio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / window.devicePixelRatio)}px`;
        const ctx = canvas.getContext('2d')!;
        const task = p.render({ canvasContext: ctx, viewport });
        activeTasksRef.current.add(task as unknown as { cancel(): void });
        await task.promise.catch(() => {});
        activeTasksRef.current.delete(task as unknown as { cancel(): void });
      } catch {
        /* destroyed */
      }
    },
    [doc, effectiveScale, rotation]
  );

  const resumedKey = useRef<string | null>(null);
  const resumeDoneFor = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || !mainFile) return;
    const key = `${mainFile}:${pdfUrl}`;
    if (resumedKey.current === key) return; // zoom/rotate re-runs must not re-jump
    let cancelled = false;
    api
      .readingState()
      .then(async (state) => {
        resumeDoneFor.current = key; // probe done — saving may start
        const saved = state[mainFile];
        if (cancelled || !saved || saved <= 1 || saved > doc.numPages) return;
        resumedKey.current = key;
        await renderPageDirect(saved);
        if (cancelled) return;
        goToPage(saved);
        // second anchor after neighbouring pages settle — only when the
        // reader has not already moved somewhere else
        setTimeout(() => {
          if (!cancelled && usePreviewStore.getState().page === saved) goToPage(saved);
        }, 500);
      })
      .catch(() => {
        if (!cancelled) resumeDoneFor.current = key;
      });
    return () => {
      cancelled = true;
    };
  }, [doc, mainFile, pdfUrl, goToPage, renderPageDirect]);

  useEffect(() => {
    if (!doc || !mainFile || page < 1) return;
    // until the resume probe settles, a scroll-triggered page 1 must not
    // overwrite the stored position before it is ever read
    if (resumeDoneFor.current !== `${mainFile}:${pdfUrl}`) return;
    const t = setTimeout(() => {
      void api.saveReadingState(mainFile, page).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [page, doc, mainFile, pdfUrl]);

  const jumpToSection = useCallback(
    async (file: string, line: number) => {
      const buildId = useBuildStore.getState().buildId;
      if (!buildId) return;
      try {
        const hit = await api.synctexForward(buildId, file, line);
        if (hit?.page) goToPage(hit.page);
      } catch {
        /* no mapping for this section yet */
      }
    },
    [goToPage]
  );

  // ---- SyncTeX inverse: click a PDF location → jump to source -------------
  const handleCanvasClick = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return; // plain clicks stay passive
      const buildId = useBuildStore.getState().buildId;
      if (!buildId || !doc) return;
      const canvas = e.currentTarget;
      const holder = canvas.closest('[data-page-index]') as HTMLElement | null;
      if (!holder) return;
      const pageNum = Number(holder.dataset.pageIndex) + 1;
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      try {
        const p = await doc.getPage(pageNum);
        const vp1 = p.getViewport({ scale: 1, rotation });
        const [x, y] = vp1.convertToPdfPoint(nx * vp1.width, ny * vp1.height);
        const hit = await api.synctexInverse(buildId, pageNum, x, y);
        if (hit?.file) {
          await useEditorStore.getState().openFileAtLine(hit.file, hit.line);
        }
      } catch {
        /* synctex unavailable or no mapping — ignore */
      }
    },
    [doc, rotation]
  );

  // ---- empty / error states -----------------------------------------------
  if (!pdfUrl) {
    return (
      <div className="flex h-full items-center justify-center select-none">
        <div className="text-center text-sm text-zinc-500">
          <p>No PDF yet</p>
          <p className="mt-1 text-xs">Press Ctrl+B to build after opening a workspace.</p>
        </div>
      </div>
    );
  }

  const counter = searching ? '…' : flatMatches.length > 0 ? `${currentMatch} / ${flatMatches.length}` : query.trim() ? '0 / 0' : '';

  return (
    <div className="flex h-full flex-col bg-zinc-100 dark:bg-[#141416]">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-200 px-2 text-xs dark:border-zinc-800">
        <button className={tbBtn} onClick={() => setScale(effectiveScale - 0.1)} title="Zoom out">−</button>
        <span className="w-12 text-center tabular-nums">{Math.round(effectiveScale * 100)}%</span>
        <button className={tbBtn} onClick={() => setScale(effectiveScale + 0.1)} title="Zoom in">+</button>
        <button
          className={`${tbBtn} ${zoomMode === 'fit-width' ? 'text-blue-600 dark:text-blue-400' : ''}`}
          onClick={() => usePreviewStore.getState().setZoomMode('fit-width')}
        >
          Fit Width
        </button>
        <span className="mx-1 text-zinc-300 dark:text-zinc-700">|</span>
        <button className={tbBtn} onClick={() => goToPage(page - 1)}>‹</button>
        <span className="tabular-nums whitespace-nowrap">Page {page} / {pageCount || '?'}</span>
        <button className={tbBtn} onClick={() => goToPage(page + 1)}>›</button>

        <div className="ml-2 flex items-center gap-1 rounded border border-zinc-200 bg-white px-1 dark:border-zinc-700 dark:bg-zinc-900">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) step(-1);
                else if (flatMatches.length === 0 || currentMatch >= flatMatches.length) void runSearch();
                else step(1);
              } else if (e.key === 'Escape') {
                setQuery('');
                setMatchCountPerPage({});
                setHighlights({});
                setCurrentMatch(0);
              }
            }}
            placeholder="Find…"
            className="w-24 bg-transparent py-0.5 outline-none"
          />
          <span className="whitespace-nowrap tabular-nums text-zinc-400">{counter}</span>
        </div>
        {synctexDiag && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200" title={synctexDiag}>⚠ SyncTeX</span>
        )}

        <div className="flex-1" />
        <button
          className={tbBtn}
          title="Page thumbnails"
          onClick={() => setThumbsOpen((v) => !v)}
        >
          ▦
        </button>
        <button
          className={tbBtn}
          title="Outline — click a section to jump to its page"
          onClick={() => setOutlineOpen((v) => !v)}
        >
          ☰
        </button>
        <button
          className={tbBtn}
          title="Rotate"
          onClick={() => usePreviewStore.setState({ rotation: (rotation + 90) % 360 })}
        >
          ⟳
        </button>
        <button
          className={tbBtn}
          title="Fullscreen"
          onClick={() => {
            const el = containerRef.current?.parentElement;
            if (el && !document.fullscreenElement) void el.requestFullscreen();
            else void document.exitFullscreen();
          }}
        >
          ⛶
        </button>
        <a className={tbBtn} href={pdfUrl} download title="Download PDF">⭳</a>
      </div>

      {/* Pages, flanked by the optional thumbnail and outline rails */}
      <div className="flex min-h-0 flex-1">
        {thumbsOpen && doc && <ThumbsRail doc={doc} onJump={goToPage} />}
        <div ref={containerRef} onScroll={handleScroll} className="min-w-0 flex-1 overflow-auto p-3">
        {error && (
          <div className="m-4 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            Failed to load PDF: {error}
          </div>
        )}
        <div className="flex flex-col items-center gap-3">
          {doc &&
            Array.from({ length: doc.numPages }, (_, i) => {
              const pageNum = i + 1;
              const pageRects = highlights[pageNum] ?? [];
              return (
                <div
                  key={pageNum}
                  data-page-index={i}
                  ref={(el) => {
                    pageRefs.current[i] = el;
                  }}
                  className="relative bg-white shadow-md"
                >
                  <canvas
                    onClick={(ev) => void handleCanvasClick(ev)}
                    title="Ctrl+Click for SyncTeX inverse search"
                    ref={(c) => {
                      canvasesRef.current[i] = c;
                    }}
                  />
                  {pageRects.map((r, k) => (
                    <mark
                      key={k}
                      className={`pointer-events-none absolute ${
                        current && current.page === pageNum && current.indexInPage === k
                          ? 'bg-orange-400/60'
                          : 'bg-yellow-300/45'
                      }`}
                      style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                    />
                  ))}
                </div>
              );
            })}
        </div>
        </div>
        {outlineOpen && <OutlineRail onJump={(f, l) => void jumpToSection(f, l)} />}
      </div>
    </div>
  );
}

/** V0.5 Reading Workspace — lazy page thumbnails; click jumps to the page. */
function ThumbsRail({ doc, onJump }: { doc: pdfjsLib.PDFDocumentProxy; onJump: (n: number) => void }) {
  const page = usePreviewStore((s) => s.page);
  const railRef = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    const root = railRef.current;
    if (!root || !doc) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.thumb ?? -1);
          const canvas = refs.current[idx];
          if (!canvas || canvas.dataset.done === '1') continue;
          canvas.dataset.done = '1';
          void doc
            .getPage(idx + 1)
            .then((p) => {
              if (!canvas.isConnected) return;
              const vp = p.getViewport({ scale: 100 / p.getViewport({ scale: 1 }).width });
              canvas.width = Math.floor(vp.width);
              canvas.height = Math.floor(vp.height);
              return p.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
            })
            .catch(() => {});
        }
      },
      { root, rootMargin: '200px' }
    );
    for (const el of Array.from(root.querySelectorAll('[data-thumb]'))) io.observe(el);
    return () => io.disconnect();
  }, [doc]);

  return (
    <div ref={railRef} className="w-[124px] shrink-0 overflow-y-auto border-r border-zinc-200 p-2 dark:border-zinc-800">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <button
          key={i}
          data-thumb={i}
          onClick={() => onJump(i + 1)}
          title={`Page ${i + 1}`}
          className={`mb-2 block w-full rounded border bg-white p-0.5 ${
            page === i + 1 ? 'border-blue-500' : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-700'
          }`}
        >
          <canvas ref={(c) => { refs.current[i] = c; }} className="w-full" />
          <div className="text-center text-[10px] text-zinc-400">{i + 1}</div>
        </button>
      ))}
    </div>
  );
}

/** V0.5 Reading Workspace — the paper's sections; click jumps via SyncTeX. */
function OutlineRail({ onJump }: { onJump: (file: string, line: number) => void }) {
  const index = useProjectIndexStore((s) => s.index);
  const sections = useMemo(
    () =>
      [...(index?.sections ?? [])].sort((a, b) =>
        a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
      ),
    [index]
  );
  return (
    <div className="w-48 shrink-0 overflow-y-auto border-l border-zinc-200 p-2 dark:border-zinc-800">
      <p className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
        Outline
      </p>
      {sections.length === 0 && <p className="text-xs text-zinc-400">No sections indexed.</p>}
      {sections.map((s, i) => (
        <button
          key={`${s.file}:${s.line}:${i}`}
          onClick={() => onJump(s.file, s.line)}
          className="block w-full truncate rounded px-1 py-0.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          style={{ paddingLeft: `${4 + s.level * 10}px` }}
          title={`Jump to page — ${s.file}:${s.line}`}
        >
          {s.title}
        </button>
      ))}
    </div>
  );
}

/** Find query occurrences on a page and map them to CSS-pixel viewport rects. */
/**
 * Find query occurrences on a page, including matches that span adjacent
 * text items (whitespace-joined). Each occurrence produces one highlight
 * rect per involved item portion.
 */
async function computeHighlights(
  p: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport,
  query: string
): Promise<HighlightRect[]> {
  const tc = await p.getTextContent();
  const q = query.toLowerCase().replace(/\s+/g, ' ');
  const rects: HighlightRect[] = [];
  if (!q) return rects;

  interface Piece {
    str: string;
    lower: string;
    tx: number[];
    fontHeight: number;
    widthCss: number;
  }
  const pieces: Piece[] = [];
  for (const item of tc.items) {
    if (!('str' in item) || !item.str) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    pieces.push({
      str: item.str,
      lower: item.str.toLowerCase(),
      tx,
      fontHeight: Math.hypot(tx[2], tx[3]),
      widthCss: item.width * viewport.scale,
    });
  }

  // Build concatenated stream with per-piece offsets (single space joins).
  let haystack = '';
  const pieceSpans: { start: number; end: number; pieceIdx: number }[] = [];
  for (let pi = 0; pi < pieces.length; pi++) {
    if (haystack.length > 0) haystack += ' ';
    const start = haystack.length;
    haystack += pieces[pi].lower;
    pieceSpans.push({ start, end: haystack.length, pieceIdx: pi });
  }

  // Locate matches in the joined stream.
  const matchStarts: number[] = [];
  let pos = haystack.indexOf(q);
  while (pos !== -1 && matchStarts.length < 50) {
    matchStarts.push(pos);
    pos = haystack.indexOf(q, pos + q.length);
  }

  for (const mStart of matchStarts) {
    const mEnd = mStart + q.length;
    for (const span of pieceSpans) {
      const overlapStart = Math.max(mStart, span.start);
      const overlapEnd = Math.min(mEnd, span.end);
      if (overlapStart >= overlapEnd) continue;
      const piece = pieces[span.pieceIdx];
      const localStart = overlapStart - span.start;
      const localLen = overlapEnd - overlapStart;
      if (localLen <= 0 || localStart >= piece.lower.length) continue;
      const ratio = Math.min(1, localStart / Math.max(1, piece.str.length));
      const lenRatio = Math.min(1, localLen / Math.max(1, piece.str.length));
      rects.push({
        left: piece.tx[4] + piece.widthCss * ratio,
        top: piece.tx[5] - piece.fontHeight,
        width: Math.max(4, piece.widthCss * lenRatio),
        height: piece.fontHeight * 1.15,
      });
      if (rects.length >= 80) return rects;
    }
  }
  return rects;
}

const tbBtn =
  'rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 select-none cursor-pointer';
