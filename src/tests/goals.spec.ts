import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import fastify from 'fastify';
import jwt from '@fastify/jwt';
import { errorHandler } from '../error-handler.js';
import { goalRoutes } from '../routes/goal.routes.js';
import { accountRoutes } from '../routes/account.routes.js';
import { prisma } from '../lib/prisma.js';

const app = fastify();
app.setErrorHandler(errorHandler);

let authToken: string;
let userId: string;
let accountId: string;
let goalId: string;
let bankId: string;

describe('Goals API - Metas Financeiras e Auditoria GoalDeposit', () => {
  beforeAll(async () => {
    await app.register(jwt, { secret: 'test-secret-key-2026' });
    await app.register(accountRoutes);
    await app.register(goalRoutes);
    await app.ready();

    const user = await prisma.user.create({
      data: {
        name: 'Usuário Teste Metas',
        email: `goals-${Date.now()}@mywallet.com`,
        passwordHash: 'hashed-password',
      },
    });
    userId = user.id;

    authToken = app.jwt.sign({ name: user.name, email: user.email }, { sub: userId });

    const bank = await prisma.bank.create({
      data: { name: 'Banco Metas', color: '#111111' },
    });
    bankId = bank.id;

    const acc = await prisma.account.create({
      data: {
        userId,
        name: 'Conta Reserva',
        balance: 2000.00,
        type: 'CHECKING',
        bankId,
      },
    });
    accountId = acc.id;
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (bankId) await prisma.bank.delete({ where: { id: bankId } });
    await app.close();
  });

  it('deve criar uma meta financeira com saldo inicial zerado', async () => {
    const response = await supertest(app.server)
      .post('/goals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Fundo PC Gamer',
        targetAmount: 8000.00,
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe('Fundo PC Gamer');
    expect(Number(response.body.savedAmount)).toBe(0);
    goalId = response.body.id;
  });

  it('deve aportar R$ 500,00 na meta, debitar da conta e criar auditoria GoalDeposit', async () => {
    const response = await supertest(app.server)
      .post(`/goals/${goalId}/deposit`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        accountId,
        amount: 500.00,
      });

    expect(response.status).toBe(200);
    expect(Number(response.body.savedAmount)).toBe(500.00);

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    expect(Number(account?.balance)).toBe(1500.00);

    const deposits = await prisma.goalDeposit.findMany({ where: { goalId } });
    expect(deposits.length).toBe(1);
    expect(Number(deposits[0].amount)).toBe(500.00);
  });
});