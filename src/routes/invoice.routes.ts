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
  // ===========================================================================
  // Rota POST: Antecipar Parcelas Futuras para uma Fatura Aberta
  // ===========================================================================
  app.post('/invoices/:id/anticipate', async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;

    const paramsSchema = z.object({
      id: z.string().uuid({ message: 'ID da fatura de destino inválido' }),
    });

    const bodySchema = z.object({
      installmentGroup: z.string().uuid({ message: 'ID do grupo de parcelamento é obrigatório' }),
      quantity: z.number().int().positive().optional(), // Se não informar, antecipa TODAS as restantes
    });

    const { id: targetInvoiceId } = paramsSchema.parse(request.params);
    const { installmentGroup, quantity } = bodySchema.parse(request.body);

    // 1. Verifica se a fatura de destino existe, pertence ao usuário e está ABERTA
    const targetInvoice = await prisma.invoice.findFirst({
      where: {
        id: targetInvoiceId,
        status: 'OPEN',
        creditCard: { userId },
      },
    });

    if (!targetInvoice) {
      return reply.status(404).send({
        error: 'Fatura de destino não encontrada ou já está fechada/paga.',
      });
    }

    // 2. Busca todas as parcelas futuras desse grupo (a partir de faturas posteriores à atual)
    const futureInstallments = await prisma.transaction.findMany({
      where: {
        userId,
        installmentGroup,
        invoice: {
          OR: [
            { year: { gt: targetInvoice.year } },
            { year: targetInvoice.year, month: { gt: targetInvoice.month } },
          ],
        },
      },
      orderBy: { date: 'asc' },
    });

    if (futureInstallments.length === 0) {
      return reply.status(400).send({
        error: 'Não há parcelas futuras disponíveis para antecipação neste grupo.',
      });
    }

    // Delimita quantas parcelas serão antecipadas (todas ou apenas a quantidade solicitada)
    const installmentsToAnticipate = quantity
      ? futureInstallments.slice(0, quantity)
      : futureInstallments;

    // 3. Transação ACID: Move as parcelas e ajusta os totais das faturas simultaneamente
    const result = await prisma.$transaction(async (tx) => {
      let totalAnticipatedAmount = 0;

      for (const item of installmentsToAnticipate) {
        const amount = Number(item.amount);
        totalAnticipatedAmount += amount;

        // Deduz da fatura futura de onde a parcela está saindo
        if (item.invoiceId) {
          await tx.invoice.update({
            where: { id: item.invoiceId },
            data: { totalAmount: { decrement: amount } },
          });
        }

        // Move a parcela para a fatura atual e sinaliza no título
        await tx.transaction.update({
          where: { id: item.id },
          data: {
            invoiceId: targetInvoice.id,
            title: `${item.title} [Antecipada]`,
          },
        });
      }

      // Incrementa o total da fatura atual com a soma das parcelas antecipadas
      const updatedInvoice = await tx.invoice.update({
        where: { id: targetInvoice.id },
        data: { totalAmount: { increment: totalAnticipatedAmount } },
      });

      return {
        targetInvoice: updatedInvoice,
        anticipatedCount: installmentsToAnticipate.length,
        totalAnticipatedAmount,
      };
    });

    return reply.status(200).send(result);
  });
}