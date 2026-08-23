import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { authedFetch } from '../../api/client';
import { usePreviewStore } from '../../stores/previewStore';

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

  // Search state
  const [query, setQuery] = useState('');
  const [matchCountPerPage, setMatchCountPerPage] = useState<Record<number, number>>({});
  const [highlights, setHighlights] = useState<Record<number, HighlightRect[]>>({});
  const [currentMatch, setCurrentMatch] = useState(0); // 1-based, 0 = none
  const [searching, setSearching] = useState(false);

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

        <div className="flex-1" />
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

      {/* Pages */}
      <div ref={containerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto p-3">
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
    </div>
  );
}

/** Find query occurrences on a page and map them to CSS-pixel viewport rects. */
async function computeHighlights(
  p: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport,
  query: string
): Promise<HighlightRect[]> {
  const tc = await p.getTextContent();
  const q = query.toLowerCase();
  const rects: HighlightRect[] = [];

  for (const item of tc.items) {
    if (!('str' in item) || !item.str) continue;
    const lower = item.str.toLowerCase();
    let start = lower.indexOf(q);
    while (start !== -1 && rects.length < 50) {
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const itemWidthCss = item.width * viewport.scale;
      const left = tx[4] + itemWidthCss * (start / item.str.length);
      const top = tx[5] - fontHeight;
      const width = Math.max(4, itemWidthCss * (q.length / item.str.length));
      rects.push({ left, top, width, height: fontHeight * 1.15 });
      start = lower.indexOf(q, start + q.length);
    }
  }
  return rects;
}

const tbBtn =
  'rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 select-none cursor-pointer';
