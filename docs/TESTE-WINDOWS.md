# Testar a proteção no Windows

Esta compilação aparece como **Helicon Teste** no menu Iniciar e usa pasta de instalação, identificador e dados próprios. Não é uma atualização da pt4. O conteúdo visual ainda pode mostrar apenas Helicon. A conta, a CLI e o histórico do Muse continuam compartilhados; não altere conversas antigas neste teste.

## Obter o instalador

1. No GitHub, abra **Actions → Windows Teste** e a execução concluída em verde.
2. Em **Artifacts**, baixe **Helicon-Teste-Windows-…** (é necessário estar conectado ao GitHub).
3. Extraia o ZIP. `BUILD.txt` identifica o commit e o SHA256 do instalador.
4. Execute o instalador contido no ZIP. Mantenha a pasta sugerida para **Helicon Teste**; não escolha a pasta da pt4.

O fluxo gera um arquivo de teste retido por 14 dias. Não cria tag, release nem atualização automática. Para compilar outro commit futuramente, use **Run workflow** na branch `prod`. O primeiro push destes arquivos dispara a compilação automaticamente.

## Conferência sem enviar mensagens ao modelo

1. Feche a pt4 e abra **Helicon Teste** pelo menu Iniciar.
2. Confirme que a página inicial aparece sem pedir senha e sem erro de credencial.
3. Abra Configurações, clique em Voltar e abra Uso. Confirme que a navegação funciona.
4. Crie uma pasta descartável, por exemplo `Documentos/Helicon-Teste`, com um arquivo `exemplo.txt`. Adicione essa pasta como projeto no aplicativo. Se a interface disponibilizar o explorador de arquivos sem conversa, abra o arquivo e confira o conteúdo; caso contrário, registre este item como pendente.
5. Feche o aplicativo completamente e abra **Helicon Teste** outra vez. Confira que abre normalmente e mantém seu projeto de teste.

Não é preciso enviar mensagem para esta primeira conferência. A opção de títulos automáticos pode realizar chamadas ao encontrar conversas anteriores; desative **Gerar títulos** antes de adicionar projetos reais ou iniciar conversas. Não há isolamento da conta do Muse.

## Conferência final com o Muse

Após os passos anteriores, uma conversa nova no projeto descartável permite confirmar resposta, eventos ao vivo e arquivos na interface. Esse passo pode consumir o plano e exige cota disponível. Use uma mensagem como: **Responda apenas “teste concluído”, sem executar comandos nem alterar arquivos.**

Registre abertura, reabertura, navegação, arquivo e resposta separadamente. Se a cota estiver esgotada, não classifique resposta/eventos como aprovados. Não apague nem modifique sessões antigas para tentar resolver erros.

Se surgir erro, registre a mensagem e o `BUILD.txt`. A pt4 continua disponível pelo atalho original **Helicon**. Não desinstale nem remova os dados da pt4.
