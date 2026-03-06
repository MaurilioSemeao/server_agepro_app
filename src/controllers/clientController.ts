import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const clientController = {
    async createClient(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const { name, phone, birthDate, status } = req.body;

            if (!name || !phone) {
                return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
            }

            let parsedBirthDate: Date | null = null;
            if (birthDate) {
                // Tenta parse de DD/MM/YYYY se conter barras
                if (typeof birthDate === 'string' && birthDate.includes('/')) {
                    const parts = birthDate.split('/');
                    if (parts.length === 3) {
                        // Date('YYYY-MM-DD')
                        parsedBirthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`);
                    }
                } else {
                    parsedBirthDate = new Date(birthDate);
                }
            }

            const newClient = await prisma.client.create({
                data: {
                    userId,
                    name,
                    phone,
                    birthDate: parsedBirthDate,
                    status: status || 'ACTIVE'
                }
            });

            res.status(201).json(newClient);
        } catch (error) {
            console.error('[CLIENT] Erro ao criar cliente:', error);
            res.status(500).json({ error: 'Erro ao salvar cliente' });
        }
    },

    async getClients(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.id;
            const { search } = req.query;

            let whereClause: any = { userId };

            if (search) {
                whereClause = {
                    userId,
                    OR: [
                        { name: { contains: String(search), mode: 'insensitive' } },
                        { phone: { contains: String(search) } }
                    ]
                };
            }

            const clients = await prisma.client.findMany({
                where: whereClause,
                orderBy: { name: 'asc' },
                take: 50
            });

            res.json(clients);
        } catch (error) {
            console.error('[CLIENT] Erro ao listar clientes:', error);
            res.status(500).json({ error: 'Erro ao listar clientes' });
        }
    }
};
