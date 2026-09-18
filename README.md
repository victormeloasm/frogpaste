# FrogPaste for LinkedIn — 0.4.0

Cole imagens sem salvar arquivos. **Em publicações, esta versão reúne as colagens numa bandeja e só entrega o lote ao clicar em Anexar todas.**

## Atualizar e usar

1. Em `about:debugging#/runtime/this-firefox`, remova a versão temporária anterior.
2. Clique em **Carregar extensão temporária** e selecione o ZIP 0.4.0, ou extraia o ZIP e selecione `manifest.json`.
3. Recarregue o LinkedIn para substituir os scripts antigos.
4. Abra uma **publicação nova**, sem imagens previamente anexadas, para testar o fluxo completo.
5. Copie uma imagem e dê Ctrl+V no editor. Ela aparece na bandeja do FrogPaste.
6. Copie outra imagem e dê Ctrl+V novamente. Repita até todas aparecerem na bandeja. É possível mudar de aba para copiar cada uma.
7. Clique em **Anexar todas (N)**. O lote é entregue ao seletor de imagens do LinkedIn em uma única operação.
8. Confira as miniaturas no próprio LinkedIn e continue a publicação normalmente.

O botão Anexar todas não publica a postagem. A bandeja permite remover imagens pelo × ou cancelar todo o lote. Fechar o editor, sair da página, recarregar ou pressionar Esc descarta a bandeja. Trocar de aba não a descarta.

Na 0.4.0, a bandeja é inserida dentro do diálogo da publicação. Isso a mantém acima do backdrop escuro e faz o clique permanecer dentro do editor; o LinkedIn não interpreta o botão como um clique fora da publicação. Ela também captura o foco e os eventos de ponteiro na borda do componente depois que seus próprios botões recebem o evento.

Se o LinkedIn ainda não criou o seletor, a bandeja informa que o lote está pronto: clique no botão de adicionar imagens do LinkedIn para abrir o campo. Se o campo identificado não aceitar o formato ou a quantidade, o lote permanece na bandeja para revisão.

A instalação temporária é removida ao reiniciar o Firefox. Uma instalação permanente no Firefox comum exige assinatura da Mozilla. Guia oficial: https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/

## Por que o fluxo mudou

O usuário relatou que a 0.2.0 ainda mantinha apenas a primeira imagem numa publicação, apesar dos testes locais. A hipótese de reutilizar o campo de upload depois de cada colagem não foi confirmada no LinkedIn real.

A 0.3.0 evita depender desse passo para o primeiro lote: reúne todas as imagens antes de iniciar o upload. A 0.4.0 corrige a montagem da bandeja no topo do diálogo, porque a versão anterior aparecia atrás do backdrop e o clique fechava a caixa de publicação.

Cada imagem do lote recebe um nome virtual exclusivo, mantendo seus bytes e MIME. Imagens diferentes vindas do clipboard frequentemente têm o mesmo nome, como `image.png`; os nomes exclusivos evitam essa colisão. Isso é uma medida de compatibilidade, não uma confirmação de que esse era o motivo da falha anterior.

Em mensagens e comentários, permanece o encaminhamento direto da 0.2.0 para o campo identificado. Esta mudança de fluxo foi feita para publicações e diálogos de imagens reconhecidos.

## Formatos e limites

Qualquer MIME `image/*` é reconhecido. Não há restrição a screenshots nem conversão forçada para PNG. Quando o MIME está vazio ou genérico, extensões conhecidas de arquivo ajudam na identificação.

O aplicativo de origem, o sistema ou o navegador podem converter a imagem antes da colagem. A extensão preserva o conteúdo efetivamente recebido; não recupera um formato ou animação que não esteja no clipboard.

O campo de destino precisa aceitar todos os formatos e permitir múltiplos arquivos quando o lote tiver mais de um. A extensão não altera o atributo `multiple`, não reduz um lote silenciosamente e não contorna os limites do servidor. O LinkedIn continua responsável pela validação final.

O novo fluxo é destinado a anexar o lote completo a uma publicação. Adicionar um segundo lote a imagens que o LinkedIn já processou ainda depende do comportamento do seu editor. Prefira reunir todas as imagens na bandeja antes de clicar em Anexar todas.

Texto e HTML sem arquivos de imagem seguem a colagem normal. Uma URL isolada não é baixada. Se a colagem contiver arquivos de imagem, eles têm prioridade sobre o texto/HTML acompanhante.

## Dados

O código executa somente em `https://www.linkedin.com/*`. Usa os arquivos do evento de colagem iniciado pelo usuário, sem permissão `clipboardRead` ou leitura periódica do clipboard.

A bandeja mantém referências aos arquivos e URLs locais para as miniaturas enquanto a publicação está aberta. Não há servidor próprio, telemetria, gravação das imagens em disco ou armazenamento permanente. As URLs de prévia são liberadas ao remover imagens ou fechar a bandeja.

Ao anexar, o upload normal do LinkedIn pode começar. A extensão não clica em publicar ou enviar.

## Validação e limitação

**Esta versão ainda não foi validada em uma sessão real autenticada do LinkedIn.** Os testes locais verificam a coleta e a entrega do lote, não a aceitação pelo backend do site.

Foram aprovados 31 testes: leitura e compatibilidade de arquivos, colagens sucessivas, lotes, montagem dentro do modal, proteção contra clique fora, aviso sem publicação aberta, campos que desaparecem após receber os arquivos, nomes repetidos, troca de aba, remoção e cancelamento. Um teste separado do clipboard real de imagens do sistema não foi executado porque o ambiente sem interface gráfica não reteve esse conteúdo.

Os testes DOM usam Firefox 153 com páginas locais e tráfego de página interceptado. Os arquivos e eventos de visibilidade são simulados. O teste de teclado usa eventos Ctrl+V reais com conteúdo de clipboard fornecido pela fixture. Nenhum desses testes usa uma conta do LinkedIn ou representa uma confirmação de funcionamento no site real.

O Console do navegador registra `FrogPaste 0.4.0 — lote entregue ao seletor` com apenas quantidade de imagens, quantidade de arquivos selecionados, `multiple` e `accept`. Esses dados ajudam a identificar se o lote chegou ao campo; não incluem bytes ou nomes das imagens e não comprovam que o upload terminou.

## Testes locais

Com Node.js 20+:

```sh
node --test tests/core.test.cjs
```

Para os testes do Firefox:

```sh
npm install --no-save playwright
npx playwright install firefox
node --test tests/core.test.cjs tests/browser.test.cjs
```

`FROGPASTE_CONTAINER_TEST=1` é uma opção exclusiva para testes em contêiner descartável. Não faz parte da extensão nem altera o Firefox do usuário.

Para testar manualmente sem enviar nada, extraia o ZIP e abra `tests/manual.html`. A página usa os mesmos scripts, mas não reproduz o isolamento de uma extensão nem o backend do LinkedIn.

## Conteúdo do pacote

- `manifest.json`: extensão Firefox Manifest V3, sem dependências de execução.
- `core.js`: extração, validação e nomes virtuais dos arquivos.
- `tray.js`: bandeja com miniaturas, remoção e botão de anexar.
- `content.js`: reconhecimento da área de edição e entrega ao seletor.
- `tests/core.test.cjs`, `tests/browser.test.cjs`, `tests/manual.html`: testes e demonstração local.

## Referências técnicas

- https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/files
- https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItemList/add
