/**
 * dsh-chrome — 桥自启（纯模块，可单测）。Host 插件自己起回环桥，
 * 端口被占（另一个会话已起）就当 client 用，不抛错。
 * dispose 会等 listen 落定：自己起的才关，蹭别人的不动。
 */
import { createBridge } from "./bridge-server.js";

export function ensureBridge({ bridgeHost, bridgePort }) {
  const bridge = createBridge({ host: bridgeHost, port: bridgePort });
  let owned = null;
  const started = bridge
    .listen()
    .then(() => {
      owned = true;
    })
    .catch(() => {
      owned = false;
    });
  return {
    started,
    isOwned: () => owned,
    dispose: () =>
      started
        .then(() => {
          if (owned) return bridge.close().catch(() => {});
        })
        .catch(() => {}),
  };
}
