import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { errorMessage } from './file-service.ts';
import { panelError, usePanelText } from '../panels/panel-i18n.ts';

GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export function PdfViewer({ bytes }: { bytes: Uint8Array<ArrayBuffer> }) {
  const t = usePanelText();
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setDocument(undefined);
    setPage(1);
    setError(undefined);
    // PDF.js transfers the supplied buffer to its worker.
    const task = getDocument({ data: bytes.slice() });
    void task.promise.then(pdf => { if (active) setDocument(pdf); }).catch(reason => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; void task.destroy().catch(() => {}); };
  }, [bytes]);

  useEffect(() => {
    const canvas = canvasRef.current, text = textRef.current, container = pageRef.current;
    if (!document || !canvas || !text || !container) return;
    let active = true;
    let rendering: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setError(undefined);
    void document.getPage(page).then(async pdfPage => {
      if (!active) return;
      const viewport = pdfPage.getViewport({ scale });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error('Invalid PDF page size');
      const pixelRatio = Math.min(window.devicePixelRatio || 1, Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        8192 / viewport.width, 8192 / viewport.height);
      canvas.width = Math.max(1, Math.ceil(viewport.width * pixelRatio));
      canvas.height = Math.max(1, Math.ceil(viewport.height * pixelRatio));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;
      container.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
      text.replaceChildren();
      rendering = pdfPage.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      textLayer = new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport });
      await Promise.all([rendering.promise, textLayer.render()]);
    }).catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; rendering?.cancel(); textLayer?.cancel(); };
  }, [document, page, scale]);

  return <div className="yard-pdf-viewer">
    <div className="yard-pdf-toolbar" aria-label={t('PDF controls')}>
      <button type="button" className="yard-panel-icon" title={t('Previous page')} aria-label={t('Previous page')}
        disabled={!document || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
      <span aria-label={t('PDF page')}>{page} / {document?.numPages ?? '-'}</span>
      <button type="button" className="yard-panel-icon" title={t('Next page')} aria-label={t('Next page')}
        disabled={!document || page >= document.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
      <button type="button" className="yard-panel-icon" title={t('Zoom out')} aria-label={t('Zoom out')}
        disabled={scale <= 0.5} onClick={() => setScale(value => Math.max(0.5, value - 0.25))}><Minus /></button>
      <span aria-label={t('PDF zoom')}>{Math.round(scale * 100)}%</span>
      <button type="button" className="yard-panel-icon" title={t('Zoom in')} aria-label={t('Zoom in')}
        disabled={scale >= 3} onClick={() => setScale(value => Math.min(3, value + 0.25))}><Plus /></button>
    </div>
    {error ? <div className="yard-file-error" role="alert">{t('PDF preview: ')}{panelError(t, error)}</div> : null}
    <div className="yard-pdf-scroll">
      {document ? <div className="yard-pdf-page" ref={pageRef} key={`${page}:${scale}`}>
        <canvas ref={canvasRef} aria-label={t('PDF page {page}', {page})} />
        <div ref={textRef} className="yard-pdf-text-layer" />
      </div> : !error ? <div className="yard-file-status" role="status">{t('Loading PDF...')}</div> : null}
    </div>
  </div>;
}
