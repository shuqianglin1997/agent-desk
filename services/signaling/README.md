# AgentDesk Signaling Gateway

这是 Personal Agent Mesh 的最小会合服务。它只维护短期在线租约、转发固定 WebRTC offer/answer、转发一次性配对请求，并可签发 coturn REST 短期凭据。

它不接收 Agent 目录、会话信息、文件、屏幕、键鼠或任意业务消息。

## 本地运行

要求 Node.js 22.12 或更新版本：

```bash
npm run signaling:start
```

默认监听 `0.0.0.0:8787`。桌面端本机开发可在“设备 → 网络设置”填写：

```text
http://127.0.0.1:8787
```

公网必须在反向代理后提供 HTTPS，例如 `https://signal.example.com`。

## 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `AGENTDESK_SIGNALING_HOST` | `0.0.0.0` | 监听地址 |
| `AGENTDESK_SIGNALING_PORT` / `PORT` | `8787` | 监听端口 |
| `AGENTDESK_TURN_URLS` | 空 | 逗号分隔的 `turn:` / `turns:` 地址 |
| `AGENTDESK_TURN_SECRET` | 空 | 与 coturn `static-auth-secret` 一致的 REST secret |
| `AGENTDESK_TURN_TTL_SECONDS` | `3600` | 客户端 TURN 凭据有效期 |

没有同时设置 TURN URL 和 secret 时，`/v1/turn-credentials` 不可用；信令与 P2P 直连仍正常工作。

## Docker

```bash
docker build -f services/signaling/Dockerfile -t agentdesk-signaling .
docker run --rm -p 8787:8787 \
  -e AGENTDESK_TURN_URLS='turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp' \
  -e AGENTDESK_TURN_SECRET='replace-with-a-long-random-secret' \
  agentdesk-signaling
```

生产部署需在前方使用 Caddy、Nginx 或等价入口终止 TLS，并对 `/v1/poll` 保留至少 30 秒上游超时。服务本身不记录请求正文；反向代理也不应记录正文、查询参数或设备标识。

## coturn 对接

coturn 至少需要与网关相同的 secret：

```ini
use-auth-secret
static-auth-secret=replace-with-a-long-random-secret
realm=turn.example.com
fingerprint
no-multicast-peers
no-loopback-peers
```

再按部署网络开放 UDP/TCP 3478、TLS 5349 和明确的 relay 端口范围。桌面端只取得短期 username/credential，不保存 `static-auth-secret`。

## 健康检查

```bash
curl https://signal.example.com/v1/health
```

响应只包含协议版本和是否启用 TURN 签发，不暴露在线设备或队列信息。
