import cron from 'node-cron';
import { whatsappDispatchService } from './whatsappDispatchService';
import Logger from '../utils/logger';

export const cronService = {
    start() {
        // Formato cron: MIN HORA DIA MES DIA_DA_SEMANA
        // '40 7 * * *' = 07:40 AM diáriamente 

        cron.schedule('40 7 * * *', async () => {
            Logger.info('[CRON] Acordando para executar rotina diária de disparos das 07:40 AM...');
            await whatsappDispatchService.dispatchTomorrowReminders();
            Logger.info('[CRON] Rotina diária finalizada.');
        }, {
            timezone: "America/Sao_Paulo"
        });

        Logger.info('[CRON] Agendador iniciado. Disparos programados para 07:40 AM todos os dias.');
    }
};
