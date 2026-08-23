import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ZoomMode = 'percent' | 'fit-width' | 'fit-page';

interface PreviewState {
  pdfUrl: string | null;
  scale: number;
  zoomMode: ZoomMode;
  page: number;
  pageCount: number;
  rotation: number;

  setPdf: (url: string | null) => void;
  setScale: (s: number) => void;
  setZoomMode: (m: ZoomMode) => void;
  setPage: (p: number) => void;
  setPageCount: (n: number) => void;
  rotate: () => void;
}

export const usePreviewStore = create<PreviewState>()(
  persist(
    (set, get) => ({
      pdfUrl: null,
      scale: 1.0,
      zoomMode: 'fit-width',
      page: 1,
      pageCount: 0,
      rotation: 0,

      setPdf: (pdfUrl) => set({ pdfUrl, page: 1 }),
      setScale: (scale) => set({ scale: Math.min(4, Math.max(0.25, scale)), zoomMode: 'percent' }),
      setZoomMode: (zoomMode) => set({ zoomMode }),
      setPage: (page) => set({ page }),
      setPageCount: (pageCount) => set({ pageCount }),
      rotate: () => set({ rotation: (get().rotation + 90) % 360 }),
    }),
    {
      name: 'latex-studio-preview',
      partialize: (s) => ({ scale: s.scale, zoomMode: s.zoomMode }),
    }
  )
);
