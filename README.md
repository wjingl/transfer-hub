# Transfer Hub

统一的本地文件/文本传输界面，整合两套成熟后端：

- **RaptorQR** — 标准二维码 + RaptorQ/JS-RLNC，文本 / 文件 / GIF / 摄像头接收
- **Cimbar** — 彩色条码文件传输，摄像头接收（fountain + zstd）

所有处理都在浏览器本地完成，不上传文件。两套协议彼此独立，不可交叉扫描。

## 在线版本（HTTPS，支持摄像头）

https://wjingl.github.io/transfer-hub/

## 便携离线包（内网分享）

GitHub Releases 下载 `TransferHub-portable.zip`，解压后：

- Windows：双击 `open-transfer-hub.bat`（系统自带 PowerShell，零安装）
- macOS / Linux：`bash open-transfer-hub.sh`（需 Python 3）

端口由操作系统自动分配的空闲本地端口（不使用 8080），自动打开浏览器，关闭窗口即停止。

## 仓库结构

```text
index.html / assets / cimbar   # 静态发布页（GitHub Pages 根）
server.py / server.ps1 / *.bat / *.sh   # 便携启动器
source/RaptorQR                # 完整 RaptorQR 工程源码
source/libcimbar               # 完整 libcimbar 工程源码
```

`source/` 保留两个上游完整工程的源码、测试与构建配置（排除依赖目录与本地缓存）。

## 从源码构建

```bash
cd source/RaptorQR
pnpm install
pnpm build          # 构建会自动同步固定版本 Cimbar 运行时
```

构建产物位于 `source/RaptorQR/apps/web/dist`，复制到仓库根即可更新 Pages 内容。

## 许可

两个上游工程及其许可文件见 `source/RaptorQR/LICENSE` 与 `source/libcimbar/LICENSE`。
