#!/bin/bash

echo "Starting AgPro Backend Entrypoint..."
echo "Removendo locks antigos do Chromium para evitar Code 21..."

# O container pode ter sido reiniciado abruptamente. 
# Removemos os arquivos de Lock da persistencia de sessão do wwebjs_auth para o Chromium abrir limpo
rm -rf /app/.wwebjs_auth/session-single_bot_session/Default/Singleton* 2>/dev/null
rm -rf /app/.wwebjs_auth/session-single_bot_session/Singleton* 2>/dev/null

echo "Locks removidos. Iniciando aplicacao..."

# Roda as migrações e sobe a aplicação
npx prisma migrate deploy
npm start
