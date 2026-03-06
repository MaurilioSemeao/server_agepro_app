import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { sessionStore } from '../sessionStore';
import { io } from '../server';

const router = Router();

const getAuth = (tokens: any) => {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    // Salvar token persistente no disco quando houver refresh automático
    oauth2Client.on('tokens', (newTokens) => {
        if (sessionStore.activeSession) {
            console.log('[CALENDAR] Token do Google atualizado no cache/disco (Refresh)');
            sessionStore.activeSession = {
                ...sessionStore.activeSession,
                tokens: { ...sessionStore.activeSession.tokens, ...newTokens }
            };
        }
    });

    oauth2Client.setCredentials(tokens);
    return oauth2Client;
};

router.get('/list', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token !== sessionStore.TOKEN || !sessionStore.activeSession) {
        return res.status(401).send('Not authenticated');
    }

    const auth = getAuth(sessionStore.activeSession.tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
        const response = await calendar.calendarList.list();
        res.json(response.data.items);
    } catch (error) {
        console.error('[CALENDAR] Error fetching calendar list:', error);
        res.status(500).send('Error fetching calendars');
    }
});

router.get('/events-today', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token !== sessionStore.TOKEN || !sessionStore.activeSession) {
        return res.status(401).send('Not authenticated');
    }

    const auth = getAuth(sessionStore.activeSession.tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const dateParam = req.query.date as string;
    const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();

    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999)).toISOString();

    try {
        console.log(`[CALENDAR] Buscando eventos para ${sessionStore.activeSession.user.email}`);
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay,
            timeMax: endOfDay,
            singleEvents: true,
            orderBy: 'startTime',
        });

        // Auto-registrar o watch na primeira busca de eventos se o Host for fornecido (Cloudflare Tunnel)
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;

        // Verifica se temos um canal ativo na sessao (simplificação)
        if (host && !sessionStore.activeSession.channelId) {
            const webhookUrl = `${protocol}://${host}/calendar/webhook`;
            console.log(`[WATCH] Tentando registrar canal automaticamente em: ${webhookUrl}`);
            try {
                const channelId = uuidv4();
                await calendar.events.watch({
                    calendarId: 'primary',
                    requestBody: {
                        id: channelId,
                        type: 'web_hook',
                        address: webhookUrl
                    }
                });

                // Salva na sessao para nao ficar registrando toda hora
                sessionStore.activeSession.channelId = channelId;
                console.log(`[WATCH] Canal ${channelId} registrado com SUCESSO!`);
            } catch (watchError: any) {
                // Não falha a busca do calendario se o watch falhar (ex: erro de dominio nao verificado)
                console.warn('[WATCH] Aviso: Nao foi possivel registrar o watch automaticamente.', watchError.message || watchError.response?.data);
            }
        }

        res.json(response.data.items);
    } catch (error) {
        console.error('[CALENDAR] Error fetching events:', error);
        res.status(500).send('Error fetching events');
    }
});

// --- Novo: Criar um Evento ---
router.post('/events', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token !== sessionStore.TOKEN || !sessionStore.activeSession) {
        return res.status(401).send('Not authenticated');
    }

    const { summary, startDateTime, endDateTime, description } = req.body;

    if (!summary || !startDateTime || !endDateTime) {
        return res.status(400).json({ error: 'summary, startDateTime e endDateTime são obrigatórios.' });
    }

    const auth = getAuth(sessionStore.activeSession.tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
        console.log(`[CALENDAR] Criando evento: ${summary} - de ${startDateTime} a ${endDateTime}`);
        const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary,
                description,
                start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
                end: { dateTime: endDateTime, timeZone: 'America/Sao_Paulo' },
            }
        });

        res.json({ success: true, event: response.data });
    } catch (error: any) {
        console.error('[CALENDAR] Erro ao criar evento:', error.message || error);
        res.status(500).json({ error: 'Erro ao criar evento', details: error.message });
    }
});

// --- Novo: Deletar um Evento ---
router.delete('/events/:eventId', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token !== sessionStore.TOKEN || !sessionStore.activeSession) {
        return res.status(401).send('Not authenticated');
    }

    const { eventId } = req.params;

    if (!eventId) {
        return res.status(400).json({ error: 'eventId é obrigatório.' });
    }

    const auth = getAuth(sessionStore.activeSession.tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
        console.log(`[CALENDAR] Deletando evento: ${eventId}`);
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId,
        });

        res.json({ success: true });
    } catch (error: any) {
        console.error('[CALENDAR] Erro ao deletar evento:', error.message || error);
        res.status(500).json({ error: 'Erro ao deletar evento', details: error.message });
    }
});

// --- Novo: Registrar Canal de Watch ---
router.post('/watch', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token !== sessionStore.TOKEN || !sessionStore.activeSession) {
        return res.status(401).send('Not authenticated');
    }

    const { webhookUrl } = req.body;
    if (!webhookUrl) {
        return res.status(400).send('webhookUrl is required');
    }

    const auth = getAuth(sessionStore.activeSession.tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
        const channelId = uuidv4(); // Unique ID for this channel

        console.log(`[WATCH] Registrando webhook para ${webhookUrl} com ID ${channelId}`);
        const response = await calendar.events.watch({
            calendarId: 'primary',
            requestBody: {
                id: channelId,
                type: 'web_hook',
                address: webhookUrl
            }
        });

        res.json({ success: true, channel: response.data });
    } catch (error: any) {
        console.error('[WATCH] Erro ao registrar watch:', error.response?.data || error.message);
        res.status(500).json({ error: 'Erro ao registrar watch', details: error.response?.data });
    }
});

// --- Novo: Receber Notificações do Google (Webhook) ---
router.post('/webhook', (req: Request, res: Response) => {
    // O Google envia headers específicos:
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state']; // Ex: 'sync', 'exists'

    console.log(`[WEBHOOK] Notificação recebida! Canal: ${channelId} | Estado: ${resourceState}`);

    // Se o estado for 'exists', significa que houve alguma mutação (create, update, delete)
    if (resourceState === 'exists') {
        console.log('[WEBHOOK] Emitindo evento via WebSocket para o aplicativo...');
        io.emit('calendarUpdate', { timestamp: new Date(), message: 'O calendário foi atualizado!' });
    }

    // O Google exige que respondamos com 200 OK rapidamente
    res.status(200).send('OK');
});

export default router;
