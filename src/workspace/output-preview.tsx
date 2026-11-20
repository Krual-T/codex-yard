import { useEffect, useState } from 'react';
import { outputFileUrl, type OutputFile } from './output-types.ts';

function InlineFile({ file, preview, hostId }: { file: OutputFile; preview: 'image' | 'text'; hostId: string }) {
  const [result, setResult] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(outputFileUrl(file, 'content', hostId, 4 * 1024 * 1024), { signal: controller.signal });
        if (!response.ok) throw new Error();
        const value = preview === 'image' ? await response.blob() : await response.text();
        if (controller.signal.aborted) return;
        if (typeof value === 'string') setResult(value);
        else {
          if (!/^image\/(png|jpeg|gif|webp|avif)$/i.test(value.type)) throw new Error();
          objectUrl = URL.createObjectURL(value);
          setResult(objectUrl);
        }
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, preview, hostId]);
  if (failed) return <p className="yard-source-file-status" role="alert">Preview unavailable.</p>;
  if (result === undefined) return <p className="yard-source-file-status" role="status">Loading…</p>;
  return preview === 'image' ? <img className="yard-source-file-image" src={result} alt={file.name} onError={() => setFailed(true)} /> :
    <pre className="yard-source-file-text">{result}</pre>;
}

export function OutputPreview({ file, hostId }: { file: OutputFile; hostId: string }) {
  if (file.preview === 'html') return <iframe className="yard-source-file-frame" title={file.name}
    sandbox="allow-scripts" referrerPolicy="no-referrer" src={outputFileUrl(file, 'html-preview', hostId)} />;
  if (!file.preview) return <p className="yard-source-file-status">Preview unavailable.</p>;
  return <InlineFile key={hostId + ':' + file.path} file={file} preview={file.preview} hostId={hostId} />;
}
