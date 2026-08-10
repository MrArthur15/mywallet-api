import 'dotenv/config';
import fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { errorHandler } from './error-handler.js';

import { userRoutes } from './routes/user.routes.js';
import { transactionRoutes } from './routes/transaction.routes.js';
import { accountRoutes } from './routes/account.routes.js';
import { categoryRoutes } from './routes/category.routes.js';
import { summaryRoutes } from './routes/summary.routes.js';
import { bankRoutes } from './routes/bank.routes.js';
import { creditCardRoutes } from './routes/credit-card.routes.js';
import { invoiceRoutes } from './routes/invoice.routes.js';
import { goalRoutes } from './routes/goal.routes.js';
import { budgetRoutes } from './routes/budget.routes.js';

const app = fastify({ logger: true });

app.setErrorHandler(errorHandler);

app.get('/ping', async () => {
  return { status: 'ok', message: 'MyWallet API v2 rodando 100%!' };
});

// Redireciona a URL raiz diretamente para a documentação Swagger
app.get('/', async (request, reply) => {
  return reply.redirect('/docs');
});

const start = async () => {
  try {
    await app.register(cors, { origin: true });

    await app.register(jwt, {
      secret: process.env.JWT_SECRET || 'mywallet-super-secret-key-2026',
    });

    // 1. Configuração do OpenAPI / Swagger
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'MyWallet API',
          description: 'Backend corporativo para gestão financeira pessoal, cartões e metas.',
          version: '2.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
      },
    });

    // 2. Interface Visual no navegador em /docs
    await app.register(swaggerUi, {
      routePrefix: '/docs',
    });

    // Registro das Rotas do Sistema
    await app.register(userRoutes);
    await app.register(transactionRoutes);
    await app.register(accountRoutes);
    await app.register(categoryRoutes);
    await app.register(summaryRoutes);
    await app.register(bankRoutes);
    await app.register(creditCardRoutes);
    await app.register(invoiceRoutes);
    await app.register(goalRoutes);
    await app.register(budgetRoutes);

    const port = Number(process.env.PORT) || 3333;
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Servidor rodando em http://localhost:${port}`);
    console.log(`📖 Documentação Swagger disponível em http://localhost:${port}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();