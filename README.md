# DrunkRats 🐀🍺

PWA de competição entre amigos: quem bebeu mais, quem rodou mais bares, quem tomou mais fora,
quem mais entreteve a galera e quem foi o **MVP da noite**. O MVP ganha um shot de cada um da galera.

## Como rodar

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Depois abra http://localhost:8080 no navegador. No Chrome/Edge, o ícone de "Instalar app"
aparece na barra de endereço.

> O app precisa ser aberto via `http://localhost` (não com duplo clique no `index.html`),
> senão o service worker (modo offline/instalável) não funciona.

## Como funciona

### Regra principal: cada um lança o seu

O app é pra ser usado **online, cada membro no próprio celular**. Na primeira vez que abre, a pessoa escolhe
"Quem é você?" (ou "Sou novo por aqui"), e daí em diante tudo é feito em nome dela: lançamentos, mensagens,
marcações e fotos. Ninguém lança, desfaz, apaga ou edita nada de outra pessoa.

> Hoje os dados ainda ficam só no aparelho (veja *Limitações*). A regra já está aplicada; falta o servidor
> pra juntar os lançamentos de todos.

### Noites automáticas

Ninguém precisa abrir ou encerrar a noite. Cada **dia de rolê vai do meio-dia até o meio-dia seguinte**:

- 12h → 5h: a noite (lançamentos à tarde já contam pra noite do dia).
- 5h → 12h: o **after**, que ainda conta pra noite anterior (aparece com 🌅).
- 12h: a noite fecha sozinha, o MVP é coroado e começa o dia seguinte. O aviso do MVP aparece na próxima vez que alguém abrir o app.

Os horários ficam em `DAY_TURN_HOUR` e `AFTER_FROM_HOUR` no começo do [app.js](app.js).

### Abas

| Aba | O que faz |
|---|---|
| 🏠 Início | Feed dos lançamentos de todos (os com foto aparecem grandes) e o botão **＋ Lançar**: abre a câmera direto, uma frase, o que rolou e **Lançar**. O **seu primeiro lançamento da noite exige foto**; os seguintes, foto opcional. |
| 📸 Fotos | Fotos com legenda guardadas dentro de cada noite (comprimidas e salvas no IndexedDB do aparelho). |
| 💬 Conversa | "Conversa fiada" da noite. Mensagens recebem emojis; a mais marcada ganha o prêmio 🤥 Mentira da noite. Não vale marcar a própria. Depois que a noite acaba, fica só pra leitura. |
| 🏆 Ranking | Ranking da noite + prêmios (Maior copo, Mestre dos foras, Alma da festa…) e do mês (total + nº de MVPs). |
| 🎯 Desafios | Desafios valem pontos uma vez por pessoa por noite (também contam como lançamento). Dá pra criar desafios próprios. |
| 👥 Membros | Seu perfil (nome, bicho, sair), a lista de membros e o backup (exportar/importar JSON, com as fotos). |

### Pontuação

| Ação | Pontos |
|---|---|
| 🍺 Bebida | 1 |
| 🥃 Shot | 2 |
| 📍 Novo bar/balada | 5 |
| 💔 Tomou um fora | 10 |
| 🎭 Entreteve a galera | 8 |
| 🤮 Passou mal | -5 |
| 💧 Bebeu água | -1 |

Os valores ficam em `ACTIONS` no começo do [app.js](app.js), fáceis de ajustar.

## Arquivos

- `index.html` / `styles.css` / `app.js`: o app (JS puro, sem dependências)
- `manifest.webmanifest` + `icons/`: o que torna o app instalável (`icon.svg` = ícone amarelo, `logo.svg` = só o rato com a caneca, pra fundos claros)
- `sw.js`: service worker (cache offline)
- `serve.ps1`: servidor local em PowerShell

## Limitações atuais

- **Ainda não é online:** os dados ficam no `localStorage`/IndexedDB de cada aparelho, então cada celular só vê
  o que foi lançado nele. Pra juntar tudo (feed, ranking e conversa de todos), falta um backend
  (ex.: Supabase) e hospedagem com HTTPS (ex.: GitHub Pages, Netlify ou Vercel; todos têm plano grátis).
- Sem login de verdade: o "Quem é você?" confia na pessoa. Com o backend, isso vira login por e-mail.
