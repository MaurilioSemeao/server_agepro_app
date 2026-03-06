import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { whatsappMultiService } from './whatsappMultiService';
import Logger from '../utils/logger';

const prisma = new PrismaClient();

// Função auxiliar genérica para aguardar
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Função para buscar Auth Object do Google para um usuário específico
const getGoogleAuthForUser = async (userId: string) => {
    const integration = await prisma.integration.findFirst({
        where: { userId, provider: 'GOOGLE', status: 'CONNECTED' }
    });

    if (!integration || !integration.accessToken) {
        throw new Error(`Google Integration not found or not connected for user ${userId}`);
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
        access_token: integration.accessToken,
        refresh_token: integration.refreshToken
    });

    return oauth2Client;
};


export const whatsappDispatchService = {
    /**
     * Função central para buscar e despachar todas as mensagens de agendamentos 
     * pro dia seguinte de TODOS OS USUÁRIOS ativos.
     */
    async dispatchTomorrowReminders() {
        Logger.info('[DISPATCH] Iniciando rotina de checagem e disparo de agendamentos para o dia seguinte...');

        try {
            // 1. Busca todos os usuários que tem WhatsApp conectado
            const activeWaIntegrations = await prisma.integration.findMany({
                where: { provider: 'WHATSAPP', status: 'CONNECTED' },
                include: { user: true }
            });

            if (activeWaIntegrations.length === 0) {
                Logger.info('[DISPATCH] Nenhum usuário com WhatsApp conectado no BD. Encerrando rotina.');
                return { success: true, message: 'Nenhum usuário com WhatsApp conectado.' };
            }

            Logger.info(`[DISPATCH] ${activeWaIntegrations.length} usuários com status CONNECTED encontrados.`);

            let totalDisparos = 0;

            // 2. Itera sobre cada usuário 
            for (const waInt of activeWaIntegrations) {
                const userId = waInt.userId;
                const user = waInt.user;

                // Verifica se o singleton/cliente WA existe na memória do servidor para aquele usuário
                let waClient = whatsappMultiService.getClient(userId);

                if (!waClient) {
                    // ADICIONADO: Se o bot caiu (server reload), o initialize aqui 
                    // vai disparar o QR Code novo. Então talvez o usuário receba 
                    // email do nada se ele já era CONNECTED mas a sessão caiu.
                    // Isso é o comportamento correto para auto-manutenção de sessão ativa.
                    Logger.info(`[DISPATCH] Cliente WhatsApp não rodando na memória para usuário ${userId}. Tentando instanciar...`);
                    waClient = await whatsappMultiService.initializeClient(userId);
                }

                if (!waClient) {
                    Logger.warn(`[DISPATCH] Falha ao obter Cliente WhatsApp para usuário ${userId}. Pulando.`);
                    continue;
                }

                // Espera um pouco pra ter a certeza de que a flag 'ready' já rodou, se acabademo de gerar 
                await delay(2000);

                try {
                    // Busca tokens do calendar pro usuário  
                    const auth = await getGoogleAuthForUser(userId);
                    const calendar = google.calendar({ version: 'v3', auth });

                    // Calcula o dia de amanhã
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);

                    const startOfTomorrow = new Date(tomorrow.setHours(0, 0, 0, 0)).toISOString();
                    const endOfTomorrow = new Date(tomorrow.setHours(23, 59, 59, 999)).toISOString();

                    Logger.info(`[DISPATCH] Buscando agendas entre ${startOfTomorrow} e ${endOfTomorrow} para usuário ${user.name}`);

                    const res = await calendar.events.list({
                        calendarId: 'primary',
                        timeMin: startOfTomorrow,
                        timeMax: endOfTomorrow,
                        singleEvents: true,
                        orderBy: 'startTime',
                    });

                    const events = res.data.items || [];

                    if (events.length === 0) {
                        Logger.info(`[DISPATCH] Sem agendamentos marcados amanhã para o usuário ${user.name}`);
                        continue;
                    }

                    Logger.info(`[DISPATCH] Usuário ${user.name} tem ${events.length} agendamentos amanhã. Preparando fila humanizada.`);

                    // 3. Fila de envio "Humanizado" (Atraso entre 30 a 60 segs por mensagem daquele profissional)
                    for (const event of events) {
                        // Regex pra tentar extrair Telefone da Descrição (Ex: "Telefone: (11) 99999-9999")
                        const phoneMatch = event.description?.match(/(?:Telefone:\s*)?\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/);

                        if (!phoneMatch) {
                            Logger.warn(`[DISPATCH] Evento "${event.summary}" não possui telefone identificável na descrição. Pulando.`);
                            continue;
                        }

                        // Limpa o telefone para digitos crus, e adiciona o cod país (55)
                        let rawPhone = phoneMatch[0].replace(/\D/g, '');
                        if (!rawPhone.startsWith('55')) {
                            rawPhone = `55${rawPhone}`;
                        }
                        const waId = `${rawPhone}@c.us`;

                        // Extrai o nome limpo do summary (Remove prefixos de Consulta/Agendamento indesejados)
                        let clientName = event.summary?.trim() || 'Cliente';
                        const prefixRegex = /^(?:consulta|agendamento|att)s?[^\w]*\s*/i;

                        clientName = clientName.replace(prefixRegex, '').trim();
                        if (!clientName) {
                            clientName = event.summary?.trim() || 'Cliente';
                        }

                        // Formata a hora do evento
                        const eventDate = event.start?.dateTime ? new Date(event.start.dateTime) : tomorrow;
                        const eventHourStr = eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                        // Monta a mensagem final humanizada usando os props
                        const msgText = `Olá, ${clientName.split(" ", 1)[0]}, passando pra lembrar da sua consulta amanhã às ${eventHourStr}. Caso não puder comparecer, me avise com antecedência por favor!`;

                        // Aplica o atraso antispam ANTES do disparo (entre 30s e 60s)
                        const randomDelay = Math.floor(Math.random() * (50000 - 45000 + 1)) + 30000;
                        Logger.info(`[DISPATCH] Aguardando ${randomDelay / 1000}s para enviar msg para ${clientName} (${rawPhone})...`);
                        await delay(randomDelay);

                        try {
                            // Finalmente, dispara pelo socket p/ o WhatsApp
                            await waClient.sendMessage(waId, msgText);
                            Logger.info(`[DISPATCH] ✅ Mensagem de lembrete enviada para ${clientName} com sucesso!`);
                            totalDisparos++;
                        } catch (sendErr) {
                            Logger.error(`[DISPATCH] ❌ Erro ao enviar para ${waId}:`, sendErr);
                        }
                    }

                } catch (userErr: any) {
                    Logger.error(`[DISPATCH] Erro ao processar o usuário ${user.name}:`, userErr.message || userErr);
                    // Continua pros outros profissionais do SaaS.
                }
            }

            Logger.info(`[DISPATCH] Rotina finalizada! ${totalDisparos} Lembretes totais disparados no sistema.`);
            return { success: true, disparos: totalDisparos };

        } catch (error: any) {
            Logger.error('[DISPATCH] Falha global na rotina de disparo.', error);
            return { success: false, error: error.message };
        }
    }
}
