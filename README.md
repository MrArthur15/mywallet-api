# MyWallet API (Enterprise Financial Management Backend)

![TypeScript](https://img.shields.io/badge/TypeScript-111B21?style=for-the-badge&logo=typescript&logoColor=3178C6)
![Node.js](https://img.shields.io/badge/Node.js-111B21?style=for-the-badge&logo=nodedotjs&logoColor=339933)
![Fastify](https://img.shields.io/badge/Fastify-111B21?style=for-the-badge&logo=fastify&logoColor=000000)
![Prisma](https://img.shields.io/badge/Prisma_ORM-111B21?style=for-the-badge&logo=prisma&logoColor=2D3748)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-111B21?style=for-the-badge&logo=postgresql&logoColor=4169E1)
![Docker](https://img.shields.io/badge/Docker-111B21?style=for-the-badge&logo=docker&logoColor=2496ED)
![Vitest](https://img.shields.io/badge/Vitest-111B21?style=for-the-badge&logo=vitest&logoColor=FCC72B)

**MyWallet API** é uma arquitetura RESTful de back-end corporativo para gestão financeira pessoal, cartões de crédito e planejamento patrimonial. O sistema atua como um motor contábil relacional e seguro, utilizando transações atômicas (ACID), integridade referencial estrita e agregações analíticas em tempo real.

---

## 🌐 Live Demo & Ambiente de Produção

A API está implantada na nuvem utilizando **Render** e banco de dados relacional **PostgreSQL (Supabase)**, com redirecionamento automático da raiz (`/`) para a interface de testes:

* **OpenAPI / Swagger UI Interativo:** [https://mywallet-api-889p.onrender.com/docs](https://mywallet-api-889p.onrender.com/docs)
* **Status da API (Health Check):** [https://mywallet-api-889p.onrender.com/ping](https://mywallet-api-889p.onrender.com/ping)

> **💡 Como testar no navegador:**  
> Você pode criar um usuário próprio via rota `POST /users` ou gerar seu token de acesso diretamente no endpoint `POST /sessions` no Swagger UI.

---

## 🏗️ Arquitetura do Sistema (Layered & ACID-Driven)

O sistema foi projetado seguindo princípios de separação de responsabilidades e segurança contábil, evitando inconsistências financeiras:

1. **Camada de Autenticação & Segurança (Fastify + JWT):** Controle stateless de sessão assinado com tokens expiráveis e criptografia de senhas via Bcrypt (custo computacional otimizado para APIs).
2. **Motor de Domínio & Regras de Negócio (`src/routes`):** Orquestra movimentações de fluxo de caixa, projeção de despesas recorrentes/assinaturas, virada automática de faturas de cartão e resgates/aportes patrimoniais.
3. **Camada de Persistência & Integridade (`Prisma ORM` / `PostgreSQL`):** Modelagem relacional que aplica *Defensive Deletion* (bloqueio de exclusão de entidades com histórico) e concorrência segura em transações ACID (`$transaction`).

---

## 🚀 Funcionalidades Principais

* **Fluxo de Caixa & Transações ACID:** Movimentações de entrada e saída atreladas à alteração simultânea de saldo bancário, com estorno automático e seguro em caso de remoção (`DELETE`).
* **Motor de Crédito & Faturas:** Cálculo preciso de datas de fechamento e vencimento (respeitando virada de mês), suporte a parcelamentos agrupados e liquidação de faturas integrada à conta corrente.
* **Antecipação de Parcelas (`POST /invoices/:id/anticipate`):** Motor de adiantamento de parcelas futuras de cartão para a fatura atual via transação ACID, ajustando os saldos mensais simultaneamente e sinalizando os itens antecipados no extrato.
* **Metas Financeiras com Auditoria (`GoalDeposit`):** Sistema de acúmulo patrimonial onde cada aporte ou resgate movimenta o saldo bancário e registra um histórico de auditoria imutável.
* **Orçamentos Mensais & Alertas (`Budgets`):** Agregação em tempo real (`_sum` SQL) que compara o gasto realizado com o teto planejado, classificando o status da categoria em **OK**, **WARNING** (80% a 99%) ou **EXCEEDED** (> 100%).
* **Dashboard Analytics Consolidado (`/summary/analytics`):** Endpoint único de inteligência financeira que calcula o Patrimônio Líquido real (`Net Worth`), distribuição percentual de gastos por categoria e status de objetivos do mês.
* **Exportação de Relatórios (`GET /summary/export`):** Gerador de extratos mensais em **CSV** (otimizado com ponto e vírgula e encoding UTF-8 BOM para planilhas e Excel) ou **JSON** estruturado, configurado com headers HTTP para download automático.
* **Filtros Avançados & Paginação:** Suporte a paginação com metadados completos (`meta`), filtros por intervalo de datas UTC, contas, cartões e busca textual insensível a maiúsculas/minúsculas.

---

## 🧪 Engenharia de Software (SDLC & QA)

* **Documentação Interativa:** Interface OpenAPI/Swagger UI nativa acessível via `/docs` para teste e validação de contratos HTTP.
* **Testes de Integração (`Vitest` + `Supertest`):** Suíte de testes automatizados E2E cobrindo fluxos críticos de transação contábil, estorno de saldo e auditoria de metas.
* **Infraestrutura como Código & CI/CD:** Containerização completa via `docker-compose.yml`, automação de testes contínuos integrada ao **GitHub Actions** e pipeline de deploy contínuo em produção no **Render**.

---
<br><br>

<div align="center">
  <img src="https://img.shields.io/badge/SYSTEM_LOG-CONTEXT_SWITCH-111B21?style=for-the-badge&logo=google-translate&logoColor=8A05BE">
  <p><i><sub>Loading English documentation...</sub></i></p>
</div>

<br><br>

# MyWallet API (Enterprise Financial Management Backend)

**MyWallet API** is an enterprise-grade RESTful backend architecture for personal financial management, credit card billing, and wealth planning. The system acts as a secure relational accounting engine, leveraging atomic transactions (ACID), strict referential integrity, and real-time analytical aggregations.

---

## 🌐 Live Demo & Production Environment

The API is cloud-deployed using **Render** and a **PostgreSQL (Supabase)** relational database, featuring automatic redirection from the root (`/`) to the testing interface:

* **Interactive OpenAPI / Swagger UI:** [https://mywallet-api-889p.onrender.com/docs](https://mywallet-api-889p.onrender.com/docs)
* **API Health Check Endpoint:** [https://mywallet-api-889p.onrender.com/ping](https://mywallet-api-889p.onrender.com/ping)

> **💡 How to test in your browser:**  
> You can register a new test user via the `POST /users` route or generate an access token directly using the `POST /sessions` endpoint in the Swagger UI.

---

## 🏗️ System Architecture (Layered & ACID-Driven)

The system was engineered following separation of concerns and accounting security principles to prevent financial data inconsistency:

1. **Authentication & Security Layer (Fastify + JWT):** Stateless session control with expiring signed tokens and password hashing via Bcrypt (optimized computational cost for APIs).
2. **Domain Engine & Business Logic (`src/routes`):** Orchestrates cash flow movements, recurring expense/subscription projections, automatic credit card billing cycles, and asset deposits/withdrawals.
3. **Persistence & Integrity Layer (`Prisma ORM` / `PostgreSQL`):** Relational modeling enforcing *Defensive Deletion* (preventing removal of historical entities) and safe concurrency via ACID transactions (`$transaction`).

---

## 🚀 Key Features

* **Cash Flow & ACID Transactions:** Income and outcome movements tied to simultaneous bank account balance updates, with automatic and safe reversal upon deletion (`DELETE`).
* **Credit Engine & Invoices:** Accurate calculation of closing and due dates (handling month-end crossovers), support for grouped installments, and checking-account integrated invoice settlements.
* **ACID Installment Anticipation (`POST /invoices/:id/anticipate`):** Engine to advance future credit card installments into the current open invoice within an atomic ACID transaction, simultaneously recalculating monthly totals and tagging items.
* **Financial Goals with Audit Trail (`GoalDeposit`):** Wealth-building system where every deposit or withdrawal updates the bank balance and records an immutable audit log.
* **Monthly Budgets & Alerts (`Budgets`):** Real-time SQL aggregation (`_sum`) comparing actual expenditures against planned caps, classifying category status as **OK**, **WARNING** (80% to 99%), or **EXCEEDED** (> 100%).
* **Consolidated Dashboard Analytics (`/summary/analytics`):** Single financial intelligence endpoint calculating real Net Worth, percentage distribution of expenses by category, and monthly objective tracking.
* **Financial Reports Export (`GET /summary/export`):** Generates full monthly statements as **CSV** (formatted with semicolons and UTF-8 BOM for Excel compatibility) or structured **JSON**, equipped with automatic download HTTP headers.
* **Advanced Filtering & Pagination:** Full pagination support with metadata (`meta`), filtering by UTC date ranges, accounts, cards, and case-insensitive text search.

---

## 🧪 Software Engineering (SDLC & QA)

* **Interactive Documentation:** Native OpenAPI/Swagger UI interface accessible at `/docs` for HTTP contract testing and validation.
* **Integration Testing (`Vitest` + `Supertest`):** E2E automated test suite covering critical accounting transaction flows, balance reversals, and goal auditing.
* **Infrastructure as Code & CI/CD:** Complete containerization via `docker-compose.yml`, automated testing pipelines integrated with **GitHub Actions**, and continuous cloud deployment via **Render**.