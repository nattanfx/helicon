# Correção #41 — recuperação limitada e renderização

Backport seletivo de `3fdbba0a65eee1e69f10e4de149c135e1a5a4a6f` e `e3f9e5da3fad274830ea57355bff5eac234a38bd`, revisado em 19/09/2026 sobre `0a0c7a6`.

Carregamentos simultâneos da mesma conversa compartilham a leitura e o buffer de eventos. Uma conversa sem eventos pode recuperar a visualização pelo histórico, com no máximo **duas recargas automáticas por turno**, por instância do controlador. Outro turno recebe orçamento próprio. O limite não é persistente após fechar o aplicativo; recargas manuais e reconexões não são bloqueadas por ele.

A verificação acontece a cada 30 segundos. A recuperação exige mais de 30 segundos sem eventos quando a visualização ainda mostra um turno e o estado da sessão não informa um turno ativo; exige mais de 90 segundos quando ambos indicam atividade. Esses sinais são uma heurística de silêncio, não prova de que o backend terminou. Conversas ociosas, com erro ou já carregando são ignoradas. O mecanismo não garante recuperar um término ausente do próprio histórico.

Textos em streaming deixam de animar palavra por palavra acima de 10 mil caracteres; acima de 30 mil, passam a snapshots de 500 ms. O texto final aparece integralmente ao encerrar. O preview de logs busca a última linha a partir do fim. Diffs acima de 250 mil pares de linhas mostram blocos removido/adicionado, preservando o conteúdo e evitando a tabela quadrática de alinhamento.

## Ajustes encontrados na revisão

- O upstream deixava `disposed` ligado após `start → dispose → start`, desativando a recuperação na remontagem. O fork reativa o controlador em `start` e impede verificações após o encerramento. Teste adicional reproduziu a falha antes da correção.
- Amostrar apenas a string não impedia `ReactMarkdown` de refazer o parse quando as props externas mudavam. O elemento renderizado agora é memorizado pelo snapshot e pelo modo de animação. Teste isolado no navegador confirmou 20 atualizações sem novo parse entre snapshots.
- O relógio simulado dos testes consome cada callback uma única vez, como o agendador real.

## Validação

- `npm test --workspace=@helicon/ui`: **185/185**.
- `npm test --workspace=@helicon/web`: **8/8**.
- `npm run build --workspace=@helicon/web`: aprovado; esbuild precisou rodar fora da restrição de pastas do ambiente.
- `git diff --check`: aprovado.
- Casos adicionais: orçamento novo por turno, orçamento preservado em recarga comum, encerramento durante carga concorrente de histórico parcial, liberação de carga falha para nova tentativa e parar/reiniciar o controlador.
- Navegador, fixture isolada com React de produção: **105.600 caracteres**, 20 mudanças sem parse adicional, um parse no snapshot seguinte, término imediato e ausência de novas renderizações pelo timer após terminar. Três parses ao todo. Instrumentação envolve somente o componente de Markdown; não acessa o Muse.

Não foram reproduzidos os benchmarks do autor nem o congelamento com uma sessão real. Testes Rust/instalador Windows ficam para o CI e o Windows Teste. Nenhuma chamada real ao modelo foi feita. Autenticação, política de títulos, português e navegação anterior permanecem fora das substituições deste backport; os testes existentes da interface e cliente web continuam aprovados.

## Ajuste posterior identificado

O upstream avançou para `03760d8` (v0.14.3). O commit `ca8e6bf` acrescenta diagnóstico do fluxo e aviso quando o orçamento termina, com recarga manual. Foi inspecionado e **não incorporado nesta etapa**; inclui alterações no daemon/servidor e merece revisão própria. Nesta versão do fork, esgotar as duas recargas ainda pode deixar a indicação de atividade visível se nenhum término chegar.

## Próximo passo

Fazer commit/push pelo GitHub Desktop, aguardar o CI e disparar **Windows Teste → Run workflow → prod**. Validar no Helicon Teste antes de qualquer release estável. Não gerar tags, publicar release ou atualizar a instalação normal por inferência.

Fontes: [PR #41](https://github.com/HarjjotSinghh/helicon/pull/41), [limite de recargas](https://github.com/HarjjotSinghh/helicon/commit/e3f9e5da3fad274830ea57355bff5eac234a38bd), [ajuste posterior](https://github.com/HarjjotSinghh/helicon/commit/ca8e6bf0c8ebbeecc5d268657a7aa070d98a950d).
