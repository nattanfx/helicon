/** Uma edição do fork e as notas escritas para ela, da mais nova para a mais antiga. */
export interface NotaDaEdicao {
  version: string;
  /** O markdown da nota, exatamente como está no arquivo em docs/. */
  body: string;
}

/**
 * As notas embutidas no aplicativo, para ler sem rede e com o mesmo texto online e offline.
 * O corpo repete docs/NOTAS-0.12.5-pt5.md; um teste quebra se os dois saírem de sincronia, para
 * uma edição dos docs lembrar de atualizar aqui junto.
 */
export const NOTAS: readonly NotaDaEdicao[] = [
  {
    version: "0.12.5-pt5",
    body: `# Helicon PT-BR 0.12.5-pt5

Pacote pessoal deste fork, para o Windows. Não é o Helicon original, não oferece suporte a terceiros e não se atualiza sozinho.

A tag é \`v0.12.5-pt5\`, criada no commit \`757317c\`. A release segue como rascunho, não publicado. A última release pública continua sendo [v0.12.4-pt4](https://github.com/nattanfx/helicon/releases/tag/v0.12.4-pt4). Instalar a pt4 não instala esta edição.

O número \`0.12.5-pt5\` é o que a interface passa a mostrar em **Versão**. Ele é maior que \`0.12.4\` na comparação do instalador, então a atualização da pt4 é tratada como upgrade. Não usar a tag \`v0.12.5\`: ela pertence a uma release do original e não a este fork.

## O que muda em relação à pt4

- O servidor local do aplicativo exige credencial. Abrir o servidor para a rede pede token, e a origem da página é conferida.
- Títulos automáticos: no máximo uma tentativa por conversa criada com **Gerar títulos** ligado. Falha ou reinício não repetem a chamada. Conversas antigas não são renomeadas. Desligar a opção cancela o que ainda não foi aplicado.
- Navegação: o primeiro clique em projeto e os atalhos de voltar deixam de trocar a conversa por engano. O texto “agora” deixa de aparecer como “há agora”.
- Conversas que congelavam passam a recarregar no máximo duas vezes por mensagem. Se as atualizações param, a interface avisa e permite recarregar o histórico.
- Rótulos conhecidos de aprovação ficam em português. O identificador, a decisão e o comando enviados não mudam.
- Arquivo inexistente, cota esgotada, limite temporário, recusa de acesso e sessão desalinhada ganham explicação em português. Um limite temporário não é apresentado como cota esgotada e não é reenviado sozinho.
- Edição de Markdown não salva volta depois de fechar o aplicativo, inclusive quando o arquivo fica vazio. O arquivo original só muda ao salvar. Se a cópia não couber ou o armazenamento falhar, a interface avisa.
- No desktop, essa cópia fica em \`file-drafts.json\` na pasta da instalação e continua disponível se a porta local mudar.

## Acrescentado ao código após a preparação inicial

Estas mudanças estão no commit \`6306632\`, aprovado no CI 94 e no Windows Teste 9 em consulta de 22/09/2026. A versão continua \`0.12.5-pt5\`; confira também o campo **Compilação** para distinguir builds da mesma edição. O build Teste já gerado não contém revisões documentais posteriores a esse commit.

- **Estatísticas da sessão**, nas Configurações, mostram mensagens, etapas, velocidade, tokens e cache da conversa. Ficam desligadas por padrão e não calculam esses indicadores enquanto desativadas. Usam o histórico carregado, sinalizam dados parciais e não equivalem à cota ou cobrança oficial.
- **Novidades desta edição**, na seção Ambiente das Configurações, abre estas notas pelo botão **Ler**, sem consultar a rede. Não há abertura automática por mudança de versão.
- Leituras idênticas de uso do plano não repetem o evento para a interface. Leituras alteradas com o mesmo timestamp continuam sendo entregues; não há redução das consultas ou do consumo do Muse.
- A instrução dos títulos automáticos pede português brasileiro e preservação de nomes próprios e termos técnicos. O limite de uma tentativa e a proteção dos títulos antigos permanecem.

## Segurança de execução por projeto

Conferido no Helicon Teste entre 04 e 06/10/2026 (builds 43 a 47).

- **Modo YOLO** e **Desativar a sandbox** existem e valem só para um projeto por vez. As Configurações e o menu de permissões dizem qual projeto vai mudar, e ligar qualquer um deles pede confirmação. Só o servidor Muse daquele projeto reinicia.
- Todo projeto começa protegido, inclusive os adicionados, clonados ou removidos e adicionados de novo. A antiga chave geral não é aplicada a nenhum projeto ao atualizar: quem usava YOLO ou sandbox desligada liga de novo no projeto desejado.
- Pelo terminal, o servidor sem \`--token\` cria uma credencial aleatória e imprime um link de entrada de uso único. \`--no-auth\` desliga isso, só em loopback e só para desenvolvimento.

## Correções e ajustes de 03 a 06/10/2026

Resultado de uma auditoria geral do código e de três rodadas de testes no Helicon Teste. Tudo abaixo foi conferido no build 47 (compilação \`eccf3ae\`) ou antes dele.

- **Permissões.** O modo antes chamado “Perguntar antes” agora se chama **Confiar na sandbox**, que descreve o que o Muse faz nele: edita o projeto e roda comandos confinados pela sandbox sem perguntar, e só pergunta o que ela não consegue conferir. Ligar ou desligar o YOLO não deixa mais conversas presas na permissão antiga.
- **Modelo e esforço.** O seletor de esforço mostra só os níveis que o modelo escolhido aceita. Ao trocar para um modelo que não aceita o nível atual, ele desce sozinho, com um aviso, em vez de toda mensagem falhar.
- **Uso.** Cada chamada ao modelo é contada uma vez só. Ao abrir esta edição pela primeira vez, o aplicativo apaga as cópias repetidas que versões anteriores gravaram, então **os custos da página Uso caem**. No Helicon Teste, o consumo sem data passou de US$ 45,04 para US$ 32,24. Chamadas novas passam a ter data, os dias seguem o horário local e o consumo com detalhamento incompleto aparece agrupado por motivo, com o nome de cada conversa. Excluir uma conversa mantém o uso registrado dela.
- **Rascunhos.** Imagens e arquivos anexados a uma mensagem ainda não enviada continuam lá depois de fechar o aplicativo. No desktop eles ficam em \`composer-drafts.json\`, para imagens de até cerca de 2 MB; acima disso a caixa de mensagem avisa que o anexo não será guardado.
- **Tela da conversa sem repetições.** O topo mostra só o título, o estado e os ícones. Cada resposta mostra a duração uma vez, na linha de baixo, que também abre as etapas. A velocidade ao vivo aparece no meio da conversa, e a barra lateral mostra só a roda girando enquanto o Muse trabalha. O botão de enviar fica sempre no canto direito da caixa de mensagem.
- **Textos.** “Mensagem” no lugar de “turno”, vírgula nos números, datas em português e avisos do servidor traduzidos. Arquivar por idade mostra a quantidade e explica quando não há nada para arquivar.
- **Proteção e robustez.** Anexos e a página do aplicativo ganharam proteções contra conteúdo malicioso. Rascunhos, exclusão de conversas e o registro de falhas passaram a ser gravados de forma que uma queda no meio não perde dados.

## O que este pacote não inclui

Gerenciamento de múltiplas contas do original. Instalador de macOS ou Linux. Atualização automática e \`latest.json\`.

## Antes de instalar por cima da pt4

1. Feche o Helicon. O Helicon Teste pode continuar fechado também se for mexer na pasta dele.
2. Copie as duas pastas da instalação normal, cada uma para um destino novo, com [BACKUP.md](BACKUP.md). Esse backup é a única forma de voltar atrás: ao abrir pela primeira vez, esta edição apaga sozinha as cópias repetidas do uso.
3. Só então execute o instalador \`Helicon_0.12.5-pt5_x64-setup.exe\` desta edição, obtido no rascunho da release (não publicado).
4. Na tela de manutenção, não marque apagar os dados do aplicativo. A desinstalação prévia do programa, se o instalador oferecer, não apaga essas pastas enquanto essa caixa estiver desmarcada.
5. Abra Configurações e confira **Helicon 0.12.5-pt5**. A linha **Servidor** mostra o mesmo número.

A instalação normal e o Helicon Teste continuam separados. Atualizar um não substitui o outro.

Este texto descreve o código da edição em preparação, conferido no Helicon Teste até o build 47 (\`eccf3ae\`) em 06/10/2026. A release pública segue pt4; a atualização da instalação normal sobre uma cópia da pt4 permanece sem validação registrada.`,
  },
];
