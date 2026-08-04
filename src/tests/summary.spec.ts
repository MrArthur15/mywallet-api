import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import fastify from 'fastify';
import jwt from '@fastify/jwt';
import { errorHandler } from '../error-handler.js';
import { summaryRoutes } from '../routes/summary.routes.js';
import { prisma } from '../lib/prisma.js';

const app = fastify();
app.setErrorHandler(errorHandler);

let authToken: string;
let userId: string;

describe('Summary Analytics API - Consolidado Financeiro', () => {
  beforeAll(async () => {
    await app.register(jwt, { secret: 'test-secret-key-2026' });
    await app.register(summaryRoutes);
    await app.ready();

    const user = await prisma.user.create({
      data: {
        name: 'Usuário Analytics',
        email: `analytics-${Date.now()}@mywallet.com`,
        passwordHash: 'hashed-password',
      },
    });
    userId = user.id;
    authToken = app.jwt.sign({ name: user.name, email: user.email }, { sub: userId });
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it('deve retornar a estrutura consolidada em /summary/analytics com netWorth calculado', async () => {
    const response = await supertest(app.server)
      .get('/summary/analytics?month=8&year=2026')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('overview');
    expect(response.body).toHaveProperty('expensesByCategory');
    expect(response.body).toHaveProperty('budgets');
    expect(response.body).toHaveProperty('goals');
    expect(response.body.overview).toHaveProperty('netWorth');
  });
});