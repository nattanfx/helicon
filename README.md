# Helicon PT-BR

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Instalador](https://img.shields.io/badge/instalador-Windows-blue.svg)](https://github.com/nattanfx/helicon/releases/tag/v0.12.4-pt4)
[![Upstream](https://img.shields.io/badge/original-Helicon-lightgrey.svg)](https://github.com/HarjjotSinghh/helicon)

Fork pessoal do [Helicon](https://github.com/HarjjotSinghh/helicon), em português, com modificações próprias quando úteis. O projeto original continua sendo a referência. Este repositório **não compete** com o Helicon, **não é um produto** e **não oferece suporte a terceiros** que o encontrem e baixem.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-hero-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/readme-hero-light.png" />
  <img alt="Helicon: cliente desktop e web para o Muse Code" src="docs/assets/readme-hero-light.png" />
</picture>

Cliente desktop e web para o **Muse Code CLI** (`muse`). A barra lateral agrupa projetos pela pasta de trabalho e permite retomar conversas, inclusive as iniciadas no terminal.

> **Não é oficial.** Não é feito, endossado ou suportado pela Meta. “Muse” e “Muse Code” são marcas da Meta, usadas só para descrever o que este cliente conecta. Isto **não é aconselhamento jurídico** — ver [Aviso](#aviso).

## Instalação no Windows

A última **release pública** deste fork é **[v0.12.4-pt4](https://github.com/nattanfx/helicon/releases/tag/v0.12.4-pt4)** (18/09/2026). O instalador Windows é `Helicon_0.12.4_x64-setup.exe`.

- Baixe **neste** repositório: [nattanfx/helicon/releases](https://github.com/nattanfx/helicon/releases).
- **Não** use [as releases do Helicon original](https://github.com/HarjjotSinghh/helicon/releases/latest) se quiser as mudanças em português deste fork.
- A atualização é **manual**. O aplicativo **não** se atualiza sozinho.
- O código em `prod` está **à frente** da pt4 e declara a edição `0.12.5-pt5`. Instalar a pt4 não instala esse código; a tag `v0.12.5-pt5` existe no commit `757317c` e o instalador está num rascunho de release **não publicado**. Notas: [docs/NOTAS-0.12.5-pt5.md](docs/NOTAS-0.12.5-pt5.md).

Passos, canal Teste versus instalação normal, e o que este fork não entrega: [docs/INSTALACAO.md](docs/INSTALACAO.md). Identidade na interface: [docs/VERSAO-PT-BR.md](docs/VERSAO-PT-BR.md).

O instalador inclui Node.js. É preciso ter o Muse CLI e `muse login` feitos uma vez (`irm https://dev.meta.ai/install.ps1 | iex` no PowerShell, ou o Muse no WSL2). O Helicon usa esse login e não guarda credenciais próprias.

## Helicon Teste e instalação normal

São aplicativos separados:

| Canal | Onde aparece | Identificador | Onde baixar |
| --- | --- | --- | --- |
| Normal | **Helicon** | `app.helicon.desktop` | [Releases deste fork](https://github.com/nattanfx/helicon/releases) |
| Teste | **Helicon Teste** | `app.helicon.desktop.test` | Artefato do workflow [Windows Teste](https://github.com/nattanfx/helicon/actions/workflows/test-windows.yml) |

Cada um tem pasta de instalação e dados próprios. A conta, a CLI e o histórico do Muse são compartilhados. Helicon Teste **não** substitui a pt4.

Não há calendário de atualizações. Uma próxima versão estável, se houver, será uma escolha posterior, não um compromisso deste texto.

## O que este cliente faz

O Helicon original envolve o Muse Code numa interface no estilo Codex/Claude. Neste fork a interface está em português, com ajustes próprios (identidade da versão, atualização manual, textos e correções usadas no dia a dia). Em linhas gerais:

- Projetos agrupados pela pasta em que o agente trabalhou
- Conversas com histórico, retomada e diffs
- Pedidos de aprovação visíveis (`onRequest` / `promptUnmatched` / `denyUnmatched`), sem contornar
- Visualizador de arquivos ao lado da conversa
- Medidor do plano conforme o Muse informa
- Metas, tarefas em segundo plano e esforço de raciocínio da sessão

Não há instalador Linux publicado por este fork, nem suporte a macOS. A release pt4 também anexa um DMG; isso **não** significa suporte. Não há atualizador assinado nem feed `latest.json`.

## Mudanças recentes no código de prod

Estado conferido em 22/09/2026 no commit `6306632`: [CI 94](https://github.com/nattanfx/helicon/actions/runs/35721942356) e [Windows Teste 9](https://github.com/nattanfx/helicon/actions/runs/35725840859) aprovados. Estes recursos estão no código e no build Teste desse commit; não fazem parte do instalador público pt4.

- **Estatísticas da sessão:** ative nas Configurações para ver turnos, etapas, velocidade, tokens e cache da conversa aberta. Desligadas por padrão; os indicadores usam dados já carregados e identificam cobertura parcial. Não representam cota ou cobrança oficial.
- **Novidades desta edição:** em Configurações → Ambiente → Ler, abre as notas incluídas no aplicativo, sem consulta à rede. Não abre automaticamente ao iniciar.
- **Uso do plano:** leituras idênticas deixam de emitir eventos duplicados; conteúdo diferente com o mesmo timestamp continua atualizando. Isso não reduz consultas nem consumo do Muse.
- **Títulos automáticos:** a instrução de geração pede português brasileiro, mantendo nomes próprios e termos técnicos e o limite de uma tentativa por conversa elegível.

## Origem e créditos

- **Original:** [HarjjotSinghh/helicon](https://github.com/HarjjotSinghh/helicon) — Helicon, de Harjot Singh Rana e contribuidores.
- **Este fork:** [nattanfx/helicon](https://github.com/nattanfx/helicon).
- **Licença:** [MIT](LICENSE) © 2026 Harjot Singh Rana and contributors.

Instruções, releases e o atualizador do original valem para o original. Aqui, use só os caminhos deste repositório.

## Arquitetura

```
packages/ui      interface React compartilhada (desktop e web)
packages/server  API HTTP, autenticação e eventos SSE
packages/daemon  serviço Node: inicia `muse serve` por pasta, fala MSP (JSON-RPC/stdio)
apps/desktop     casca Tauri 2
apps/web         a mesma interface contra um daemon
```

- Protocolo: **Muse Session Protocol (MSP)** via [`@muse-code/sdk`](https://github.com/meta-models/muse-code-sdk) (MIT). Sem raspar a TUI.
- Autenticação: `muse login` do próprio usuário (`~/.config/muse/auth.json`). O Helicon não guarda credenciais.
- Estado: SQLite local — `projects (cwd/worktree) → sessions → turns`.

## A partir do código

Pré-requisitos (só para compilação e o app web; o instalador desktop já traz Node.js): Node 22+, CLI `muse` com `muse login`, repositório clonado.

```bash
npm install
npm run build --workspace @helicon/daemon --workspace @helicon/ui --workspace @helicon/server
npm run build --workspace @helicon/web

# App web (interface compilada + API em :3127)
npm run serve --workspace @helicon/web
# abrir http://127.0.0.1:3127
```

Projetos, títulos e arquivo ficam em `~/.helicon/helicon.db` (passe `--data-dir` ao servidor, ou `:memory:` para uma execução descartável). Conversas iniciadas no terminal `muse` aparecem no projeto correspondente.

Desenvolvimento da interface com recarga:

```bash
# terminal 1: API contra o muse real
node packages/server/dist/src/cli.js --port 3127
# terminal 2: Vite a partir do código de packages/ui
npm run dev --workspace @helicon/web
# abrir http://127.0.0.1:5173
```

A interface está em `packages/ui` (modelo em `src/model`, componentes em `src/components`); o sistema visual está em [docs/DESIGN.md](docs/DESIGN.md).

```bash
# App desktop (casca de desenvolvimento; exige os pré-requisitos Tauri)
npm run dev --workspace helicon-desktop
```

Publicar um instalador novo é decisão posterior, com tag e release **deste** repositório. Este fork **não** configura o plug-in de atualização do Tauri (`createUpdaterArtifacts` desligado; sem `latest.json`). Abrir o aplicativo não consulta atualizador.

Daemon remoto, se precisar do modo web contra outra máquina: ver o README do Helicon original e os parâmetros `--host`, `--token`, `--allow-origin` e `--allow-host` do servidor. No desktop Windows deste fork a autenticação local é automática.

## Aviso

- Clientes-wrapper são o caminho previsto (a Meta publica um SDK MIT para clientes MSP). Este repositório parte disso e do cliente CLI de código aberto.
- **Nome:** `Helicon` foi escolhido no original para evitar a marca `Muse`. Não recolocar `Muse` no nome do binário, identificador, domínio ou título sem revisão de marca.
- **Nunca** se apresentar como oficial, empacotar credenciais ou contornar cobrança/aprovações.
- Aviso de Contribuidor: pedidos e respostas em modelos Contribuidor podem ser usados para melhorar produtos da Meta — a interface mostra isso antes de usar.
- Ver também: [recursos de marca da Meta](https://www.meta.com/brand/resources/meta/our-trademarks), [página do Muse Code](https://developer.meta.com/ai/products/muse-code), [documentação da API](https://dev.meta.ai/docs/coding-agents).

## Licença

[MIT](LICENSE) © 2026 Harjot Singh Rana and contributors.
