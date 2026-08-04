import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// 1. Cria o pool de conexão nativo do PostgreSQL usando a URL do Supabase no .env
const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });

// 2. Conecta o adaptador oficial do Prisma 7 ao Pool de conexões
const adapter = new PrismaPg(pool);

// 3. Exporta uma única instância do PrismaClient para toda a API (padrão Singleton)
export const prisma = new PrismaClient({ adapter });