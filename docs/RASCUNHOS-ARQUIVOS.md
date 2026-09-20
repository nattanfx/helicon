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

## REV5 — cópia fora da origem web no desktop

O `localStorage` é por origem (esquema, host e porta). Quando a porta anterior está ocupada, o
servidor sobe noutra e a origem nova não enxerga a cópia da antiga — ela continua guardada no
perfil da origem velha, inacessível ao fluxo normal. A troca de porta continua existindo (não foi
removida); só o cofre da cópia mudou de lugar no desktop.

| Dado | Onde no desktop | Onde no navegador |
| --- | --- | --- |
| Edição não salva | `file-drafts.json` na pasta de dados da instalação (+ `localStorage` da origem atual como passagem) | `localStorage` `helicon.fileDrafts.v1` (origem estável) |
| Backup | `file-drafts.json.bak` (versão anterior a cada escrita) | — |

- Normal e Teste não compartilham: a pasta de dados é por identificador (`app.helicon.desktop` e `app.helicon.desktop.test`).
- Migração única: cofre vazio + origem atual com rascunhos copia para o cofre, sem apagar o local.
- Vazio válido, limite de 1 milhão, conflito, descarte e falha de escrita continuam como antes; só o transporte mudou. Falha do cofre não derruba o app (vai ao console); a cópia local da sessão segue valendo.
- Fechar o desktop descarrega a fila de escrita antes de liberar a janela.
- Restauração manual: com o app fechado, renomeie `file-drafts.json.bak` para `file-drafts.json` (ou apague o `.json` para voltar ao `localStorage` da origem). Nunca edite com o app aberto. Não aplicar a dados reais sem cópia de segurança.
