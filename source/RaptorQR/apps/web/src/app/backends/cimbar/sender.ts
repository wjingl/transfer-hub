import { cimbarWorkerUrl } from './runtime';

export type CimbarMode = 'B' | 'Bm' | 'Bu' | '4C';

export interface CimbarSenderCallbacks {
  onReady?: () => void;
  onAspectRatio?: (ratio: number) => void;
  onActive?: () => void;
  onTitle?: (title: string) => void;
  onError?: (message: string) => void;
}

export class CimbarSender {
  private worker: Worker | null = null;
  private canvas: HTMLCanvasElement;
  private callbacks: CimbarSenderCallbacks;
  private ready = false;

  constructor(canvas: HTMLCanvasElement, callbacks: CimbarSenderCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.worker) return;
    if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
      throw new Error('当前浏览器不支持 Cimbar 的后台渲染。');
    }
    if (!this.canvas.transferControlToOffscreen) {
      throw new Error('当前浏览器不支持 OffscreenCanvas。');
    }

    const worker = new Worker(cimbarWorkerUrl('send-worker.js'));
    this.worker = worker;
    worker.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
    worker.onerror = (event) => this.callbacks.onError?.(event.message || 'Cimbar 发送 Worker 出错。');

    const offscreen = this.canvas.transferControlToOffscreen();
    worker.postMessage({ fun: 'init_window', args: [offscreen] }, [offscreen]);
    await this.waitUntilReady();
  }

  setMode(mode: CimbarMode): void {
    this.post('setMode', [modeValue(mode)]);
  }

  setFps(fps: number): void {
    this.post('setFPS', [Math.max(1, Math.round(fps))]);
  }

  setPaused(paused: boolean): void {
    this.post('togglePause', [paused]);
  }

  async encode(file: File): Promise<void> {
    await this.start();
    this.post('importFile', [file]);
  }

  stop(): void {
    if (this.worker && this.ready) {
      this.post('togglePause', [true]);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  private post(fun: string, args: unknown[]): void {
    if (!this.worker || !this.ready) throw new Error('Cimbar 发送器尚未准备好。');
    this.worker.postMessage({ fun, args });
  }

  private handleMessage(message: any): void {
    if (message?.error) {
      this.callbacks.onError?.(message.message || 'Cimbar 发送失败。');
      return;
    }
    if (message?.fun === 'startWasm') {
      if (message.args?.[0]) {
        this.ready = true;
        this.callbacks.onReady?.();
      } else {
        this.callbacks.onError?.('Cimbar WASM 初始化失败。');
      }
    } else if (message?.fun === 'setAspectRatio') {
      this.callbacks.onAspectRatio?.(Number(message.args?.[0]) || 1);
    } else if (message?.fun === 'setActive') {
      this.callbacks.onActive?.();
    } else if (message?.fun === 'setTitle') {
      this.callbacks.onTitle?.(String(message.args?.[0] ?? ''));
    }
  }

  private waitUntilReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const previousReady = this.callbacks.onReady;
      const previousError = this.callbacks.onError;
      this.callbacks.onReady = () => {
        previousReady?.();
        resolve();
      };
      this.callbacks.onError = (message) => {
        previousError?.(message);
        reject(new Error(message));
      };
    });
  }
}

function modeValue(mode: CimbarMode): number {
  if (mode === '4C') return 4;
  if (mode === 'Bu') return 66;
  if (mode === 'Bm') return 67;
  return 68;
}
