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

export const app = fastify({
  logger: process.env.NODE_ENV !== 'test',
  ajv: {
    customOptions: {
      keywords: ['example'],
    },
  },
})
app.setErrorHandler(errorHandler);

app.get(
  '/ping',
  {
    schema: {
      tags: ['Health Check'],
      summary: 'Verificar status da API',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  },
  async () => {
    return { status: 'ok', message: 'MyWallet API v2 rodando 100%!' };
  }
);

app.get('/', async (request, reply) => {
  return reply.redirect('/docs');
});

const start = async () => {
  try {
    await app.register(cors, { origin: true });
    
    await app.register(jwt, {
      secret: process.env.JWT_SECRET || 'mywallet-super-secret-key-2026',
    });

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'MyWallet API',
          description: 'Backend corporativo para gestão financeira pessoal, cartões e metas.',
          version: '2.0.0',
        },
        tags: [
          { name: 'Auth', description: 'Autenticação e usuários' },
          { name: 'Transactions', description: 'Gestão de fluxo de caixa' },
          { name: 'Invoices', description: 'Cartões de crédito e faturas' },
          { name: 'Summary', description: 'Dashboards e relatórios' },
          { name: 'Health Check', description: 'Status do sistema' }
        ],
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

    await app.register(swaggerUi, {
      routePrefix: '/docs',
    });

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
    
    console.log(`Servidor rodando em http://localhost:${port}`);
    console.log(`Documentação Swagger disponível em http://localhost:${port}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();