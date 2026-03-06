import { Request, Response } from 'express';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

const prisma = new PrismaClient();

const getAuth = async (userId: string) => {
    const integration = await prisma.integration.findFirst({
        where: { userId, provider: 'GOOGLE', status: 'CONNECTED' }
    });

    if (!integration || !integration.accessToken) {
        throw new Error('Usuário não possui integração Google conectada.');
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    // Salva automaticamente no banco caso o SDK autônomo atualize o token via Refresh
    oauth2Client.on('tokens', async (newTokens) => {
        console.log(`[CALENDAR] Token do Google refreshed (BD) para: ${userId}`);
        await prisma.integration.update({
            where: { id: integration.id },
            data: {
                accessToken: newTokens.access_token || integration.accessToken,
                refreshToken: newTokens.refresh_token || integration.refreshToken
            }
        });
    });

    oauth2Client.setCredentials({
        access_token: integration.accessToken,
        refresh_token: integration.refreshToken
    });

    return oauth2Client;
};

export const calendarController = {
    async getEvents(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const dateParam = req.query.date as string;

            // FIXME resolvido: Permite pegar eventos de qualquer dia passado por query
            const targetDate = dateParam ? new Date(dateParam + 'T00:00:00') : new Date();

            const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0)).toISOString();
            const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999)).toISOString();

            const auth = await getAuth(userId);
            const calendar = google.calendar({ version: 'v3', auth });

            const response = await calendar.events.list({
                calendarId: 'primary',
                timeMin: startOfDay,
                timeMax: endOfDay,
                singleEvents: true,
                orderBy: 'startTime',
            });

            res.json(response.data.items);
        } catch (error: any) {
            console.error('[CALENDAR] Error fetching events:', error);
            res.status(500).json({ error: error.message || 'Error fetching events' });
        }
    },

    async createEvent(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const { summary, startDateTime, endDateTime, description } = req.body;

            if (!summary || !startDateTime || !endDateTime) {
                return res.status(400).json({ error: 'summary, startDateTime e endDateTime são obrigatórios.' });
            }

            const auth = await getAuth(userId);
            const calendar = google.calendar({ version: 'v3', auth });

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
    },

    async deleteEvent(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const { eventId } = req.params;

            if (!eventId) {
                return res.status(400).json({ error: 'eventId é obrigatório.' });
            }

            const auth = await getAuth(userId);
            const calendar = google.calendar({ version: 'v3', auth });

            await calendar.events.delete({
                calendarId: 'primary',
                eventId: eventId,
            });

            res.json({ success: true });
        } catch (error: any) {
            console.error('[CALENDAR] Erro ao deletar evento:', error.message || error);
            res.status(500).json({ error: 'Erro ao deletar evento', details: error.message });
        }
    }
};
