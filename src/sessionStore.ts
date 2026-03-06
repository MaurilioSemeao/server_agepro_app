import fs from 'fs';
import path from 'path';
import logger from './utils/logger';

const storePath = path.join(__dirname, '../.auth_store');
const sessionFilePath = path.join(storePath, 'google_session.json');

// Garante que o diretório exista
if (!fs.existsSync(storePath)) {
    fs.mkdirSync(storePath, { recursive: true });
}

export const sessionStore = {
    _activeSession: null as any,
    TOKEN: 'token-secreto-temporario-123',

    get activeSession() {
        if (this._activeSession) return this._activeSession;

        if (fs.existsSync(sessionFilePath)) {
            try {
                const data = fs.readFileSync(sessionFilePath, 'utf8');
                this._activeSession = JSON.parse(data);
                return this._activeSession;
            } catch (err) {
                logger.error('[SESSION] Erro ao ler sessão do disco:', err);
                return null;
            }
        }
        return null;
    },

    set activeSession(data: any) {
        this._activeSession = data;
        if (data) {
            try {
                fs.writeFileSync(sessionFilePath, JSON.stringify(data, null, 2));
            } catch (err) {
                logger.error('[SESSION] Erro ao salvar sessão no disco:', err);
            }
        } else {
            if (fs.existsSync(sessionFilePath)) {
                fs.unlinkSync(sessionFilePath);
            }
        }
    }
};
