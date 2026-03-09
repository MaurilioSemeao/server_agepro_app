import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { Server } from 'socket.io';
import morgan from 'morgan';

// Loggers
import logger from './utils/logger';

// Controllers e Middlewares
import { authController } from './controllers/authController';
import { calendarController } from './controllers/calendarController';
import { integrationController } from './controllers/integrationController';
import { clientController } from './controllers/clientController';
import { cronService } from './services/cronService';
import { authMiddleware, AuthenticatedRequest } from './middlewares/authMiddleware';

const app = express();
let server;

// Verifica se estamos em Produção para subir com SSL via Let's Encrypt
if (process.env.NODE_ENV === 'production') {
    try {
        const options = {
            key: fs.readFileSync('/etc/letsencrypt/live/agendapro.ddns.net/privkey.pem'),
            cert: fs.readFileSync('/etc/letsencrypt/live/agendapro.ddns.net/fullchain.pem')
        };
        server = https.createServer(options, app);
        logger.info('[SERVER] SSL/TLS Carregado com Sucesso via Certbot Let\'s Encrypt.');

        // Se está em produção, sobe um redirecionador na porta 80 puro
        const httpApp = express();
        httpApp.get('*', (req, res) => res.redirect(`https://${req.headers.host}${req.url}`));
        http.createServer(httpApp).listen(80, () => {
            logger.info('[SERVER] Servidor Redirecionador HTTP (Porta 80) ativado');
        });
    } catch (err) {
        logger.error('[SERVER] Arquivos SSL não encontrados ou falhos. Derrubando para HTTP.', err);
        server = http.createServer(app);
    }
} else {
    server = http.createServer(app);
}

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Exporta io para ser usado pelos services
export { io };

const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

app.use(morgan(':method :url :status :res[content-length] - :response-time ms', {
    stream: { write: (message) => logger.info(message.trim()) }
}));

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());

// Rota Básica / Healthcheck
app.get('/', (req, res) => {
    res.send('API de Agendamento (SaaS) rodando via Express (TypeScript)!');
});

// -------------------------------------------------------------
// ROTAS PÚBLICAS
// -------------------------------------------------------------
app.get('/auth/google', authController.getGoogleAuthUrl);
app.get('/auth/google/callback', authController.googleCallback);

// Rota WEB pública para o Usuário escanear o QR Code que ele recebeu no e-mail
app.get('/integrations/whatsapp/qrcode/:token', integrationController.renderQRCodePage);

// -------------------------------------------------------------
// ROTAS PRIVADAS (Requerem Token JWT)
// -------------------------------------------------------------

// -- Usuário Logado
app.get('/auth/me', authMiddleware, (req, res) => {
    // Retorna os dados que vieram embutidos no token, possivelmente complementando com o BD
    const authReq = req as AuthenticatedRequest;
    res.json(authReq.user);
});

// -- Integrações
app.get('/integrations/status', authMiddleware, integrationController.getStatus);
app.post('/integrations/whatsapp/connect', authMiddleware, integrationController.connectWhatsApp);
app.post('/integrations/whatsapp/disconnect', authMiddleware, integrationController.disconnectWhatsApp);
app.post('/whatsapp/test-disparo', authMiddleware, integrationController.testDisparo);

// -- Clientes
app.get('/clients', authMiddleware, clientController.getClients);
app.post('/clients', authMiddleware, clientController.createClient);

// -- Calendário
app.get('/calendar/events', authMiddleware, calendarController.getEvents);
// Mantive a velha URL "/calendar/events-today" para fallback temporário caso o frontend perca referência
app.get('/calendar/events-today', authMiddleware, calendarController.getEvents);
app.post('/calendar/events', authMiddleware, calendarController.createEvent);
app.delete('/calendar/events/:eventId', authMiddleware, calendarController.deleteEvent);

// -------------------------------------------------------------
// WEBSOCKETS
// -------------------------------------------------------------
io.on('connection', (socket) => {
    logger.info(`[SOCKET] Novo cliente conectado: ${socket.id}`);
    socket.on('disconnect', () => {
        logger.info(`[SOCKET] Cliente desconectado: ${socket.id}`);
    });
});

// Inicia o serviço Cron
cronService.start();

const finalPort = process.env.NODE_ENV === 'production' ? 443 : PORT;

server.listen(finalPort, '0.0.0.0', () => {
    logger.info(`[SERVER] Inicializado (HTTP/HTTPS + WebSocket) rodando na porta ${finalPort} em 0.0.0.0`);
});

