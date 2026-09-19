import { getIdentifier, getName, getVersion } from "@tauri-apps/api/app";
import {
  channelFromIdentifier,
  channelProductName,
  manualUpdateUrl,
  sanitizeBuild,
  webIdentity,
  type AppIdentity,
} from "@helicon/ui";

export interface IdentitySource {
  isDesktop: boolean;
  getVersion: () => Promise<string>;
  getIdentifier: () => Promise<string>;
  getName: () => Promise<string>;
  build?: string | null;
}

function readInjectedBuild(): string | null {
  const env = (import.meta as ImportMeta & { env?: { HELICON_BUILD?: string } }).env;
  return sanitizeBuild(env?.HELICON_BUILD);
}

function desktopSource(): IdentitySource {
  return {
    isDesktop: typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
    getVersion,
    getIdentifier,
    getName,
    build: readInjectedBuild(),
  };
}

/**
 * Lê a identidade do pacote em execução. No desktop, versão e canal vêm do Tauri;
 * o SHA só aparece se o build o injetou. Sem desktop, não inventa versão nem canal Teste.
 */
export async function resolveAppIdentity(source: IdentitySource = desktopSource()): Promise<AppIdentity> {
  const build = sanitizeBuild(source.build) ?? (source.build === undefined ? readInjectedBuild() : null);
  if (!source.isDesktop) {
    return webIdentity(build);
  }
  try {
    const [version, identifier, name] = await Promise.all([source.getVersion(), source.getIdentifier(), source.getName()]);
    const channel = channelFromIdentifier(identifier);
    const productName = name.trim() || channelProductName(channel);
    return {
      version: version.trim(),
      channel,
      productName,
      identifier: identifier.trim() || null,
      build,
      updateUrl: manualUpdateUrl(channel),
    };
  } catch {
    return webIdentity(build);
  }
}
