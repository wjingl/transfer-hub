import { useEffect, useRef, useState } from 'preact/hooks';
import { cimbarWorkerUrl, checkCimbarRuntime } from './runtime';

type CSSProps = Record<string, string | number>;

const S = {
  section: { background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: 18, marginBottom: 16 } as CSSProps,
  label: { display: 'block', color: '#8b949e', fontSize: 12, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 } as CSSProps,
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } as CSSProps,
  button: { background: '#238636', color: '#fff', border: 0, borderRadius: 7, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' } as CSSProps,
  secondary: { background: '#21262d', color: '#f0f6fc', border: '1px solid #30363d', borderRadius: 7, padding: '10px 14px', cursor: 'pointer' } as CSSProps,
  video: { width: '100%', maxWidth: 720, display: 'block', margin: '14px auto 0', borderRadius: 8, background: '#000' } as CSSProps,
  status: { color: '#8b949e', fontSize: 13, marginTop: 10 } as CSSProps,
  warning: { color: '#d29922', background: '#2d1b00', border: '1px solid #9e6a03', padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5 } as CSSProps,
  result: { background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: 14, marginTop: 12 } as CSSProps,
} as const;

export function CimbarReceivePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('允许摄像头后，对准 Cimbar 发送画面。');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number[]>([]);
  const [result, setResult] = useState<{ data: ArrayBuffer; filename: string } | null>(null);

  useEffect(() => () => stop(), []);

  const start = async () => {
    setError('');
    setResult(null);
    setProgress([]);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持摄像头。请使用 HTTPS/localhost，或改用 RaptorQR GIF 接收。');
      return;
    }
    const runtime = await checkCimbarRuntime();
    if (!runtime.available) {
      setError(`Cimbar 运行时缺少：${runtime.missing.join(', ')}`);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 }, frameRate: { ideal: 15 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('摄像头预览初始化失败。');
      video.srcObject = stream;
      await video.play();

      const worker = new Worker(cimbarWorkerUrl('cimbar-recv-worker.js'));
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data || {};
        if (message.type === 'ready') {
          worker.postMessage({ type: 'configure', mode: 0 });
          setStatus('正在扫描 Cimbar 画面…');
        } else if (message.type === 'progress') {
          setProgress(Array.isArray(message.progress) ? message.progress : []);
        } else if (message.type === 'complete') {
          setResult({ data: message.data, filename: message.filename || 'cimbar-recovered.bin' });
          setStatus('接收完成。');
          stop();
        } else if (message.type === 'scan' && message.result === 'packet') {
          setStatus('已读取数据包，继续扫描…');
        } else if (message.type === 'error') {
          setError(message.message || 'Cimbar 解码失败。');
        }
      };
      worker.onerror = (event) => setError(event.message || 'Cimbar 解码 Worker 出错。');
      setRunning(true);
      inFlightRef.current = false;
      const capture = () => {
        if (!streamRef.current || !videoRef.current || !canvasRef.current) return;
        const currentVideo = videoRef.current;
        const canvas = canvasRef.current;
        if (!inFlightRef.current && currentVideo.readyState >= 2 && currentVideo.videoWidth > 0) {
          const max = 640;
          const scale = Math.min(1, max / Math.max(currentVideo.videoWidth, currentVideo.videoHeight));
          const width = Math.max(1, Math.round(currentVideo.videoWidth * scale));
          const height = Math.max(1, Math.round(currentVideo.videoHeight * scale));
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(currentVideo, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height).data.buffer;
            inFlightRef.current = true;
            worker.postMessage({ type: 'frame', pixels, width, height, format: 'RGBA' }, [pixels]);
            window.setTimeout(() => { inFlightRef.current = false; }, 80);
          }
        }
        rafRef.current = requestAnimationFrame(capture);
      };
      rafRef.current = requestAnimationFrame(capture);
    } catch (cause) {
      setError(`摄像头启动失败：${cause instanceof Error ? cause.message : String(cause)}`);
      stop();
    }
  };

  function stop() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
    inFlightRef.current = false;
    setRunning(false);
  }

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.data], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div>
      <section style={S.section}>
        <div style={S.label}>Cimbar 摄像头接收</div>
        <p style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.5, margin: '0 0 12px' }}>
          将摄像头对准发送端的 Cimbar 画面。应用会自动提取彩色条码并重组文件。
        </p>
        <div style={S.row}>
          {!running ? <button type="button" style={S.button} onClick={start}>开始接收</button> : <button type="button" style={S.secondary} onClick={stop}>停止扫描</button>}
        </div>
        <div role="status" aria-live="polite" style={S.status}>{status}</div>
        {error && <div role="alert" style={{ ...S.warning, marginTop: 10 }}>⚠ {error}</div>}
      </section>

      <section style={S.section}>
        <div style={S.label}>摄像头画面</div>
        <video ref={videoRef} muted playsInline style={S.video} aria-label="Cimbar 摄像头预览" />
        <canvas ref={canvasRef} hidden />
        {progress.length > 0 && (
          <div style={{ marginTop: 12 }} aria-label="Cimbar 接收进度">
            {progress.map((value, index) => <div key={index} style={{ height: 8, background: '#21262d', borderRadius: 999, overflow: 'hidden', marginTop: 6 }}><div style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, height: '100%', background: '#58a6ff' }} /></div>)}
          </div>
        )}
      </section>

      {result && (
        <section style={S.section}>
          <div style={S.label}>恢复结果</div>
          <div style={S.result}>
            <strong>{result.filename}</strong>
            <span style={{ color: '#8b949e', marginLeft: 10 }}>{formatBytes(result.data.byteLength)}</span>
          </div>
          <button type="button" style={{ ...S.button, marginTop: 12 }} onClick={download}>下载恢复文件</button>
        </section>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
