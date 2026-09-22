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

A tag prevista é \`v0.12.5-pt5\`. Ela ainda não foi criada. A última release pública continua sendo [v0.12.4-pt4](https://github.com/nattanfx/helicon/releases/tag/v0.12.4-pt4). Instalar a pt4 não instala esta edição.

O número \`0.12.5-pt5\` é o que a interface passa a mostrar em **Versão**. Ele é maior que \`0.12.4\` na comparação do instalador, então a atualização da pt4 é tratada como upgrade. Não usar a tag \`v0.12.5\`: ela pertence a uma release do original e não a este fork.

## O que muda em relação à pt4

- O servidor local do aplicativo exige credencial. Abrir o servidor para a rede pede token, e a origem da página é conferida.
- Títulos automáticos: no máximo uma tentativa por conversa criada com **Gerar títulos** ligado. Falha ou reinício não repetem a chamada. Conversas antigas não são renomeadas. Desligar a opção cancela o que ainda não foi aplicado.
- Navegação: o primeiro clique em projeto e os atalhos de voltar deixam de trocar a conversa por engano. O texto “agora” deixa de aparecer como “há agora”.
- Conversas que congelavam passam a recarregar no máximo duas vezes por turno. Se as atualizações param, a interface avisa e permite recarregar o histórico.
- Rótulos conhecidos de aprovação ficam em português. O identificador, a decisão e o comando enviados não mudam.
- Arquivo inexistente, cota esgotada, limite temporário, recusa de acesso e sessão desalinhada ganham explicação em português. Um limite temporário não é apresentado como cota esgotada e não é reenviado sozinho.
- Edição de Markdown não salva volta depois de fechar o aplicativo, inclusive quando o arquivo fica vazio. O arquivo original só muda ao salvar. Se a cópia não couber ou o armazenamento falhar, a interface avisa.
- No desktop, essa cópia fica em \`file-drafts.json\` na pasta da instalação e continua disponível se a porta local mudar.

## Acrescentado ao código após a preparação inicial

Estas mudanças estão no commit \`6306632\`, aprovado no CI 94 e no Windows Teste 9 em consulta de 22/09/2026. A versão continua \`0.12.5-pt5\`; confira também o campo **Compilação** para distinguir builds da mesma edição. O build Teste já gerado não contém revisões documentais posteriores a esse commit.

- **Estatísticas da sessão**, nas Configurações, mostram turnos, etapas, velocidade, tokens e cache da conversa. Ficam desligadas por padrão e não calculam esses indicadores enquanto desativadas. Usam o histórico carregado, sinalizam dados parciais e não equivalem à cota ou cobrança oficial.
- **Novidades desta edição**, na seção Ambiente das Configurações, abre estas notas pelo botão **Ler**, sem consultar a rede. Não há abertura automática por mudança de versão.
- Leituras idênticas de uso do plano não repetem o evento para a interface. Leituras alteradas com o mesmo timestamp continuam sendo entregues; não há redução das consultas ou do consumo do Muse.
- A instrução dos títulos automáticos pede português brasileiro e preservação de nomes próprios e termos técnicos. O limite de uma tentativa e a proteção dos títulos antigos permanecem.

## O que este pacote não inclui

Opção de desativar o sandbox, modo YOLO e gerenciamento de múltiplas contas do original. Instalador de macOS ou Linux. Atualização automática e \`latest.json\`.

## Antes de instalar por cima da pt4

1. Feche o Helicon. O Helicon Teste pode continuar fechado também se for mexer na pasta dele.
2. Copie as duas pastas da instalação normal, cada uma para um destino novo, com [BACKUP.md](BACKUP.md).
3. Só então execute o instalador \`Helicon_0.12.5-pt5_x64-setup.exe\` desta edição, quando ele existir.
4. Na tela de manutenção, não marque apagar os dados do aplicativo. A desinstalação prévia do programa, se o instalador oferecer, não apaga essas pastas enquanto essa caixa estiver desmarcada.
5. Abra Configurações e confira **Helicon 0.12.5-pt5**. A linha **Servidor** mostra o mesmo número.

A instalação normal e o Helicon Teste continuam separados. Atualizar um não substitui o outro.

Este texto descreve o código da edição em preparação. O instalador Helicon Teste já foi gerado, com aprovação visual anterior registrada para as estatísticas e as notas. A release pública segue pt4; a atualização da instalação normal sobre uma cópia da pt4 permanece sem validação registrada.`,
  },
];
