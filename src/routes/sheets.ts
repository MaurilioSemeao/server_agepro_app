import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { sessionStore } from '../sessionStore';

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
            console.log('[SHEETS] Token do Google atualizado no cache/disco (Refresh)');
            sessionStore.activeSession = {
                ...sessionStore.activeSession,
                tokens: { ...sessionStore.activeSession.tokens, ...newTokens }
            };
        }
    });

    oauth2Client.setCredentials(tokens);
    return oauth2Client;
};

router.get('/clients', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token !== sessionStore.TOKEN || !sessionStore.activeSession) {
        return res.status(401).send('Not authenticated');
    }

    const { query } = req.query;
    const searchQuery = query ? String(query).toLowerCase() : '';

    const auth = getAuth(sessionStore.activeSession.tokens);
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    try {
        let spreadsheetId = process.env.SPREADSHEET_ID;

        // Se não tiver o ID na .env, procura pelo nome "clientes_clinica"
        if (!spreadsheetId) {
            console.log('[SHEETS] Buscando planilha "clientes_clinica" no Drive...');
            const driveRes = await drive.files.list({
                q: "name='clientes_clinica' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            const files = driveRes.data.files;
            if (!files || files.length === 0) {
                console.warn('[SHEETS] Planilha "clientes_clinica" não encontrada.');
                return res.status(404).json({ error: 'Planilha clientes_clinica não encontrada no Google Drive.' });
            }

            spreadsheetId = files[0].id!;
            console.log(`[SHEETS] Planilha encontrada com ID: ${spreadsheetId}`);
        }

        // Lê a aba 'clientes' (ou usa a primeira aba se falhar)
        // O usuário mencionou que os dados começam na tabela, vamos buscar A:D (NOME NUMERO_TELEFONE ANIVERSARIO STATUS)
        console.log(`[SHEETS] Lendo dados da planilha...`);
        const sheetsRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'clientes!A:D', // Usa o nome da aba 'clientes'
        });

        const rows = sheetsRes.data.values;
        if (!rows || rows.length === 0) {
            return res.json([]);
        }

        // rows[0] = cabeçalho: [ 'NOME', 'NUMERO_TELEFONE', 'ANIVERSARIO', 'STATUS' ]
        const headers = rows[0].map(h => h.toString().toUpperCase());
        const nomeIdx = headers.indexOf('NOME');
        const telIdx = headers.indexOf('NUMERO_TELEFONE');

        if (nomeIdx === -1) {
            console.error('[SHEETS] Coluna NOME não encontrada no cabeçalho.');
            return res.status(400).json({ error: 'Formato da planilha inválido. Coluna NOME faltando.' });
        }

        const clients: { id: string; name: string; phone: string }[] = [];
        // Começa de 1 para pular o cabeçalho
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const nome = row[nomeIdx] ? row[nomeIdx].toString() : '';
            const telefone = telIdx !== -1 && row[telIdx] ? row[telIdx].toString() : '';

            if (nome) {
                clients.push({ id: `row-${i}`, name: nome, phone: telefone });
            }
        }

        // Filtro e Ordenação Inteligente
        let filteredClients = clients;
        if (searchQuery) {
            filteredClients = clients.filter(c =>
                c.name.toLowerCase().includes(searchQuery) ||
                c.phone.includes(searchQuery)
            );

            // Ordenar: Nomes que COMEÇAM com a query vêm primeiro
            filteredClients.sort((a, b) => {
                const aStarts = a.name.toLowerCase().startsWith(searchQuery);
                const bStarts = b.name.toLowerCase().startsWith(searchQuery);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                // Se ambos começam (ou não), ordena alfabeticamente
                return a.name.localeCompare(b.name);
            });
        } else {
            // Se não tem query mas listou, ordena alfabeticamente
            filteredClients.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Limita a 20 resultados para não pesar no frontend
        res.json(filteredClients.slice(0, 20));

    } catch (error: any) {
        console.error('[SHEETS] Error accessing sheets:', error.message || error);
        res.status(500).json({ error: 'Error accessing Google Sheets', details: error.message });
    }
});

export default router;
