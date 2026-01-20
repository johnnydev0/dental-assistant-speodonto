# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dental clinic scheduling assistant for "Clínica Speodonto" - an AI-powered WhatsApp bot that handles appointment booking for dental offices. Built with Next.js 14 (App Router), Prisma + PostgreSQL (Neon), and multiple AI providers.

## Common Commands

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build
npm run lint         # Run ESLint
npm run db:generate  # Generate Prisma Client after schema changes
npm run db:push      # Sync Prisma schema with database
npm run db:studio    # Open Prisma Studio (visual database browser)
```

## Architecture

### WhatsApp Integration Flow

Two webhook routes handle incoming WhatsApp messages:
- `/api/whatsapp/webhook` - Meta Cloud API (free, requires approval)
- `/api/zapi/webhook` - Z-API (paid, recommended, no approval needed)

**Message Processing Flow:**
1. Webhook receives message → validates source
2. Creates/retrieves conversation from database
3. Builds message history for AI context
4. Calls AI service with conversation history + available time slots
5. AI generates response; if contains `AGENDAMENTO_COMPLETO` marker, extracts booking data and creates appointment
6. Sends response back via WhatsApp service

### AI Services

Multiple AI providers in `lib/`:
- `ai-service-openai.ts` - OpenAI GPT-4o-mini (currently active)
- `ai-service-gemini.ts` - Google Gemini (free)
- `ai-service-groq.ts` - Groq/Llama (free)

To switch providers, change the import in the webhook route files.

**AI Response Parsing:** When AI collects all booking info, it outputs a structured response with `AGENDAMENTO_COMPLETO` marker that gets parsed by `extractAppointmentData()` to create appointments.

### Database Models (Prisma)

- **Appointment** - Customer bookings with status (PENDING/CONFIRMED/COMPLETED/CANCELLED)
- **Conversation** - WhatsApp conversation sessions with JSON context
- **Message** - Individual messages in conversations (USER/ASSISTANT/SYSTEM roles)
- **Prescription** - Medical prescriptions
- **BlockedDate** - Fully blocked days (holidays, vacation)
- **BlockedTimeSlot** - Partially blocked time ranges

### Admin Panel

Mobile-first admin interface at `/admin/`:
- Dashboard with statistics
- Appointment management (CRUD)
- Calendar view
- Conversation history
- Prescription creation

### API Authentication

All admin API endpoints require `Authorization: Bearer ADMIN_TOKEN` header.

## Key Files

- `app/api/zapi/webhook/route.ts` - Main webhook for Z-API (most complete implementation with slot validation, conflict detection)
- `lib/ai-service-openai.ts` - AI service with system prompt defining the assistant behavior
- `prisma/schema.prisma` - Database schema definition
- `lib/convenios.json` - Insurance provider list (convênios)

## Environment Variables

Required variables are in `.env.example`. Key ones:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - For AI responses
- `ZAPI_*` or `WHATSAPP_*` - WhatsApp integration credentials
- `ADMIN_TOKEN` - Admin panel authentication

## Valid Appointment Times

The system uses fixed time slots: `09:30, 10:30, 11:30, 13:00, 14:00, 15:00, 16:00`. These are validated in the webhook routes when creating/updating appointments.
