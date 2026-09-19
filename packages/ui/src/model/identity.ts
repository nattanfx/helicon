/**
 * Identidade do aplicativo neste fork: versão do pacote, canal Teste/normal e
 * compilação injetada no build. Não inventa SHA nem número de versão.
 */

export type AppChannel = "normal" | "teste" | "web";

export const NORMAL_IDENTIFIER = "app.helicon.desktop";
export const TEST_IDENTIFIER = "app.helicon.desktop.test";

export const FORK_REPO_URL = "https://github.com/nattanfx/helicon";
export const FORK_RELEASES_URL = "https://github.com/nattanfx/helicon/releases";
export const FORK_TEST_ACTIONS_URL = "https://github.com/nattanfx/helicon/actions/workflows/test-windows.yml";

export interface AppIdentity {
  /** Versão do pacote Tauri ou metadado equivalente; vazia quando o shell não informa. */
  version: string;
  channel: AppChannel;
  /** Nome do produto no pacote, por exemplo Helicon ou Helicon Teste. */
  productName: string;
  identifier: string | null;
  /** SHA Git injetado em tempo de compilação; nulo quando o build não forneceu um. */
  build: string | null;
  updateUrl: string;
}

export function channelFromIdentifier(identifier: string | null | undefined): AppChannel {
  const id = identifier?.trim() ?? "";
  if (!id) {
    return "web";
  }
  if (id === TEST_IDENTIFIER || id.endsWith(".desktop.test")) {
    return "teste";
  }
  return "normal";
}

export function channelProductName(channel: AppChannel): string {
  switch (channel) {
    case "teste":
      return "Helicon Teste";
    case "web":
      return "Helicon (navegador)";
    default:
      return "Helicon";
  }
}

export function manualUpdateUrl(channel: AppChannel): string {
  switch (channel) {
    case "teste":
      return FORK_TEST_ACTIONS_URL;
    case "normal":
      return FORK_RELEASES_URL;
    default:
      return FORK_REPO_URL;
  }
}

/** Aceita só SHA Git hexadecimal injetado no build; rejeita vazio, “unknown” e números de versão. */
export function sanitizeBuild(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) {
    return null;
  }
  if (!/^[0-9a-f]{7,40}$/i.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

export function shortBuild(build: string): string {
  return build.length > 7 ? build.slice(0, 7) : build;
}

export function identityHeading(identity: AppIdentity): string {
  const version = identity.version.trim();
  if (version) {
    return `${identity.productName} ${version}`;
  }
  return identity.productName;
}

export function identitySummary(identity: AppIdentity): string {
  const parts = [channelSummary(identity.channel)];
  if (identity.build) {
    parts.push(`Compilação ${shortBuild(identity.build)}`);
  }
  return parts.join(" · ");
}

export function channelSummary(channel: AppChannel): string {
  switch (channel) {
    case "teste":
      return "Canal de teste, separado da instalação normal";
    case "normal":
      return "Instalação normal deste fork";
    default:
      return "Aberto no navegador";
  }
}

export function channelDescription(channel: AppChannel): string {
  switch (channel) {
    case "teste":
      return "Canal de teste. Usa identificador e pasta de dados próprios; não substitui a instalação normal. A conta e a CLI do Muse são compartilhadas.";
    case "normal":
      return "Instalação normal deste fork. O Helicon Teste é um aplicativo separado, com identificador e dados próprios.";
    default:
      return "Página no navegador, sem o identificador do instalador Windows.";
  }
}

export function manualUpdateHint(channel: AppChannel): string {
  switch (channel) {
    case "teste":
      return "Este fork não atualiza sozinho. Para uma compilação nova, baixe o artefato Helicon Teste em Actions → Windows Teste. Não use o atualizador nem as releases do Helicon original.";
    case "normal":
      return "Este fork não atualiza sozinho. Quando houver uma versão estável nova, baixe o instalador nas releases deste repositório. Não use o atualizador nem as notas do Helicon original.";
    default:
      return "O aplicativo Windows deste fork está no repositório GitHub. Não use instaladores do projeto original se quiser as mudanças em português.";
  }
}

export function webIdentity(build: string | null = null): AppIdentity {
  return {
    version: "",
    channel: "web",
    productName: channelProductName("web"),
    identifier: null,
    build,
    updateUrl: manualUpdateUrl("web"),
  };
}
