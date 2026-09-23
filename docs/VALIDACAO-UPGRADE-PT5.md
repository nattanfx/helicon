# Validação da atualização pt4 → pt5

Preparação em 22/09/2026. O objetivo é verificar a atualização da instalação normal preservando os dados, antes de usá-la no perfil principal. O Windows Teste tem outro identificador e não comprova esse caminho.

## Estado da preparação

- Código analisado: `6306632`, com I1/I2/I4. CI 94 e Windows Teste 9 aprovados nesse commit.
- Revisão documental commitada em `757317c`, com tag `v0.12.5-pt5` criada e enviada em 22/09/2026. [CI 95](https://github.com/nattanfx/helicon/actions/runs/35730111032) e workflow [Release](https://github.com/nattanfx/helicon/actions/runs/35737639479) aprovados. Não usar `14cb64f`: ele não contém as melhorias posteriores. Não confundir com o HEAD posterior (`bf72a7a`).
- Instalador normal pt5 candidato obtido: `Helicon_0.12.5-pt5_x64-setup.exe`, 26287332 bytes, SHA-256 `4cd8495c31c4059662b4f0b47faa05dac9c44de026defae299a285971954bdb4`, conferido com o asset do GitHub. Release em rascunho, não publicada.
- Ensaio local de cópia/restauração aprovado com arquivos fictícios: hash, arquivo aninhado, rascunho vazio, recusa de destino existente e preservação da pasta anterior. Esse ensaio não testa SQLite, WebView ou o instalador NSIS.
- Upgrade do canal normal: **não executado**. O ensaio abaixo continua pendente.

## Preparar o candidato

Passos 1–3 concluídos em 22/09/2026, por decisão explícita do usuário; preservados aqui como registro do que foi feito.

1. ~~Revisar e commitar a documentação~~ — feito no commit `757317c`, incluindo a cópia das notas em `packages/ui/src/model/notas.ts`.
2. ~~Registrar o SHA e aguardar o CI~~ — SHA `757317cd37f09a93ef4f58b8974c69714579afd4`; CI 95 aprovado nesse commit.
3. ~~Gerar o instalador **Helicon**~~ — gerado pelo workflow Release para esse SHA (tag `v0.12.5-pt5`, já existente; não mover). Identificador `app.helicon.desktop`.
4. Manter a release em rascunho durante o ensaio. Conferir **Compilação** após instalar. Não usar o instalador **Helicon Teste** como substituto.

## Ensaio em ambiente separado

Usar uma VM Windows ou conta Windows separada, com perfil próprio, sem a sessão Muse principal. Uma segunda pasta do executável no mesmo perfil não isola `%APPDATA%` e `%LOCALAPPDATA%`.

1. Instalar a pt4 nesse ambiente e registrar versão `0.12.4`, canal normal e diretório do programa.
2. Preparar dados descartáveis na pt4 e registrar o que foi possível criar sem chamadas ao modelo. Para validar uma cópia dos dados existentes, fechar os aplicativos e copiar **as duas pastas** descritas em [BACKUP.md](BACKUP.md); manter a cópia original intacta e trabalhar com uma duplicata no ambiente separado. Não copiar o login/credenciais do Muse.
3. Registrar preferências, projetos e dados visíveis antes do upgrade. Não incluir conteúdo privado nas evidências. Se o histórico não carregar sem login, marcar o cenário como não verificado; não inferir perda de dados.
4. Fechar a pt4. Executar o instalador normal pt5 no ambiente separado. Registrar se reconheceu a instalação anterior e tratou a operação como atualização; não marcar exclusão de dados.
5. Executar a matriz abaixo. Não enviar mensagens, gerar títulos ou aprovar ações reais para completar o ensaio.
6. Fechar a pt5 e ensaiar a restauração das duas pastas a partir da cópia anterior. Para testar retorno à pt4, usar também o instalador pt4; restaurar dados não reverte o programa. Registrar resultado, sem presumir compatibilidade de um banco já aberto pela pt5 com a pt4.

## Matriz de aceite

| Cenário | Evidência necessária | Estado |
| --- | --- | --- |
| Upgrade NSIS | Reconhece a pt4; conclui sem exclusão de dados | Pendente |
| Identidade | Versão `0.12.5-pt5`, canal normal, SHA candidato, servidor correspondente | Pendente |
| Persistência | Preferências/projetos e demais dados preparados continuam presentes | Pendente |
| Reabertura | Fecha e reabre sem erro; dados permanecem | Pendente |
| Edição de arquivo | Arquivo descartável, rascunho normal e vazio recuperáveis; original intacto até salvar | Pendente |
| Recursos recentes | Estatísticas e notas disponíveis; SHA corresponde ao candidato | Pendente |
| Restauração | Duas pastas restauradas; pt4 abre os dados anteriores; estado pós-upgrade preservado à parte | Pendente |

## Passagem para uso normal

Somente após o resultado do ensaio, decidir pela atualização no perfil principal. Fechar Helicon e Helicon Teste, fazer backup novo das duas pastas com destinos novos e confirmar que as duas cópias terminaram sem erro. Preservar o instalador pt4 para recuperação. Seguir [BACKUP.md](BACKUP.md) e repetir a conferência de identidade/reabertura depois da instalação.

Publicar o rascunho e instalar no perfil principal são decisões separadas. Este roteiro não registra nenhuma delas como executada. Testes que dependam do Muse real devem ter escopo próprio; a matriz não os declara aprovados por CI.
