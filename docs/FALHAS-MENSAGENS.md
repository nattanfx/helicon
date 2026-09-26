# Quando uma mensagem falha

A caixinha vermelha "Esta mensagem falhou" aparece quando o programa entende que uma resposta não terminou. Nem toda caixinha é um problema de verdade — esta página explica como reagir a cada caso.

## Falha falsa após recarregar

Se você apertou F5 (ou a tela recarregou sozinha) no meio de uma resposta, a caixinha pode aparecer mesmo com a resposta completa na tela. É um retrato antigo: o programa já está corrigindo esses casos sozinho, e a caixinha some quando a conclusão chega. Se a resposta está completa, pode ignorar.

## Falha sem detalhe: verifique antes de agir

Quando a falha vem sem explicação ("O host não enviou detalhe"), a caixinha mostra só o botão **Verificar estado** — de propósito, sem "Tentar de novo" nem "Reiniciar o Muse". Clique nele: o programa pergunta ao servidor se o turno ainda está rodando.

- Se estiver rodando, a caixinha some com o aviso "Ainda está trabalhando" — não era falha.
- Se estiver parado mesmo, aí aparecem **Tentar de novo** e **Reiniciar o Muse**.

Enquanto o servidor vir o turno ativo, a caixinha nem chega a aparecer.

## "Tentar de novo" reenvia o pedido

O botão **Tentar de novo** manda seu pedido original mais uma vez, como uma mensagem nova. Use quando **nada** foi feito. Se o trabalho já aparece na tela (passos concluídos, texto parcial), prefira pedir no chat para continuar de onde parou — reenviar manda o agente refazer tudo.

## Quando várias mensagens falham em sequência

Se uma falha puxa a outra e a conversa parece não se recuperar:

1. Na caixinha, clique em **Reiniciar o Muse** e confirme. Isso reinicia os servidores internos sem fechar o aplicativo; turnos em andamento são interrompidos.
2. Aguarde o aviso "Servidores Muse reiniciados" e mande sua mensagem de novo.
3. Se nem assim voltar ao normal, anote o que está em **Configurações → Sobre → Falhas do servidor** (horário e códigos) e passe ao agente — é o registro automático que permite investigar.

Não é preciso fechar o aplicativo nem abandonar a conversa antes de tentar o passo 1.
