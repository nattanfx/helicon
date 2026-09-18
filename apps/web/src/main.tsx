import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeliconApp } from "@helicon/ui";
import { Connect } from "./Connect.js";
import { desktopFrame, titlebarOverlay, bindDesktopZoom } from "./frame.js";
import { bindDesktopLinks } from "./links.js";
import { appNotifier } from "./notifier.js";
import { desktopUpdater } from "./updater.js";
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
      frame={desktopFrame()}
      titlebarOverlay={titlebarOverlay()}
      updater={desktopUpdater()}
      notifier={appNotifier()}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
