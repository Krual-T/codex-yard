import { useState } from 'react';
import { createRoot } from 'react-dom/client';

declare const __CHROME_LOCATION__: string;
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
type Preview = { pageId?: number; image?: string; text: string; capturedAt?: string };

function BrowserPreview() {
  const [pages, setPages] = useState(''), [pageId, setPageId] = useState('1');
  const [url, setUrl] = useState(''), [uid, setUid] = useState(''), [text, setText] = useState(''), [key, setKey] = useState('Enter');
  const [preview, setPreview] = useState<Preview>(), [status, setStatus] = useState('请先读取标签列表'), [busy, setBusy] = useState(false);
  async function run(action: string) {
    setBusy(true); setStatus('正在' + (action === 'pages' ? '读取标签' : '更新预览'));
    try {
      const response = await fetch('/command', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ action, pageId: Number(pageId), url, uid, text, key }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === 'pages') setPages(result.text); else setPreview(result);
      setStatus(action === 'pages' ? '标签列表已更新' : '预览已更新');
    } catch (error) { setStatus((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main>
    <style>{`body{margin:0;background:#f6f7f8;color:#20252b;font:15px system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}h1{font-size:24px;margin:0 0 8px}p{line-height:1.6}fieldset{border:1px solid #d9dfe4;border-radius:8px;background:white;padding:16px;margin:16px 0;display:flex;flex-wrap:wrap;align-items:end;gap:12px}label{display:grid;gap:6px}input{font:inherit;padding:8px;border:1px solid #aeb9c2;border-radius:4px;max-width:100%;box-sizing:border-box}button{font:inherit;cursor:pointer;border:0;border-radius:4px;background:#245e77;color:white;padding:9px 14px}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:16px;border:1px solid #d9dfe4;max-height:280px;overflow:auto}img{display:block;width:100%;border:1px solid #d9dfe4;border-radius:8px;background:white}figcaption{padding:10px 0;color:#50616d}figure{margin:16px 0}.wide{flex:1;min-width:220px}input.short{width:110px}:focus-visible{outline:3px solid #d7991e;outline-offset:3px}`}</style>
    <h1>连接已有 Chrome</h1>
    <p>Chrome 位置：{__CHROME_LOCATION__}。切换工作台的 SSH 执行主机不会切换浏览器。</p>
    <p>画面按操作刷新；读取画面、导航和输入都会聚焦真实 Chrome 标签，可能把你从工作台切走。可在 Chrome 直接使用完整网页。</p>
    <fieldset disabled={busy}>
      <legend>选择标签</legend>
      <button onClick={() => void run('pages')}>读取标签列表</button>
      <label>标签 ID<input className="short" inputMode="numeric" value={pageId} onChange={event => setPageId(event.target.value)} /></label>
      <button onClick={() => void run('view')}>刷新画面</button>
      <button onClick={() => void run('focus')}>切换到 Chrome 标签</button>
    </fieldset>
    {pages && <pre aria-label="标签列表">{pages}</pre>}
    <form onSubmit={event => { event.preventDefault(); void run('navigate'); }}>
      <fieldset disabled={busy}><legend>导航</legend>
        <label className="wide">网页地址<input type="url" required placeholder="https://example.com" value={url} onChange={event => setUrl(event.target.value)} /></label>
        <button>在所选标签导航</button>
      </fieldset>
    </form>
    <p role="status">{status}</p>
    {preview?.image && <figure><img src={preview.image} alt="所选 Chrome 标签的最新画面" />
      <figcaption>标签 {preview.pageId} · {preview.capturedAt && new Date(preview.capturedAt).toLocaleTimeString()} · 按需截图</figcaption>
    </figure>}
    {preview && <details open><summary>页面结构与元素 UID</summary><pre aria-label="页面结构">{preview.text}</pre></details>}
    <fieldset disabled={busy || !preview}>
      <legend>操作页面元素</legend>
      <label>元素 UID<input className="short" placeholder="1_2" value={uid} onChange={event => setUid(event.target.value)} /></label>
      <label className="wide">填入内容<input value={text} onChange={event => setText(event.target.value)} /></label>
      <button onClick={() => void run('fill')}>填入</button><button onClick={() => void run('click')}>点击元素</button>
      <label>按键<input className="short" value={key} onChange={event => setKey(event.target.value)} /></label>
      <button onClick={() => void run('key')}>发送按键</button>
    </fieldset>
  </main>;
}

createRoot(document.getElementById('root')!).render(<BrowserPreview />);
