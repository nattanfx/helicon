# Instalar e atualizar este fork

Este é um fork pessoal do Helicon, em português. Não há suporte a terceiros nem calendário de versões. Distinga sempre as instruções **deste** repositório das do [Helicon original](https://github.com/HarjjotSinghh/helicon).

A identidade que a interface mostra (versão, canal, compilação) está em [VERSAO-PT-BR.md](VERSAO-PT-BR.md).

## Release pública versus código atual

| Estado | O que é | O que não é |
| --- | --- | --- |
| **[v0.12.4-pt4](https://github.com/nattanfx/helicon/releases/tag/v0.12.4-pt4)** | Última release **pública** deste fork (18/09/2026). Commit `3709b6f`. Instalador Windows: `Helicon_0.12.4_x64-setup.exe`. A interface dessa instalação mostra `0.12.4`. | Não contém o código posterior em `prod`. |
| Branch `prod` | Código mais recente do clone. O pacote declara `0.12.5-pt5` em `tauri.conf.json`. Notas em [NOTAS-0.12.5-pt5.md](NOTAS-0.12.5-pt5.md). | **Não** é a release pública. A tag `v0.12.5-pt5` existe no commit `757317c`, com instalador em rascunho de release não publicado; o HEAD (`bf72a7a`) já está além da tag. |

A pt4 instalada e um build deste código não mostram o mesmo número. A edição pública continua a pt4 até o rascunho pt5 ser publicado. Backup antes de atualizar a instalação normal: [BACKUP.md](BACKUP.md).

Confira a [página de releases](https://github.com/nattanfx/helicon/releases) antes de baixar. Existir a tag `v0.12.5-pt5` não a torna pública: enquanto a release for rascunho, documente e use a pt4.

## Instalação normal no Windows

1. Instale o Muse CLI e faça `muse login` uma vez. No PowerShell: `irm https://dev.meta.ai/install.ps1 | iex`. Se o Muse já rodar só no WSL2, o Helicon pode usá-lo; `HELICON_MUSE_RUNTIME=wsl` mantém o WSL quando os dois existem.
2. Abra [v0.12.4-pt4](https://github.com/nattanfx/helicon/releases/tag/v0.12.4-pt4) neste repositório (`nattanfx/helicon`).
3. Baixe `Helicon_0.12.4_x64-setup.exe`. **Não** baixe o instalador em [HarjjotSinghh/helicon/releases/latest](https://github.com/HarjjotSinghh/helicon/releases/latest) para este fork.
4. Feche o Helicon, se estiver aberto, e execute o instalador.
5. O atalho **Helicon** é a instalação normal (`app.helicon.desktop`).

O instalador já inclui Node.js. Não há atualização automática depois da instalação.

A mesma release no GitHub também lista um DMG e um `.app.tar.gz`. Este fork **não** oferece suporte a macOS nem a Linux; não use esses anexos como caminho suportado.

Para a edição pt5, use o [roteiro de validação do upgrade](VALIDACAO-UPGRADE-PT5.md) antes de atualizar o perfil principal. O instalador Teste não valida a atualização da instalação normal.

## Como atualizar (manual)

O aplicativo **não** verifica, baixa nem instala versões sozinho. Não há `latest.json` nem artefatos do plug-in Tauri. Abrir ou reabrir o Helicon não consulta atualizador.

- **Instalação normal:** quando houver uma release **nova deste fork**, baixe o instalador em [nattanfx/helicon/releases](https://github.com/nattanfx/helicon/releases), feche o aplicativo e execute o instalador. Hoje a release pública continua sendo a pt4. A edição `0.12.5-pt5` tem tag (`v0.12.5-pt5` em `757317c`) e instalador em rascunho de release, ainda não publicado. Antes de instalar essa edição sobre a pt4, copie as pastas de dados como em [BACKUP.md](BACKUP.md). Em Configurações, **Abrir página de atualização** aponta para essa lista de releases.
- **Helicon Teste:** baixe o artefato do workflow [Windows Teste](https://github.com/nattanfx/helicon/actions/workflows/test-windows.yml) (Actions → Windows Teste). Não use as releases estáveis para atualizar o Teste, nem o Teste para substituir a pt4.
- **Não** use o atualizador, as notas nem o `latest` do repositório original.

Não há data prometida para a próxima versão. Empacotar o código atual é um passo posterior, não um anúncio.

## Helicon Teste

**Helicon Teste** é outro aplicativo: identificador `app.helicon.desktop.test`, pasta e dados próprios. Não é uma atualização da instalação normal. A conta do Muse é a mesma.

O instalador de teste **não** é uma GitHub Release; fica no artefato da Action e expira. Instruções de obtenção e conferência: [TESTE-WINDOWS.md](TESTE-WINDOWS.md).

## O que este texto não promete

- Atualização automática, instalador assinado com chave de atualizador, ou feed `latest.json`
- Suporte a macOS, Linux, winget ou site de download próprio
- Que o HEAD de `prod` já esteja no instalador da pt4
- Suporte a quem baixar o fork por conta própria
- Calendário de releases, migração para um app oficial, ou paridade com o Helicon original

## Original

O Helicon original, com as próprias releases e o atualizador dele, está em [github.com/HarjjotSinghh/helicon](https://github.com/HarjjotSinghh/helicon). Use-o se quiser o projeto upstream. Este fork não o substitui.
