# Versão PT-BR e atualização manual

Este fork não usa o plug-in de atualização automática do Tauri. Não há feed `latest.json` configurado, `createUpdaterArtifacts` permanece desligado e os identificadores das instalações não mudam.

## O que a interface mostra

- **Versão:** `getVersion()` do Tauri, lida de `apps/desktop/src-tauri/tauri.conf.json` (`version`, hoje `0.12.4`). Não é um número inventado na UI e não anuncia recursos do Helicon original.
- **Canal:** derivado do identificador do pacote.
  - `app.helicon.desktop` → instalação **normal**
  - `app.helicon.desktop.test` → **Helicon Teste**
- **Nome:** `getName()` do pacote (`Helicon` ou `Helicon Teste`).
- **Compilação:** SHA Git injetado em `HELICON_BUILD` no build do frontend. Só aparece se o valor for hexadecimal de 7 a 40 caracteres. Builds locais sem a variável omitem o campo; a UI não preenche um SHA fictício.
- **Servidor:** a seção Ambiente continua mostrando a versão do servidor local (`HELICON_VERSION` no pacote do servidor), com o rótulo **Servidor**, para não misturar com a identidade do instalador.

A escolha do próximo número de versão estável fica para a etapa de release. Esta etapa não publica tag nem troca o identificador da instalação normal.

## Como o SHA entra no instalador

1. O workflow **Windows Teste** define `HELICON_BUILD` como `${{ github.sha }}` na compilação Tauri.
2. `beforeBuildCommand` roda `npm run build --workspace @helicon/web`.
3. O Vite expõe variáveis com prefixo `HELICON_` em `import.meta.env`.
4. `apps/web/src/identity.ts` lê `import.meta.env.HELICON_BUILD` e só aceita um SHA.
5. O mesmo commit também é gravado em `BUILD.txt` ao lado do instalador.

O frontend compilado é o mesmo código para os dois canais; Teste e normal distinguem-se em tempo de execução pelo identificador Tauri, não por um canal gravado no JavaScript.

## Como atualizar

- **Helicon Teste:** Actions → Windows Teste → artefato `Helicon-Teste-Windows-…`. Instruções em `docs/TESTE-WINDOWS.md`.
- **Instalação normal:** quando houver release deste fork, usar as releases de `https://github.com/nattanfx/helicon`. Não baixar o atualizador nem as notas do repositório original.

Abrir ou reabrir o aplicativo não consulta plug-in de atualização. A oferta automática (verificar / baixar / instalar ao fechar) só voltaria se um shell passasse de novo um `AppUpdater`.
