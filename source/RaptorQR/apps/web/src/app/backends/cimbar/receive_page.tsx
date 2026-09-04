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
  progressArea: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 10,
    padding: '12px 14px',
    marginTop: 12,
  } as CSSProps,
  progressTrack: {
    height: 8,
    background: '#21262d',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 6,
    position: 'relative',
  } as CSSProps,
  progressFill: (widthPercent: number): CSSProps => ({
    width: `${widthPercent}%`,
    height: '100%',
    background: '#58a6ff',
    transition: 'width 200ms ease',
  }),
  indeterminateThumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    width: '34%',
    borderRadius: 999,
    background: 'linear-gradient(90deg, #58a6ff, #3fb950)',
    animation: 'transferhub-scan 1.15s ease-in-out infinite',
  },
  progressHint: { color: '#8b949e', fontSize: 12, marginTop: 8 } as CSSProps,
  percentText: { color: '#f0f6fc', fontWeight: 700, fontSize: 14 } as CSSProps,
  statsBar: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    fontSize: 12,
    color: '#8b949e',
    marginTop: 8,
    flexWrap: 'wrap',
  } as CSSProps,
  statValue: {
    color: '#c9d1d9',
    fontWeight: 600,
    fontFamily: 'monospace',
    fontSize: 13,
  } as CSSProps,
} as const;

const WORKER_READY_TIMEOUT_MS = 15000;

export function CimbarReceivePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const captureStartedRef = useRef(false);
  const readyTimerRef = useRef<number | null>(null);
  const packetCountRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [status, setStatus] = useState('允许摄像头后，对准 Cimbar 发送画面。');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number[]>([]);
  const [decodedPackets, setDecodedPackets] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [packetsPerSec, setPacketsPerSec] = useState(0);
  const [result, setResult] = useState<{ data: ArrayBuffer; filename: string; mime: string } | null>(null);

  useEffect(() => () => stop(), []);

  // Per-second activity stats while scanning.
  useEffect(() => {
    if (!running) return;
    setElapsedSec(0);
    setPacketsPerSec(0);
    let lastCount = packetCountRef.current;
    const id = window.setInterval(() => {
      const current = packetCountRef.current;
      setPacketsPerSec(current - lastCount);
      lastCount = current;
      setElapsedSec((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const clearReadyTimer = () => {
    if (readyTimerRef.current !== null) {
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  };

  const startCapture = (worker: Worker) => {
    if (captureStartedRef.current) return;
    captureStartedRef.current = true;

    const tick = () => {
      if (!captureStartedRef.current) return;
      const currentVideo = videoRef.current;
      const canvas = canvasRef.current;
      if (currentVideo && canvas && !inFlightRef.current && currentVideo.readyState >= 2 && currentVideo.videoWidth > 0) {
        const max = 640;
        const scale = Math.min(1, max / Math.max(currentVideo.videoWidth, currentVideo.videoHeight));
        const width = Math.max(1, Math.round(currentVideo.videoWidth * scale));
        const height = Math.max(1, Math.round(currentVideo.videoHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(currentVideo, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height).data.buffer;
          inFlightRef.current = true;
          worker.postMessage({ type: 'frame', pixels, width, height, format: 'RGBA' }, [pixels]);
          window.setTimeout(() => { inFlightRef.current = false; }, 80);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stop = () => {
    captureStartedRef.current = false;
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
    clearReadyTimer();
    setRunning(false);
    setInitializing(false);
  };

  const start = async () => {
    setError('');
    setResult(null);
    setProgress([]);
    packetCountRef.current = 0;
    setDecodedPackets(0);
    setElapsedSec(0);
    setPacketsPerSec(0);
    captureStartedRef.current = false;

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
      setInitializing(true);
      setStatus('正在初始化 Cimbar 解码器…');

      // Fail clearly if the WASM runtime never reports ready.
      readyTimerRef.current = window.setTimeout(() => {
        if (captureStartedRef.current) return;
        setError('Cimbar 解码器初始化超时，请刷新页面后重试。');
        setInitializing(false);
      }, WORKER_READY_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent) => {
        const message = event.data || {};
        if (message.type === 'ready') {
          clearReadyTimer();
          worker.postMessage({ type: 'configure', mode: 0 });
          setInitializing(false);
          setRunning(true);
          setStatus('正在扫描：将 Cimbar 彩色画面保持在取景框内');
          startCapture(worker);
          return;
        }
        if (message.type === 'progress') {
          const next = Array.isArray(message.progress) ? message.progress : [];
          setProgress(next.filter((value: unknown) => Number.isFinite(Number(value))));
          return;
        }
        if (message.type === 'scan' && message.result === 'packet') {
          packetCountRef.current += 1;
          setDecodedPackets(packetCountRef.current);
          return;
        }
        if (message.type === 'complete') {
          setResult({
            data: message.data,
            filename: message.filename || 'cimbar-recovered.bin',
            mime: message.mime || 'application/octet-stream',
          });
          setStatus('接收完成 ✓');
          stop();
          return;
        }
        if (message.type === 'error') {
          setError(message.message || 'Cimbar 解码失败。');
          setInitializing(false);
        }
      };
      worker.onerror = (event) => {
        setError(event.message || 'Cimbar 解码 Worker 出错。');
        setInitializing(false);
        clearReadyTimer();
      };
    } catch (cause) {
      setError(`摄像头启动失败：${cause instanceof Error ? cause.message : String(cause)}`);
      stop();
    }
  };

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.data], { type: result.mime || 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.filename || 'cimbar-recovered.bin';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const overallPercent = progress.length > 0
    ? Math.max(...progress.map((value) => Math.max(0, Math.min(100, value * 100))))
    : 0;
  const hasDeterminateProgress = progress.length > 0;

  return (
    <div>
      <style>{`@keyframes transferhub-scan { 0% { left: -35%; } 60% { left: 100%; } 100% { left: 100%; } }`}</style>

      <section style={S.section}>
        <div style={S.label}>Cimbar 摄像头接收</div>
        <p style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.5, margin: '0 0 12px' }}>
          将摄像头对准发送端的 Cimbar 画面。应用会自动提取彩色条码并重组文件。
        </p>
        <div style={S.row}>
          {!running && !initializing
            ? <button type="button" style={S.button} onClick={start}>开始接收</button>
            : <button type="button" style={S.secondary} onClick={stop}>停止扫描</button>}
        </div>
        <div role="status" aria-live="polite" style={S.status}>{status}</div>
        {error && <div role="alert" style={{ ...S.warning, marginTop: 10 }}>⚠ {error}</div>}

        {/* ── Always-visible progress panel while scanning ── */}
        {(running || hasDeterminateProgress) && (
          <div style={S.progressArea} aria-label="Cimbar 接收进度">
            {hasDeterminateProgress ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: '#8b949e', fontSize: 12 }}>重组进度</span>
                  <span style={S.percentText}>{overallPercent.toFixed(0)}%</span>
                </div>
                <div style={S.progressTrack}>
                  <div style={S.progressFill(overallPercent)} />
                </div>
                {progress.map((value, index) => (
                  <div key={index} style={{ ...S.progressTrack, marginTop: 6 }}>
                    <div style={S.progressFill(Math.max(0, Math.min(100, value * 100)))} />
                  </div>
                ))}
                <div style={S.progressHint}>数据到达中，正在重组文件…</div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: '#8b949e', fontSize: 12 }}>正在扫描</span>
                  {decodedPackets > 0
                    ? <span style={S.percentText}>已锁定信号</span>
                    : <span style={{ color: '#d29922', fontSize: 12 }}>等待有效画面…</span>}
                </div>
                <div style={S.progressTrack}>
                  <div style={S.indeterminateThumb} />
                </div>
                <div style={S.progressHint}>
                  {decodedPackets > 0
                    ? `正在持续接收数据（数据包 ${decodedPackets}）…`
                    : '对准发送端画面并保持静止；解码到首个数据包后进度将开始增长。'}
                </div>
              </>
            )}

            <div style={S.statsBar} aria-label="Cimbar 接收统计">
              <span>数据包 <span style={S.statValue}>{decodedPackets}</span></span>
              <span>速率 <span style={S.statValue}>{packetsPerSec} /s</span></span>
              <span>已运行 <span style={S.statValue}>{formatDuration(elapsedSec)}</span></span>
              {hasDeterminateProgress && (
                <span>进度 <span style={S.statValue}>{overallPercent.toFixed(0)}%</span></span>
              )}
            </div>
          </div>
        )}
      </section>

      <section style={S.section}>
        <div style={S.label}>摄像头画面</div>
        <video ref={videoRef} muted playsInline style={S.video} aria-label="Cimbar 摄像头预览" />
        <canvas ref={canvasRef} hidden />
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

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
