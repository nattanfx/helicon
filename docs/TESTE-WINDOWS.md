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
3. Abra Configurações, clique em Voltar e abra Uso. Confirme que a navegação funciona. Em Configurações, a seção Versão deve mostrar **Helicon Teste**, o identificador `app.helicon.desktop.test` e um link de atualização manual para o workflow Windows Teste — sem botões de verificar/baixar automaticamente.
4. Crie uma pasta descartável, por exemplo `Documentos/Helicon-Teste`, com um arquivo `exemplo.txt`. Adicione essa pasta como projeto no aplicativo. Se a interface disponibilizar o explorador de arquivos sem conversa, abra o arquivo e confira o conteúdo; caso contrário, registre este item como pendente.
5. Feche o aplicativo completamente e abra **Helicon Teste** outra vez. Confira que abre normalmente e mantém seu projeto de teste.

Não é preciso enviar mensagem para esta primeira conferência. Conversas anteriores encontradas recebem no máximo um título local do primeiro pedido, sem chamada ao modelo; só conversas novas criadas com **Gerar títulos** ligado usam uma tentativa automática (ver [TITULOS-AUTOMATICOS.md](TITULOS-AUTOMATICOS.md)). Para uma conferência sem consumo, mantenha a opção desligada. Não há isolamento da conta do Muse.

## Conferência final com o Muse

Após os passos anteriores, uma conversa nova no projeto descartável permite confirmar resposta, eventos ao vivo e arquivos na interface. Esse passo pode consumir o plano e exige cota disponível. Use uma mensagem como: **Responda apenas “teste concluído”, sem executar comandos nem alterar arquivos.**

Registre abertura, reabertura, navegação, arquivo e resposta separadamente. Se a cota estiver esgotada, não classifique resposta/eventos como aprovados. Não apague nem modifique sessões antigas para tentar resolver erros.

Se surgir erro, registre a mensagem e o `BUILD.txt`. A pt4 continua disponível pelo atalho original **Helicon**. Não desinstale nem remova os dados da pt4.

## Conferência da página Uso

1. Abra **Uso**. Chamadas com data conhecida entram no período escolhido. Quando o Muse não informa a data, o consumo aparece em **Consumo sem data conhecida**, fora do gráfico diário. Registros de versões anteriores também ficam nessa seção: a data antiga era a da leitura, e os valores permanecem guardados.
2. Em **Configurações → Conversas**, clique em **Recuperar uso** e aguarde. A tela informa chamadas **novas** recuperadas, leituras incompletas e falhas. A recuperação consulta o histórico sem reabrir as conversas.
3. Abra Uso, anote os totais e execute a recuperação outra vez. Sem novas chamadas ao modelo, os números das chamadas já identificadas devem permanecer iguais. Reabrir a conversa também não deve aumentá-los.
4. Se aparecer **Consumo com detalhamento incompleto**, confira a mensagem. O acumulado disponível fica separado das chamadas: não se inventam datas, modelos, quantidade de chamadas ou preço para a parte sem detalhamento. Pode haver histórico compacto, sessão usada por outro host, repetição de páginas ou limite de leitura.
5. Para conferir a exclusão, use apenas uma conversa de teste descartável com consumo já conhecido. Apagar deve preservar o consumo; a linha passa a **Conversa excluída**, sem botão para reabrir.

A recuperação percorre até 100 páginas da lista de conversas e 100 páginas por histórico, no host padrão do perfil atual. Dados de outro perfil ou runtime podem ficar fora da consulta. Registros antigos sem identidade durável não são apagados por semelhança de valores; duplicação antiga exige investigação própria.
