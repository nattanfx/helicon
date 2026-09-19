# Aviso após esgotar a recuperação automática

Etapa posterior à #41, baseada somente na parte de interface do commit upstream `ca8e6bf0c8ebbeecc5d268657a7aa070d98a950d`. Base local: `3dfd8a8`.

Após duas recargas automáticas sem resolver o turno e outro período de silêncio, a conversa exibe “Esta conversa está sem atualizações recentes”. O aviso não afirma que o Muse terminou ou travou. O botão “Recarregar histórico” lê novamente a conversa e renova o orçamento de até duas recargas automáticas. Essa consequência está explicada no texto. Uma recarga comum, por navegação ou reconexão, não renova o orçamento.

Adaptações além do upstream:

- Um novo evento do fluxo remove o aviso, sem renovar o limite do mesmo turno. Se o silêncio voltar, o aviso pode reaparecer sem novas recargas automáticas.
- Uma leitura que encontra outro turno ou o término remove o aviso. Eventos recebidos durante a leitura também o removem. Uma leitura sem mudança ou com erro preserva o estado do aviso.
- Pedidos de aprovação, perguntas pendentes e modo somente leitura têm prioridade visual: o aviso não é exibido junto deles. Isso não altera a execução ou as decisões de aprovação.
- O botão fica desabilitado enquanto o histórico carrega. Nenhum prompt é enviado por essa ação.

Não foram importados os contadores de diagnóstico nem as alterações de conexão do daemon/servidor presentes no mesmo commit upstream. Este ajuste melhora a informação exibida; não corrige sozinho a causa do silêncio no backend.

Validação local: UI **189/189**, web **8/8**, build web de produção aprovado e `git diff --check` sem erros. Quatro novos testes cobrem limite/renovação manual, retomada dos eventos, término/troca de turno e falha/eventos durante recarga. Testes simulados, sem chamada ao Muse. Validação visual e funcional no instalador Windows ainda pendente.

Próximos passos: commit/push pelo usuário, CI e novo Windows Teste antes de avaliar release estável. O Helicon Teste 3 instalado não contém este aviso.
