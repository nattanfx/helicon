import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeliconApp, type AppIdentity } from "@helicon/ui";
import { Connect } from "./Connect.js";
import { desktopFrame, titlebarOverlay, bindDesktopZoom } from "./frame.js";
import { resolveAppIdentity } from "./identity.js";
import { bindDesktopLinks } from "./links.js";
import { appNotifier } from "./notifier.js";
import { appPlatform } from "./platform.js";
import { WebHeliconClient } from "./webClient.js";
import "./theme.css";

bindDesktopZoom();
bindDesktopLinks();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Helicon: missing #root element.");
}

/**
 * `#/connect` escolhe o servidor com quem esta página fala. É lido antes do app montar, porque o
 * cliente lê seu endereço uma vez no carregamento do módulo e todo stream aberto pertence a esse endereço.
 */
function Root() {
  const [connecting, setConnecting] = useState(window.location.hash === "#/connect");
  const [identity, setIdentity] = useState<AppIdentity | undefined>();
  useEffect(() => {
    void resolveAppIdentity().then(setIdentity, () => undefined);
  }, []);
  if (connecting) {
    return (
      <Connect
        onDone={() => {
          setConnecting(false);
          // Um recarregamento, não uma nova renderização: o cliente mantém seu endereço e seu stream desde o carregamento.
          window.location.replace(window.location.pathname);
        }}
      />
    );
  }
  return (
    <HeliconApp
      client={new WebHeliconClient()}
      platform={appPlatform()}
      frame={desktopFrame()}
      titlebarOverlay={titlebarOverlay()}
      identity={identity}
      notifier={appNotifier()}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
