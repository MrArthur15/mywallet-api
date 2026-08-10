import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import fastify from 'fastify';
import jwt from '@fastify/jwt';
import { errorHandler } from '../error-handler.js';
import { transactionRoutes } from '../routes/transaction.routes.js';
import { accountRoutes } from '../routes/account.routes.js';
import { prisma } from '../lib/prisma.js';

const app = fastify();
app.setErrorHandler(errorHandler);

let authToken: string;
let userId: string;
let accountId: string;
let categoryId: string;
let bankId: string;

describe('Transactions API - Testes de Integração e Transação ACID', () => {
  beforeAll(async () => {
    await app.register(jwt, { secret: 'test-secret-key-2026' });
    await app.register(accountRoutes);
    await app.register(transactionRoutes);
    await app.ready();

    const user = await prisma.user.create({
      data: {
        name: 'Usuário de Teste ACID',
        email: `test-${Date.now()}@mywallet.com`,
        passwordHash: 'hashed-password',
      },
    });
    userId = user.id;

    authToken = app.jwt.sign({ name: user.name, email: user.email }, { sub: userId });

    const bank = await prisma.bank.create({
      data: { name: 'Banco Teste', color: '#8A05BE' },
    });
    bankId = bank.id;

    const category = await prisma.category.create({
      data: { userId, name: 'Lazer Teste', color: '#9E9E9E' },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    if (bankId) {
      await prisma.bank.delete({ where: { id: bankId } });
    }
    await app.close();
  });

  it('deve criar uma conta bancária com saldo inicial de R$ 1.000,00', async () => {
    const response = await supertest(app.server)
      .post('/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Conta Corrente Principal',
        balance: 1000.00,
        type: 'CHECKING',
        bankId,
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(Number(response.body.balance)).toBe(1000.00);

    accountId = response.body.id;
  });

  it('deve cadastrar uma despesa (OUTCOME) e subtrair o saldo da conta via ACID', async () => {
    const response = await supertest(app.server)
      .post('/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Jogo na Steam',
        amount: 250.00,
        type: 'OUTCOME',
        categoryId,
        accountId,
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe('Jogo na Steam');
    expect(response.body.isPaid).toBe(true);

    const updatedAccount = await prisma.account.findUnique({
      where: { id: accountId },
    });

    expect(Number(updatedAccount?.balance)).toBe(750.00);
  });

  it('deve estornar o saldo ao deletar uma transação paga (DELETE /transactions/:id)', async () => {
    const createRes = await supertest(app.server)
      .post('/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Compra Errada',
        amount: 100.00,
        type: 'OUTCOME',
        categoryId,
        accountId,
      });

    const transactionId = createRes.body.id;

    const deleteRes = await supertest(app.server)
      .delete(`/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(deleteRes.status).toBe(204);

    const restoredAccount = await prisma.account.findUnique({
      where: { id: accountId },
    });

    expect(Number(restoredAccount?.balance)).toBe(750.00);
  });
});