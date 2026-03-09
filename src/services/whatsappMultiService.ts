import { Client as WhatsAppClient, LocalAuth } from 'whatsapp-web.js';
import { PrismaClient } from '@prisma/client';
import { io } from '../server';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// Singleton para armazenar o único cliente em memória
let singleClient: WhatsAppClient | null = null;
// Flag de inicialização do singleton
let isInitializing = false;
// Guarda quem foi o usuário que disparou a instância para logar no banco
let globalUserId: string | null = null;

// Armazena temporariamente os QR Codes mais recentes gerados para renderização na página Web
export const qrCodeStorage: { [token: string]: { qr: string, userId: string } } = {};

export const whatsappMultiService = {
    async initializeClient(userId: string) {
        // Se já existe um cliente rodando, retorna imediatamente e mapeia a resposta
        if (singleClient) {
            console.log(`[WA-SINGLE] Cliente já está rodando (singleton). Foi originalmente solicitado por: ${globalUserId}. Nova requisição de: ${userId}`);
            return singleClient;
        }

        // Se já está inicializando, bloqueia
        if (isInitializing) {
            console.log(`[WA-SINGLE] Inicialização já em andamento. Bloqueando cliques múltiplos simultâneos.`);
            return null;
        }

        isInitializing = true;
        globalUserId = userId; // Grava o solicitante atual

        console.log(`[WA-SINGLE] Inicializando sessão ÚNICA de WhatsApp disparada pelo usuário: ${userId}`);

        // Dica de ADS / Prevenção de container Restart: Limpar lock de perfil do Chromium
        const authPath = path.join(process.cwd(), '.wwebjs_auth', `session-single_bot_session`);
        const defaultPath = path.join(authPath, 'Default');

        const locks = [
            path.join(authPath, 'SingletonLock'),
            path.join(authPath, 'SingletonCookie'),
            path.join(authPath, 'SingletonSocket'),
            path.join(defaultPath, 'SingletonLock'),
            path.join(defaultPath, 'SingletonCookie'),
            path.join(defaultPath, 'SingletonSocket')
        ];

        try {
            locks.forEach(lockPath => {
                if (fs.existsSync(lockPath)) {
                    fs.unlinkSync(lockPath);
                    console.log(`[WA-SINGLE] Arquivo de lock removido: ${lockPath}`);
                }
            });
        } catch (err) {
            console.log(`[WA-SINGLE] Aviso ao tentar limpar locks de sessão: ${err}`);
        }

        const client = new WhatsAppClient({
            authStrategy: new LocalAuth({ clientId: `single_bot_session` }), // Uma ÚNICA pasta global (nunca concorre)
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-session-crashed-bubble'
                ]
            }
        });

        client.on('auth_failure', (msg) => {
            console.error(`[WA-SINGLE] Falha na autenticação do WhatsApp:`, msg);
        });

        // Evento de geração do QR Code
        client.on('qr', (qr) => {
            console.log(`[WA-SINGLE] QR Code gerado. (Solicitante: ${globalUserId}) - O mesmo foi armazenado e enviado ao frontend.`);

            const sessionToken = Math.random().toString(36).substring(2, 15);
            if (globalUserId) {
                qrCodeStorage[sessionToken] = { qr, userId: globalUserId };
                io.emit(`whatsapp_qr_ready_${globalUserId}`, { sessionToken });
            }
        });

        // Evento de conexão bem-sucedida
        client.on('ready', async () => {
            console.log(`[WA-SINGLE] WhatsApp da sessão única está PRONTO!`);

            if (globalUserId) {
                const integration = await prisma.integration.findFirst({
                    where: { userId: globalUserId, provider: 'WHATSAPP' }
                });

                if (integration) {
                    await prisma.integration.update({
                        where: { id: integration.id },
                        data: { status: 'CONNECTED' }
                    });
                } else {
                    await prisma.integration.create({
                        data: { userId: globalUserId, provider: 'WHATSAPP', status: 'CONNECTED' }
                    });
                }

                io.emit(`whatsapp_connected_user_${globalUserId}`, { success: true });
            }
        });

        // Evento de desconexão (Ex: Clicou em Sair no celular)
        client.on('disconnected', async (reason) => {
            console.log(`[WA-SINGLE] Cliente ÚNICO foi DESCONECTADO. Motivo: ${reason}`);
            singleClient = null;

            if (globalUserId) {
                const integration = await prisma.integration.findFirst({
                    where: { userId: globalUserId, provider: 'WHATSAPP' }
                });

                if (integration) {
                    await prisma.integration.update({
                        where: { id: integration.id },
                        data: { status: 'DISCONNECTED' }
                    });
                }

                io.emit(`whatsapp_disconnected_user_${globalUserId}`, { reason });
            }
        });

        client.on('message', async msg => {
            // Lógica futura de resposta de mensagens
        });

        try {
            console.log(`[WA-SINGLE] Disparando client.initialize() com atraso de 3s para evitar crash do Puppeteer...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            await client.initialize();

            // Sucesso absoluto: libera a flag e salva o singleton global
            singleClient = client;
            isInitializing = false;
        } catch (error) {
            console.error(`[WA-SINGLE] Erro CRÍTICO ao inicializar cliente Puppeteer:`, error);
            try { await client.destroy(); } catch (e) { }
            singleClient = null;
            isInitializing = false;
            throw error; // Repassa erro para controlador
        }

        return client;
    },

    getClient(userId: string) {
        return singleClient; // Retorna sempre o mesmo (singleton)
    },

    async removeClient(userId: string) {
        if (singleClient) {
            console.log(`[WA-SINGLE] Destruindo cliente único`);
            await singleClient.destroy();
            singleClient = null;

            const integration = await prisma.integration.findFirst({
                where: { userId, provider: 'WHATSAPP' }
            });
            if (integration) {
                await prisma.integration.update({
                    where: { id: integration.id },
                    data: { status: 'DISCONNECTED' }
                });
            }
        }
    }
};
