# Rascunhos do editor de arquivos

Diagnóstico C3 sobre `5df2bd7`. O rascunho da caixa de mensagem já sobrevive a troca de conversa e recarregamento (`helicon.draft.` no `localStorage`). Isto trata só de **edição não salva de Markdown** no visualizador.

## Onde o rascunho vive hoje

| Dado | Onde | Sobrevive a reinício? |
| --- | --- | --- |
| Edição não salva | `AppState.fileDrafts`, chave `fileKey(cwd, path)` = `cwd + "\n" + path` | Não |
| Abas abertas | `AppState.filePanels` por `sessionId` | Não |
| Preferência de painel aberto | `prefs.filesOpen` → `helicon.prefs.v1` | Sim |
| Rascunho da mensagem | `localStorage` `helicon.draft.<sessionId ou new:cwd>` | Sim |

`setFileDraft` só altera o store em memória. `dispose` e o debounce de prefs gravam apenas `Prefs`. O fechamento da janela Tauri (`Destroyed`) mata o servidor e não pergunta por edições.

## O que já funciona (preservar)

- Trocar de aba, conversa ou esconder o painel: o rascunho permanece na memória.
- Fechar a aba: `window.confirm` e, se confirmado, `closeFile` descarta o rascunho.
- Salvar: envia o conteúdo com o `mtime` da abertura; se o disco mudou, `fileChanged` (409) e toast com Sobrescrever. O arquivo original não é gravado nessa recusa.
- Só Markdown editável e não truncado entra no editor.

## Lacuna para C4

Reiniciar ou fechar o aplicativo perde a edição. Não há aviso no fechamento da janela. Não misturar isso com o rascunho da mensagem.

## Proposta mínima para C4

1. Guardar `fileDrafts` num armazenamento local separado (`helicon.fileDrafts.v1`), chave por projeto/caminho, com `content` e `baseMtimeMs`.
2. Restaurar ao abrir o arquivo; se o `mtime` do disco diferir, conflito visível — nunca gravar o original sozinho.
3. Apagar a cópia ao salvar ou descartar (fechar a aba com confirmação já existente).
4. Se houver rascunho ao fechar a janela, perguntar (desktop `onCloseRequested`; no navegador, `beforeunload`).
5. Limitar tamanho; falha de armazenamento não derruba o app. Sem migração de banco e sem tocar em dados reais na implantação.
