import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

/**
 * Função auxiliar pura para calcular corretamente Fechamento e Vencimento
 * respeitando a virada de mês quando o Vencimento é menor/igual ao Fechamento.
 */
export function calculateInvoiceDates(year: number, month: number, closingDay: number, dueDay: number) {
  const closingDate = new Date(Date.UTC(year, month - 1, closingDay));
  
  let dueMonth = month;
  let dueYear = year;

  // Se o dia de vencimento vem depois do fechamento no calendário (ex: fecha dia 24, vence dia 03 do mês seguinte)
  if (dueDay <= closingDay) {
    dueMonth += 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      dueYear += 1;
    }
  }

  const dueDate = new Date(Date.UTC(dueYear, dueMonth - 1, dueDay));
  return { closingDate, dueDate };
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    await request.jwtVerify();
  });

  // ===========================================================================
  // Rota POST: Cria/Abre uma fatura para o mês/ano de um cartão de crédito
  // ===========================================================================
  app.post('/invoices', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const createInvoiceSchema = z.object({
      creditCardId: z.string().uuid({ message: 'ID do cartão inválido' }),
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2000).max(2100),
    });

    const { creditCardId, month, year } = createInvoiceSchema.parse(request.body);

    const card = await prisma.creditCard.findFirst({
      where: { id: creditCardId, userId },
    });

    if (!card) {
      return reply.status(404).send({ error: 'Cartão de crédito não encontrado.' });
    }

    // Cálculo exato de datas usando a função auxiliar
    const { closingDate, dueDate } = calculateInvoiceDates(year, month, card.closingDay, card.dueDay);

    const invoice = await prisma.invoice.create({
      data: {
        creditCardId,
        month,
        year,
        closingDate,
        dueDate,
        status: 'OPEN',
        totalAmount: 0, // Inicializa zerada
      },
    });

    return reply.status(201).send(invoice);
  });

  // ===========================================================================
  // Rota GET: Lista todas as faturas de um cartão específico
  // ===========================================================================
  app.get('/credit-cards/:creditCardId/invoices', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      creditCardId: z.string().uuid({ message: 'ID do cartão inválido' }),
    });

    const { creditCardId } = paramsSchema.parse(request.params);

    const cardExists = await prisma.creditCard.findFirst({
      where: { id: creditCardId, userId },
    });

    if (!cardExists) {
      return reply.status(404).send({ error: 'Cartão não encontrado.' });
    }

    const invoices = await prisma.invoice.findMany({
      where: { creditCardId },
      include: {
        transactions: {
          orderBy: { date: 'desc' },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return reply.status(200).send(invoices);
  });

  // ===========================================================================
  // Rota POST: Pagar Fatura (Debita da Conta Bancária em transação ACID)
  // ===========================================================================
  app.post('/invoices/:id/pay', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da fatura inválido' }),
    });

    const bodySchema = z.object({
      accountId: z.string().uuid({ message: 'ID da conta bancária para débito é obrigatório' }),
      amountPaid: z.number().positive({ message: 'O valor pago deve ser maior que zero' }),
    });

    const { id } = paramsSchema.parse(request.params);
    const { accountId, amountPaid } = bodySchema.parse(request.body);

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { creditCard: true },
    });

    if (!invoice || invoice.creditCard.userId !== userId) {
      return reply.status(404).send({ error: 'Fatura não encontrada.' });
    }

    if (invoice.status === 'PAID') {
      return reply.status(400).send({ error: 'Esta fatura já está paga.' });
    }

    const updatedInvoice = await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: { decrement: amountPaid },
        },
      });

      const paidInvoice = await tx.invoice.update({
        where: { id },
        data: { status: 'PAID' },
      });

      return paidInvoice;
    });

    return reply.status(200).send(updatedInvoice);
  });
}