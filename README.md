# Transfer Hub Web App

## 本地打开

不要直接双击 `index.html`。浏览器的 `file://` 安全策略会阻止 ES Module、Worker、WASM、`fetch()` 和 Service Worker 正常工作。

Windows 用户可以直接双击：

```text
open-transfer-hub.bat
```

它会在本机启动 HTTP 服务并打开：

```text
http://127.0.0.1:8080/
```

也可以手动运行：

```bash
python -m http.server 8080
```

然后打开 `http://localhost:8080/`。

