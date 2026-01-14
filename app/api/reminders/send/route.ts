import { NextRequest, NextResponse } from "next/server";
import { reminderService } from "@/lib/reminder-service";

/**
 * Endpoint para enviar lembretes de consulta
 * POST /api/reminders/send
 *
 * Este endpoint deve ser chamado por um cron job diariamente
 *
 * Para proteger o endpoint, use um token de autenticação:
 * Authorization: Bearer [REMINDER_TOKEN]
 */
export async function POST(request: NextRequest) {
  try {
    // Autenticação simples via token
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.REMINDER_TOKEN;

    // Se houver token configurado, valida
    if (expectedToken) {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json(
          { error: "Token de autenticação ausente" },
          { status: 401 }
        );
      }

      const token = authHeader.substring(7);
      if (token !== expectedToken) {
        return NextResponse.json(
          { error: "Token de autenticação inválido" },
          { status: 401 }
        );
      }
    }

    // Envia os lembretes
    const result = await reminderService.sendReminders();

    return NextResponse.json({
      message: "Lembretes processados com sucesso",
      ...result,
    });
  } catch (error: any) {
    console.error("[API Reminders] Erro ao processar lembretes:", error);
    return NextResponse.json(
      { error: "Erro ao processar lembretes", details: error.message },
      { status: 500 }
    );
  }
}
