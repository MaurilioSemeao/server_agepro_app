import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { google } from 'googleapis';
import { whatsappService } from './whatsapp';
import { sessionStore } from '../sessionStore';
import logger from '../utils/logger';

class CronService {
    constructor() {
        logger.info('[CRON] Serviço de Agendamento iniciado.');
        this.scheduleDailyReminders();
    }

    private scheduleDailyReminders() {
        // Agendar para rodar às 08:00 (hora local do servidor) todos os dias: '0 8 * * *'
        cron.schedule('0 8 * * *', async () => {
            await this.executeRoutine(false);
        });
    }

    /**
     * Executa a rotina inteira de cruzar agenda com planilha e disparar MSGs.
     * @param isTest Se true, usa um delay curtinho e indica que é ambiente de teste
     * @param progressCallback Callback opcional para o Socket.io emitir eventos no frontend
     */
    public async executeRoutine(isTest: boolean = false, progressCallback?: (msg: string) => void) {
        logger.info(`[CRON] Disparando rotina de WhatsApp (${isTest ? 'TESTE MANUAL' : 'DIÁRIA'}) em ${new Date().toISOString()}`);

        if (!whatsappService.isClientReady()) {
            logger.warn('[CRON] Abortando envio: O WhatsApp não está conectado.');
            if (progressCallback) progressCallback('ERRO: WhatsApp desconectado no servidor.');
            return;
        }

        if (!sessionStore.activeSession) {
            logger.warn('[CRON] Abortando envio: Nenhuma sessão Google ativa no servidor. Faça login no App primeiro.');
            if (progressCallback) progressCallback('ERRO: Sem sessão Google ativa.');
            return;
        }

        try {
            // 1. Buscar os Eventos de "Hoje" do Google Calendar
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );

            // Escutar por atualizações automáticas de token (ex: refresh_token foi usado)
            oauth2Client.on('tokens', (newTokens) => {
                logger.info('[CRON] Token do Google atualizado (Refresh Token acionado). Salvando nova sessão...');
                if (sessionStore.activeSession) {
                    sessionStore.activeSession = {
                        ...sessionStore.activeSession,
                        tokens: { ...sessionStore.activeSession.tokens, ...newTokens }
                    };
                }
            });

            oauth2Client.setCredentials(sessionStore.activeSession.tokens);
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);

            const calRes = await calendar.events.list({
                calendarId: 'primary',
                timeMin: startOfDay.toISOString(),
                timeMax: endOfDay.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });

            const events = calRes.data.items || [];
            if (events.length === 0) {
                logger.info('[CRON] Nenhum agendamento encontrado para hoje.');
                if (progressCallback) progressCallback('Nenhum agendamento para hoje.');
                return;
            }

            logger.info(`[CRON] ${events.length} agendamentos encontrados para hoje. Cruzando com planilha...`);
            if (progressCallback) progressCallback(`Analisando ${events.length} agendas e cruzando infos...`);

            // Buscar clientes da planilha
            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
            const spreadsheetId = process.env.SPREADSHEET_ID;
            if (!spreadsheetId) throw new Error("SPREADSHEET_ID não definido para o Cron.");

            const sheetRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'clientes!A:Z'
            });

            const rows = sheetRes.data.values;
            if (!rows || rows.length === 0) {
                logger.error('[CRON] Planilha vazia ou inatingível.');
                if (progressCallback) progressCallback('ERRO: Planilha de clientes vazia ou inatingível.');
                return;
            }

            const headers = rows[0];
            const nomeIdx = headers.findIndex((h: string) => h.toLowerCase().includes('nome'));
            const telIdx = headers.findIndex((h: string) => h.toLowerCase().includes('telefone') || h.toLowerCase().includes('celular') || h.toLowerCase().includes('numero'));

            // Criar a fila de mensagens
            const messagesToSend: Array<{ phone: string, text: string, name: string }> = [];

            for (const event of events) {
                const eventTitleRaw = event.summary?.trim() || '';
                if (!eventTitleRaw) continue;

                // Limpa o título (Remove "Consulta: ", "Agendamento: ", etc)
                const eventTitle = eventTitleRaw.replace(/consulta:\s*|agendamento:\s*/i, '').trim();

                // Procurar a pessoa na Planilha pelo Nome no Título do Evento
                const clientRow = rows.find((r, index) => {
                    if (index === 0 || !r[nomeIdx]) return false;
                    const spreadsheetName = r[nomeIdx].toString().trim().toLowerCase();
                    const calendarTitle = eventTitle.toLowerCase();
                    // Checa se um nome contém o outro (flexibilidade)
                    return calendarTitle.includes(spreadsheetName) || spreadsheetName.includes(calendarTitle);
                });

                if (clientRow && telIdx !== -1 && clientRow[telIdx]) {
                    const rawPhone = clientRow[telIdx].toString();
                    const time = new Date(event.start?.dateTime || event.start?.date || '').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                    const msg = `Olá *${eventTitle}*!\n\nPassando para confirmar o seu agendamento hoje às *${time}*.\n\nQualquer dúvida estamos à disposição!`;

                    messagesToSend.push({ phone: rawPhone, text: msg, name: eventTitle });
                } else {
                    logger.warn(`[CRON] Cliente '${eventTitle}' não encontrado na planilha ou sem telefone.`);
                }
            }

            logger.info(`[CRON] Foram geradas ${messagesToSend.length} mensagens para envio.`);
            if (progressCallback) progressCallback(`Foram encontradas ${messagesToSend.length} mensagens para enviar!`);

            if (messagesToSend.length === 0) {
                if (progressCallback) progressCallback(`Concluído: 0/0 mensagens para enviar.`);
                return;
            }

            // 3. Processar Fila de Mensagens com Delay
            for (let i = 0; i < messagesToSend.length; i++) {
                const task = messagesToSend[i];

                if (progressCallback) {
                    progressCallback(`Enviando ${i + 1}/${messagesToSend.length} mensagens... (${task.name})`);
                }

                if (i > 0) {
                    const randomDelay = isTest ? 2000 : Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
                    logger.info(`[CRON] Aguardando ${(randomDelay / 1000).toFixed(1)}s antes da próxima mensagem...`);
                    await new Promise(resolve => setTimeout(resolve, randomDelay));
                }

                await whatsappService.sendMessage(task.phone, task.text, task.name);
            }

            logger.info('[CRON] Rotina de Disparo completada com sucesso!');
            if (progressCallback) progressCallback(`CONCLUÍDO: Todos os ${messagesToSend.length} envios finalizados.`);

        } catch (error: any) {
            logger.error('[CRON] Erro executando rotina agendada:', error);
            if (progressCallback) progressCallback(`ERRO: Falha ao executar rotina - ${error.message}`);
        }
    }
}

export const cronService = new CronService();
