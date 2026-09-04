# Transfer Hub

一个统一的浏览器界面，整合两套本地文件/文本传输后端：

- **RaptorQR**：标准 QR + RaptorQ/JS-RLNC，支持文本、文件、实时播放、GIF 和摄像头接收。
- **Cimbar**：`libcimbar` 彩色条码后端，支持 WASM 文件发送、摄像头接收、fountain 重组和 zstd 解压。

所有处理都在浏览器本地完成，不上传文件。

## 在线版本

GitHub Pages 根目录就是可发布的静态应用，打开仓库 Pages 地址即可使用：

```text
https://wjingl.github.io/transfer-hub/
```

在线页面使用 HTTPS，适合手机摄像头接收。两台设备选择相同的协议：

```text
RaptorQR 发送 → RaptorQR 接收
Cimbar 发送   → Cimbar 接收
```

两套协议不能交叉扫描。

## 使用方式

1. 顶部选择 **发送** 或 **接收**。
2. 选择 **RaptorQR** 或 **Cimbar**。
3. 发送端拖放/选择文件，选择需要的模式后点击“开始发送”。
4. 接收端选择相同协议，点击“开始接收”，将摄像头对准发送画面。
5. 完成后复制恢复文本或下载恢复文件。

RaptorQR 的高级设置仍保留在原页面中；Cimbar 页面提供兼容、平衡、高密度和彩色模式，以及暂停、停止和速度调节。

## 仓库结构

```text
index.html              # GitHub Pages 入口（最终静态发布物）
assets/                 # Vite 打包后的 RaptorQR JS/Worker/WASM
cimbar/                 # Cimbar JS/Worker/WASM 运行时
source/RaptorQR/        # 完整 RaptorQR 工程源码
source/libcimbar/       # 完整 libcimbar 工程源码
```

`source/` 中保留两个完整工程的源码、测试和构建配置，但排除了各自 Git 元数据、`node_modules`、本地构建缓存和临时扫描文件。

## 从源码重新构建

进入完整 RaptorQR 工程：

```bash
cd source/RaptorQR
pnpm install
pnpm build
```

构建会自动同步固定版本的 Cimbar 浏览器运行时：

```bash
pnpm sync:cimbar
```

如已有官方 Cimbar 解压包，可设置 `CIMBAR_SOURCE_DIR` 避免重复下载。构建产物位于 `source/RaptorQR/apps/web/dist`，复制到仓库根目录即可更新 Pages 内容。

## 本地运行

不要直接双击 `index.html`，请使用静态 HTTP 服务器：

```bash
python -m http.server 8080
```

然后打开 `http://localhost:8080/`。同一设备上的 `localhost` 通常允许摄像头；手机访问时请使用 HTTPS，普通局域网 HTTP 地址可能被浏览器拒绝摄像头权限。

## 许可

本仓库包含两个上游工程及其各自依赖，许可文件见：

- `source/RaptorQR/LICENSE`
- `source/libcimbar/LICENSE`
