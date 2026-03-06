import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { whatsappMultiService, qrCodeStorage } from '../services/whatsappMultiService';
import { emailService } from '../services/emailService';
import { whatsappDispatchService } from '../services/whatsappDispatchService';
import { PrismaClient } from '@prisma/client';
import { io } from '../server';

const prisma = new PrismaClient();

export const integrationController = {
    // Retorna o status das integrações de um usuário
    async getStatus(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;

            const integrations = await prisma.integration.findMany({
                where: { userId }
            });

            // Mapeia para um formato mais fácil de ler no frontend
            const statusMap = {
                GOOGLE: integrations.find(i => i.provider === 'GOOGLE')?.status || 'DISCONNECTED',
                WHATSAPP: integrations.find(i => i.provider === 'WHATSAPP')?.status || 'DISCONNECTED'
            };

            res.json(statusMap);
        } catch (error: any) {
            console.error('[INTEGRATION] Erro ao buscar status:', error);
            res.status(500).json({ error: 'Erro ao buscar status' });
        }
    },

    // Inicia a conexão do WhatsApp e envia o Email para o usuário
    async connectWhatsApp(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const userEmail = req.user!.email;

            res.json({ message: 'Iniciando instância do WhatsApp. Você receberá um E-mail em instantes.' });

            // Roda em background
            whatsappMultiService.initializeClient(userId).then(client => {
                if (!client) return;
                // Ao criar, o evento 'qr' dentro de initializeClient lidará com o QrCode
                client.on('qr', async (qr) => {
                    // Busca o token gerado na memória
                    const tokenEntry = Object.entries(qrCodeStorage).find(([_, data]) => data.userId === userId);
                    if (tokenEntry) {
                        const [token] = tokenEntry;

                        // Determinar a URL pública do servidor (ex: ngrok, cloudflare) ou localhost na variável de ambiente
                        const serverUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
                        const linkUrl = `${serverUrl}/integrations/whatsapp/qrcode/${token}`;

                        // Dispara o email
                        await emailService.sendQRCodeLink(userEmail, linkUrl);
                    }
                });
            }).catch(error => {
                console.error('[INTEGRATION] Falha silenciosa ao abrir WhatsApp:', error);
            });

        } catch (error: any) {
            console.error('[INTEGRATION] Erro ao conectar WhatsApp:', error);
            res.status(500).json({ error: 'Erro ao processar requisição' });
        }
    },

    // Desconecta o WhatsApp do usuário
    async disconnectWhatsApp(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            await whatsappMultiService.removeClient(userId);
            res.json({ message: 'WhatsApp desconectado com sucesso' });
        } catch (error: any) {
            console.error('[INTEGRATION] Erro ao desconectar WhatsApp:', error);
            res.status(500).json({ error: 'Erro ao desconectar' });
        }
    },

    // Disparo manual de testes (Frontend button)
    async testDisparo(req: AuthenticatedRequest, res: Response) {
        try {
            // Emite pro frontend que começou
            io.emit('whatsapp_test_progress', { message: 'Iniciando varredura manual de agendamentos...' });

            // Retorna a API logo pra não dar timeout (o bot corre no background)
            res.json({ message: 'Processo de disparo iniciado em background.' });

            // Chama o Dispatch Service central que manda com atraso humanizado
            const result = await whatsappDispatchService.dispatchTomorrowReminders();

            if (result.success) {
                io.emit('whatsapp_test_progress', { message: `CONCLUÍDO: ${result.disparos} mensagem(ns) enviada(s) do sistema inteiro.` });
            } else {
                io.emit('whatsapp_test_progress', { message: `ERRO: Falha ao processar os disparos.` });
            }

        } catch (error: any) {
            console.error('[INTEGRATION] Erro no teste de disparo:', error);
            io.emit('whatsapp_test_progress', { message: `ERRO Crítico: ${error.message}` });
        }
    },

    // Rota WEB Pública para exibir o QRCode renderizado
    async renderQRCodePage(req: AuthenticatedRequest, res: Response) {
        const { token } = req.params;
        const entry = qrCodeStorage[token];

        if (!entry) {
            return res.status(404).send('<h1>QR Code Expirado ou Inválido.</h1><p>Solicite uma nova conexão pelo Aplicativo Mobile.</p>');
        }

        // Renderiza HTML simples com biblioteca para desenhar QR
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Conectar WhatsApp</title>
                <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
                <style>
                    body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #f0f2f5; margin: 0; }
                    h1 { color: #075E54; }
                    .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
                    canvas { margin-top: 20px; }
                    .instructions { color: #666; margin-top: 20px; max-width: 300px; font-size: 14px; }
                    .alert-success { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; display: none; margin-top: 20px; }
                </style>
                <!-- Opcional: Poderia colocar socket.io cliente aqui para redirecionar ou mostrar mensagem de sucesso -->
                <script src="/socket.io/socket.io.js"></script>
            </head>
            <body>
                <div class="card" id="main-content">
                    <h1>Abra o WhatsApp</h1>
                    <p>No seu celular, vá em Aparelhos Conectados > Conectar um Aparelho</p>
                    <canvas id="canvas"></canvas>
                    <p class="instructions">Este QR Code atualizará em breve. Escaneie-o pela câmera do WhatsApp do celular que você deseja vincular.</p>
                </div>
                
                <div class="card alert-success" id="success-message">
                    <h1>Sucesso! ✅</h1>
                    <p>Seu WhatsApp foi conectado com sucesso. Você já pode fechar esta aba e voltar para o aplicativo.</p>
                </div>

                <script>
                    const qrData = '${entry.qr}';
                    const userId = '${entry.userId}';
                    
                    QRCode.toCanvas(document.getElementById('canvas'), qrData, { width: 250 }, function (error) {
                        if (error) console.error(error);
                        console.log('QR Code renderizado');
                    });
                    
                    // Escuta websockets se sucesso (mesmo do app)
                    const socket = io();
                    socket.on('whatsapp_connected_user_' + userId, (data) => {
                        document.getElementById('main-content').style.display = 'none';
                        document.getElementById('success-message').style.display = 'block';
                    });
                </script>
            </body>
            </html>
        `);
    }
};
