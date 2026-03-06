import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';

class WhatsAppService {
    private client: Client;
    private isReady: boolean = false;

    constructor() {
        logger.info('[WHATSAPP] Inicializando o serviço do WhatsApp...');

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'bot-agendamentos',
                dataPath: './.wwebjs_auth'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
            }
        });

        let qrCount = 0;
        this.client.on('qr', (qr) => {
            qrCount++;
            if (qrCount === 1) {
                logger.info('\n[WHATSAPP] ⭐ O QRCode gerado foi reduzido com sucesso ⭐');
                logger.info('[WHATSAPP] Leia com o seu aplicativo WhatsApp no menu "Aparelhos Conectados":');
                qrcode.generate(qr, { small: true });
            } else {
                logger.info(`[WHATSAPP] O QRCode foi atualizado pelo servidor do WhatsApp. Se aquele não funcionar, reinicie o servidor para ver o QRCode atualizado.`);
            }
        });

        this.client.on('ready', () => {
            logger.info('[WHATSAPP] Cliente conectado e PRONTO para enviar mensagens!');
            this.isReady = true;
        });

        this.client.on('auth_failure', () => {
            logger.error('[WHATSAPP] Falha na autenticação do WhatsApp.');
        });

        this.client.on('disconnected', (reason) => {
            logger.warn(`[WHATSAPP] Cliente desconectado. Motivo: ${reason}`);
            this.isReady = false;
        });

        // Tentar inicializar
        this.client.initialize().catch(err => {
            logger.error('[WHATSAPP] Erro crítico ao inicializar o WhatsApp:', err);
        });
    }

    /**
     * Envia uma mensagem para o número informado e registra na log JSON
     * @param phone Número completo com DDI (Ex: 5511999999999)
     * @param message Texto a ser enviado
     * @param clientName Nome do cliente para salvar no log de disparo
     */
    public async sendMessage(phone: string, message: string, clientName: string = 'Desconhecido'): Promise<boolean> {
        if (!this.isReady) {
            logger.warn('[WHATSAPP] Tentativa de envio falhou. Cliente não está pronto.');
            return false;
        }

        try {
            // Garantir que tiramos quaisquer caracteres espúrios do telefone vindo da planilha
            let cleanPhone = phone.replace(/\D/g, '');

            // Se for número brasileiro vindo sem o DDI (10 ou 11 dígitos), coloca o 55
            if (cleanPhone.length === 10 || cleanPhone.length === 11) {
                if (!cleanPhone.startsWith('55')) {
                    cleanPhone = '55' + cleanPhone;
                }
            }

            const chatId = `${cleanPhone}@c.us`;

            await this.client.sendMessage(chatId, message);
            logger.info(`[WHATSAPP] Mensagem enviada com sucesso para: ${cleanPhone}`);

            // Escreve no log estruturado em disco
            const logEntry = {
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString('pt-BR'),
                name: clientName,
                phone: cleanPhone,
                status: 'success'
            };

            const logsDir = path.join(__dirname, '../../logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const logPath = path.join(logsDir, 'messages_log.jsonl');
            await fs.promises.appendFile(logPath, JSON.stringify(logEntry) + '\n').catch(e => logger.error('Erro escrevendo JSON log:', e));

            return true;
        } catch (error) {
            logger.error(`[WHATSAPP] Erro ao enviar mensagem para ${phone}:`, error);

            // Registra a falha no log estruturado também
            const failEntry = {
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString('pt-BR'),
                name: clientName,
                phone: phone.replace(/\D/g, ''),
                status: 'error',
                error: (error as any).message || String(error)
            };
            const logPath = path.join(__dirname, '../../logs/messages_log.jsonl');
            await fs.promises.appendFile(logPath, JSON.stringify(failEntry) + '\n').catch(() => { });

            return false;
        }
    }

    public isClientReady(): boolean {
        return this.isReady;
    }

    // Método extra para forçar a reinicialização caso dê erro no Windows
    public async reinitialize() {
        logger.info('[WHATSAPP] Tentando reiniciar cliente...');
        try {
            await this.client.destroy();
        } catch (e) { }
        this.client.initialize().catch(err => {
            logger.error('[WHATSAPP] Erro ao reinicializar:', err);
        });
    }
}

export const whatsappService = new WhatsAppService();
