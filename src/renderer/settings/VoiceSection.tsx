import { useCallback, useEffect, useRef, useState } from 'react';
import { entryState, Row } from './PreferenceControls.tsx';
import type { PreferenceProps } from './PreferenceControls.tsx';

type Microphone = { deviceId: string; label: string };
export function VoiceSection({ preferences, snapshot }: PreferenceProps) {
  const [devices, setDevices] = useState<Microphone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const active = useRef(false), generation = useRef(0);
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!media?.enumerateDevices) { setError('Microphone selection is not available in this browser.'); return; }
    setLoading(true); setError(null);
    try {
      const list = await media.enumerateDevices();
      if (active.current && generation.current === current) setDevices(list.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
        .map(device => ({ deviceId: device.deviceId, label: device.label })));
    } catch (reason) { if (active.current && generation.current === current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (active.current && generation.current === current) setLoading(false); }
  }, [media]);
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  useEffect(() => { void load(); }, [load, revision]);
  useEffect(() => {
    if (!media?.addEventListener) return;
    const changed = () => setRevision(value => value + 1);
    media.addEventListener('devicechange', changed); return () => media.removeEventListener('devicechange', changed);
  }, [media]);
  const requestAccess = async () => {
    if (!media?.getUserMedia) { setError('Microphone access is not available in this browser.'); return; }
    setLoading(true); setError(null);
    try {
      const stream = await media.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      if (active.current) await load();
    } catch (reason) { if (active.current) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); } }
  };
  const entry = snapshot.microphoneInputDeviceId;
  return <>
    <div className="yard-section-heading"><h2>Voice</h2><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button></div>
    <p className="yard-muted">Voice chat and dictation are not available for this connection. A microphone preference can be saved for when they become available.</p>
    <div className="yard-setting-group"><Row label="Microphone" description="Choose a browser microphone, or use the system default." error={entry.error} retry={() => { void preferences.reload('microphoneInputDeviceId'); }}>
      <select aria-label="Microphone" value={entry.value ?? ''} disabled={entryState(entry).disabled || loading || !media?.enumerateDevices}
        onChange={event => preferences.edit('microphoneInputDeviceId', event.target.value || null)}>
        <option value="">System default</option>
        {entry.value && !devices.some(device => device.deviceId === entry.value) && <option value={entry.value}>Unavailable microphone</option>}
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
      </select>
    </Row></div>
    {loading && <p role="status">Loading microphones...</p>}
    {error && <p className="yard-setting-error" role="alert">Could not load microphones: {error} <button type="button" className="yard-link" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {media?.getUserMedia && <button type="button" disabled={loading} onClick={() => { void requestAccess(); }}>Allow microphone access</button>}
    <h3>Voice chat</h3><p className="yard-muted">Voice selection and voice chat shortcuts require voice chat support.</p>
    <h3>Dictation</h3><p className="yard-muted">Dictation, its shortcuts, dictionary and recordings require dictation support.</p>
  </>;
}
