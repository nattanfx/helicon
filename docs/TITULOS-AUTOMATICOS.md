# Controle de consumo dos títulos

## Idioma

A instrução do gerador do Helicon pede títulos em **português brasileiro (pt-BR)**, inclusive para pedidos em inglês ou com idiomas misturados. Nomes próprios, produtos e identificadores de código podem ser mantidos no idioma original. A resposta continua limitada a um título curto, sem explicações.

Essa orientação vale para novas tentativas do gerador; não traduz títulos existentes nem cria outra chamada para corrigir o idioma. Títulos recebidos do próprio Muse ou de outro cliente continuam sendo sincronizados, e o texto usado como fallback sem modelo mantém o idioma da mensagem original. O idioma da resposta do modelo não é garantido por uma validação automática.

## Tentativas e consumo

Cada conversa criada no Helicon com **Gerar títulos** ligado recebe no máximo uma tentativa automática. A tentativa fica registrada antes da chamada ao Muse. Falhas, cota esgotada, resposta inválida, título igual ao primeiro pedido e interrupção do aplicativo não autorizam outra tentativa. O usuário pode continuar renomeando a conversa manualmente.

Conversas antigas ou descobertas na CLI não recebem chamadas automáticas para renomeação. Seus títulos existentes e nomes manuais são preservados; uma conversa sem título ainda pode receber o texto do primeiro pedido, sem chamada ao modelo. Reativar a opção ou mudar o modelo não inicia um lote antigo. Nesta alteração não há botão para geração em lote.

Desligar a opção cancela tentativas pendentes e impede a aplicação do resultado de uma chamada em andamento. Uma chamada já enviada pode consumir cota. A escolha do modelo e o estado ligado/desligado existentes são preservados.

## Persistência e retorno à versão anterior

A atualização acrescenta apenas a tabela `title_attempts` ao banco do Helicon, sem reescrever conversas ou preferências. Conversas antigas não recebem registros nessa tabela. Uma atualização condicional no SQLite reserva a tentativa, inclusive quando duas conexões usam o mesmo banco. O estado `attempted` deixado por uma interrupção não é retomado automaticamente: prioriza evitar cobrança duplicada, mesmo que isso deixe um título sem gerar.

Antes de instalar esta alteração sobre a versão de uso diário, feche completamente o aplicativo e faça uma cópia da pasta de dados do Helicon, incluindo `helicon.db` e eventuais arquivos auxiliares do SQLite. Primeiro valide no **Helicon Teste**, que usa dados separados. Nenhum banco real foi modificado durante o desenvolvimento.

A versão anterior ignora a tabela adicional, mas volta à política antiga de chamadas. Para restaurar um backup, feche todos os processos do Helicon, preserve a pasta atual com outro nome e restaure a cópia completa. Isso retorna os dados ao momento do backup; não deve ser feito automaticamente sobre atividade posterior.

Os testes usam banco temporário e executor simulado. Cobrem migração preservando dados, concorrência de conexões, reinício, falhas e resultados sem mudança, histórico antigo, desativação durante a chamada e prioridade dos nomes manuais. Nenhuma chamada real ao Muse é necessária para esses testes.
