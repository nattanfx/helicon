# Versão PT-BR e atualização manual

Este fork não usa o plug-in de atualização automática do Tauri. Não há feed `latest.json` configurado, `createUpdaterArtifacts` permanece desligado e os identificadores das instalações não mudam.

Instruções de download, Teste versus instalação normal, e a distinção entre a release pública e o código atual: [INSTALACAO.md](INSTALACAO.md).

## Release pública versus o que a interface mostra

- Última release **pública** deste fork: tag **[v0.12.4-pt4](https://github.com/nattanfx/helicon/releases/tag/v0.12.4-pt4)** (18/09/2026), commit `3709b6f`. Essa instalação mostra `0.12.4`.
- O número lido pelo Tauri (`version` em `tauri.conf.json`) neste código é `0.12.5-pt5`. A interface mostra esse número. A tag `v0.12.5-pt5` ainda não existe; o HEAD não é a release instalada.
- `0.12.5-pt5` é maior que `0.12.4` na comparação semver do instalador NSIS (Tauri 2.11). O campo numérico interno do Windows fica `0.12.5.0`; o texto de **Versão** no aplicativo é `0.12.5-pt5`.
- Uma compilação nova traz o SHA em **Compilação** só se o build injetar `HELICON_BUILD`. A instalação normal da pt4 não anuncia o HEAD atual.

## O que a interface mostra

- **Versão:** `getVersion()` do Tauri, lida de `apps/desktop/src-tauri/tauri.conf.json` (`version`, neste código `0.12.5-pt5`). Não é um número inventado na UI e não anuncia recursos do Helicon original.
- **Canal:** derivado do identificador do pacote.
  - `app.helicon.desktop` → instalação **normal**
  - `app.helicon.desktop.test` → **Helicon Teste**
- **Nome:** `getName()` do pacote (`Helicon` ou `Helicon Teste`).
- **Compilação:** SHA Git injetado em `HELICON_BUILD` no build do frontend. Só aparece se o valor for hexadecimal de 7 a 40 caracteres. Builds locais sem a variável omitem o campo; a UI não preenche um SHA fictício.
- **Servidor:** a seção Ambiente mostra `HELICON_VERSION` em `packages/server/src/server.ts`, com o rótulo **Servidor**. Neste código o valor é o mesmo `0.12.5-pt5` da versão do instalador. Esse texto também segue no `clientInfo` enviado ao Muse ao abrir o host.

A edição preparada é `0.12.5-pt5`. Isso não cria a tag, não publica a release e não troca o identificador da instalação normal (`app.helicon.desktop`).

## Builds da mesma edição

R1, os títulos em português e I1/I2/I4 mantêm a versão `0.12.5-pt5`. O número de versão sozinho não identifica os recursos de um instalador Teste. Em 22/09/2026, o HEAD `6306632` passou no [CI 94](https://github.com/nattanfx/helicon/actions/runs/35721942356) e no [Windows Teste 9](https://github.com/nattanfx/helicon/actions/runs/35725840859); confira **Compilação** ou `BUILD.txt` para identificar esse build.

Os manifests npm ainda declaram `0.12.4`; eles não são a fonte do campo **Versão** do desktop. As notas são conteúdo local em `packages/ui/src/model/notas.ts`, conferido por teste contra `docs/NOTAS-0.12.5-pt5.md`. Ao revisar as notas, atualizar ambas as cópias. Essa revisão textual só aparece no aplicativo depois de uma nova compilação.

## Como o SHA entra no instalador

1. Os workflows **Windows Teste** e **Release** definem `HELICON_BUILD` como `${{ github.sha }}` na compilação Tauri.
2. `beforeBuildCommand` roda `npm run build --workspace @helicon/web`.
3. O Vite expõe variáveis com prefixo `HELICON_` em `import.meta.env`.
4. `apps/web/src/identity.ts` lê `import.meta.env.HELICON_BUILD` e só aceita um SHA.
5. O Windows Teste também grava o commit em `BUILD.txt` ao lado do instalador de teste. O workflow Release não grava esse arquivo; o SHA aparece na interface quando a variável foi injetada.

O frontend compilado é o mesmo código para os dois canais; Teste e normal distinguem-se em tempo de execução pelo identificador Tauri, não por um canal gravado no JavaScript.

## Como atualizar

- **Helicon Teste:** Actions → Windows Teste → artefato `Helicon-Teste-Windows-…`. Instruções em `docs/TESTE-WINDOWS.md`.
- **Instalação normal:** a release pública atual é `v0.12.4-pt4`, em `https://github.com/nattanfx/helicon/releases`. Quando existir uma versão estável **nova deste fork**, baixar o instalador nessa mesma lista. Não baixar o atualizador nem as notas do repositório original.

Abrir ou reabrir o aplicativo não consulta plug-in de atualização. A oferta automática (verificar / baixar / instalar ao fechar) só voltaria se um shell passasse de novo um `AppUpdater`. Não há data prometida para a próxima release.
