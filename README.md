# 📅 AgPro Backend (Calendar & Automations)

Bem-vindo ao repositório do backend do sistema **AgPro**. Esta é uma API Node.js robusta focada em simplificar o gerenciamento de agendas diárias, permitindo a sincronização fluida com o Google Calendar e o disparo automatizado de lembretes e confirmações por WhatsApp.

---

## 🚀 Tecnologias Integradas

- **Linguagem**: Node.js v20 com TypeScript 5
- **Framework Web**: Express
- **Banco de Dados**: PostgreSQL com Prisma ORM
- **Integração Calendário**: Googleapis (`google-auth-library`)
- **Integração WhatsApp**: `whatsapp-web.js` + Puppeteer Headless (Chromium)
- **WebSockets**: Socket.io (para status e eventos em tempo real com o App mobile)
- **Tarefas Agendadas (Cron)**: `node-cron`
- **Containerização**: Docker e Docker Compose (Pronto para Nuvem/VPS)

---

## 📂 Arquitetura do Projeto

O projeto segue um padrão de arquitetura MVC modular dividindo responsabilidades de rotas, lógicas e integrações com o Banco de Dados.

```text
/backendAcessoGoogle
├── /prisma                # Schema do banco de dados (Tabelas) e Migrations
├── /src
│   ├── /controllers       # Lógica direta de cada Rota da API (Auth, Clients, Calendar...)
│   ├── /services          # Regras de negócios pesadas (WhatsApp, Cron, Google Web APIs)
│   ├── /middlewares       # Verificações e validações de rotas (Checagem de Token JWT)
│   ├── /utils             # Funções utilitárias (Logger estruturado em console/arquivo)
│   └── server.ts          # Ponto central de inicialização do Servidor HTTP/HTTPS/Socket
├── .env                   # Arquivo de Secrets (Banco de dados, credenciais Google, etc.)
├── Dockerfile             # Script de build da imagem ARM64 Node+Chromium
└── docker-compose.yml     # Orquestração do Backend em Produção (SSL / Volumes)
```

---

## 🛠️ Instalação Local (Desenvolvimento)

1. **Clone e Instale as Ferramentas:**
```bash
git clone https://github.com/SEU_USUARIO/AgPro-Backend.git
cd backendAcessoGoogle
npm install
```

2. **Configure o `.env`:**
   Crie ou renomeie o `.env.example` para `.env` e preencha as suas credenciais cruciais:
- A `DATABASE_URL` do seu banco PostgreSQL.
- Seus tokens GOCSPX (`GOOGLE_CLIENT_ID` e `SECRET`).
- Uma string aleatória para o `JWT_SECRET`.

3. **Inicie o Banco (Prisma):**
```bash
npx prisma generate
npx prisma migrate dev
```

4. **Inicie o Servidor Node:**
```bash
npm run dev
```

O servidor começará rodando em sincronia e o terminal vai imprimir o QRCode para conectar a sua máquina do WhatsApp Bot.

---

## ☁️ Deploy na Nuvem (Produção)

Este projeto foi milimetricamente arquitetado para um deploy liso e escalável utilizando infraestrutura **Docker**, perfeitamente adaptado para rodar nativamente em processadores **Intel/AMD** e **ARM64** (ex: *Oracle Cloud Ampere*).

### Subindo na VPS em 3 Passos:
1. Posicione sua pasta projeto e o seu arquivo `.env` definitivo dentro da sua VPS.
2. Certifique-se de que os Certificados SSL do `Certbot / Let's Encrypt` existem no caminho base do servidor: `/etc/letsencrypt`.
3. Erga o Container:
```bash
docker compose up -d --build
```

O compose cuidará de gerenciar portas `80` e `443`, e injetará magicamente o `whatsapp-web.js` em um container Linux com capacidades elevadas (`SYS_ADMIN` Cap), além de aplicar automaticamente as _Migrations_ do Prisma.

---

## 📡 Endpoints Mais Importantes

- `GET /auth/google` - Ponto de login OAuth2 para conectar na agenda.
- `GET /calendar/events-today` - Busca imediata na agenda de eventos do dia.
- `POST /whatsapp/test-disparo` - Gatilho engatilhado para verificar funcionamento da API WS.
- `WSS /` - O App frontend conecta aqui para ouvir status como o login do WhatsApp em _Real-time_!

---

💡 **Desenvolvido para criar eficiência e aproximar negócios e clientes.**
