# Backup e restauração dos dados

Para validar a passagem da pt4 para a pt5 em ambiente separado, siga [VALIDACAO-UPGRADE-PT5.md](VALIDACAO-UPGRADE-PT5.md). O ensaio de cópia/restauração não substitui o teste do instalador.

As conversas, projetos e preferências não ficam na pasta do programa. Feche o Helicon antes de copiar ou restaurar. O script não escolhe essas pastas sozinho e não lê o conteúdo do banco.

Há duas pastas por instalação. As duas entram no backup.

| Instalação | Banco, porta e cópia de edição | Perfil da janela (preferências e rascunho da mensagem) |
| --- | --- | --- |
| Normal | `%APPDATA%\app.helicon.desktop` | `%LOCALAPPDATA%\app.helicon.desktop` |
| Helicon Teste | `%APPDATA%\app.helicon.desktop.test` | `%LOCALAPPDATA%\app.helicon.desktop.test` |

Na instalação normal conferida nesta preparação, a pasta de dados tinha `helicon.db` e `server-port`. A pasta local tinha `EBWebView` e `logs`. `file-drafts.json` aparece quando há edição de arquivo por guardar; a pt4 ainda não grava esse arquivo. O Helicon Teste usa as pastas `.test` e não compartilha esses dados.

O script está em `scripts/backup-dados.ps1`. Troque os caminhos de exemplo pelos seus e use uma pasta de destino que ainda não exista.

```powershell
.\scripts\backup-dados.ps1 -Source "$env:APPDATA\app.helicon.desktop" -Destination "D:\backup-helicon\roaming"
.\scripts\backup-dados.ps1 -Source "$env:LOCALAPPDATA\app.helicon.desktop" -Destination "D:\backup-helicon\local"
```

Cada backup ganha um `MANIFESTO.txt` com a quantidade de arquivos e o SHA-256 de `helicon.db` e de `file-drafts.json`, quando existem. O manifesto não contém o texto das conversas.

Para voltar ao backup, feche o aplicativo de novo. `-Force` renomeia a pasta atual para `nome.antes-AAAAMMDD-HHMMSS` e só então copia o backup para o lugar original.

```powershell
.\scripts\backup-dados.ps1 -Restore -Force -Source "D:\backup-helicon\roaming" -Destination "$env:APPDATA\app.helicon.desktop"
.\scripts\backup-dados.ps1 -Restore -Force -Source "D:\backup-helicon\local" -Destination "$env:LOCALAPPDATA\app.helicon.desktop"
```

Se o Helicon ou o Helicon Teste estiver aberto, o script recusa caminho dentro dessas quatro pastas. Restaurar devolve os dados ao momento do backup, inclusive conversas feitas depois. Não há cópia automática na instalação.

`scripts/backup-dados.test.ps1` repete cópia, recusa de destino existente e restauração com conferência do hash, só em pasta temporária.
