# Pulse Full-Stack Social Dashboard

Java plus React implementation of a Twitter-style social app with glassmorphism UI, offline-ready persistence, authentication, follow graph, notifications, comments, and personalized timeline.

## Stack

- Backend: Spring Boot 3, Java 21, Spring Data JPA, Spring Security, JWT
- Database: Embedded H2 file database (offline, persisted to disk)
- Frontend: React 18 with Vite

## Implemented Features

- Auth: Register, login, current-user profile via JWT
- Social graph: Follow and unfollow users
- Feed: Global feed plus personalized feed from followed users
- Posting: Create post, engage actions, comments
- Notifications: Follow and post-interaction notifications
- Analytics: Dashboard metrics, trending tags, weekly activity
- UX fallback: Frontend offline fallback when backend is unavailable
- Visual design: Modern glassmorphism/glassy look across dashboard and feed

## Offline Database

The backend uses an embedded file-based H2 database:

- JDBC URL: jdbc:h2:file:./data/pulsedb;AUTO_SERVER=TRUE
- Data persists under backend/data without requiring internet

## Seed Accounts

All seed users use password: password123

- avery@pulse.dev
- maya@pulse.dev
- noah@pulse.dev

## Prerequisites

- Java 21+
- Maven 3.9+ (or install it via winget on Windows)
- Node.js 20+

## Environment Configuration

Backend configuration is environment-driven with local-safe defaults.

- Reference variables: backend/.env.example
- JWT secret should be overridden in non-local environments
- Allowed CORS origins are controlled by APP_CORS_ALLOWED_ORIGINS

Frontend configuration is also environment-driven.

- Reference variables: frontend/.env.example
- API base URL is configured with VITE_API_BASE_URL
- Firebase variables are optional; if omitted, auth flows use backend endpoints

## Run Backend

1. Open terminal in backend directory.
2. Run: mvn spring-boot:run
3. API: http://localhost:8080
4. H2 console: http://localhost:8080/h2-console

## Run Frontend

1. Open terminal in frontend directory.
2. Run: npm install
3. Run: npm run dev
4. App: http://localhost:5173 (or next available port)

## Quality Commands

Backend:

- mvn test

Frontend:

- npm run lint
- npm run test:run
- npm run build

CI:

- GitHub Actions workflow: .github/workflows/ci.yml

## API Overview

Auth:
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/refresh
- POST /api/auth/logout
- GET /api/auth/me

Feed and posts:
- GET /api/posts
- GET /api/feed/personalized
- POST /api/posts
- POST /api/posts/{id}/engage
- GET /api/posts/{id}/comments
- POST /api/posts/{id}/comments

Social:
- GET /api/users/suggested
- POST /api/users/{id}/follow
- DELETE /api/users/{id}/follow
- GET /api/notifications

Dashboard:
- GET /api/dashboard
