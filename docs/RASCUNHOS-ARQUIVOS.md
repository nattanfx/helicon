# Rascunhos do editor de arquivos

C4 sobre `cad7a8c`. O rascunho da caixa de mensagem já sobrevive em `helicon.draft.`. A **edição não salva de Markdown** agora tem cópia recuperável em `helicon.fileDrafts.v1`, fora das prefs. Nada é gravado no arquivo original até o usuário salvar.

## Onde o rascunho vive

| Dado | Onde | Sobrevive a reinício? |
| --- | --- | --- |
| Edição não salva | `AppState.fileDrafts` e `localStorage` `helicon.fileDrafts.v1`, chave `cwd + "\n" + path` | Sim, se couber no limite |
| Abas abertas | `AppState.filePanels` por `sessionId` | Não |
| Preferência de painel aberto | `prefs.filesOpen` → `helicon.prefs.v1` | Sim |
| Rascunho da mensagem | `localStorage` `helicon.draft.<sessionId ou new:cwd>` | Sim |

## O que já funciona (preservar)

- Trocar de aba, conversa ou esconder o painel: o rascunho permanece na memória.
- Fechar a aba: `window.confirm` e, se confirmado, `closeFile` descarta o rascunho.
- Salvar: envia o conteúdo com o `mtime` da abertura; se o disco mudou, `fileChanged` (409) e toast com Sobrescrever. O arquivo original não é gravado nessa recusa.
- Só Markdown editável e não truncado entra no editor.

## C4 feito

1. `helicon.fileDrafts.v1` separado das prefs; restaurado no arranque.
2. Se o `mtime` do disco diferir da base, faixa de conflito; Recarregar descarta a cópia. Salvar continua recusando 409 sem gravar por cima.
3. Salvar ou fechar a aba (com confirmação) remove a cópia.
4. Fechar a janela com rascunho: desktop pergunta; navegador usa o aviso genérico de saída. Fechar não escreve o arquivo original.
5. Acima de 1 milhão de caracteres a cópia não entra no armazenamento; falha de quota não derruba o app. Sem migração de banco.
