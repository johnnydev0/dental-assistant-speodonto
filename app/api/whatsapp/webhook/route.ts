import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { openAIService as aiService } from "@/lib/ai-service-openai";
import { whatsappService } from "@/lib/whatsapp-service";

// Webhook verification (GET)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully!");
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// Função auxiliar para limpar conversas antigas (executada em background)
async function cleanupOldConversations() {
  try {
    const tenDaysAgo = new Date()
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)

    await prisma.conversation.deleteMany({
      where: {
        updatedAt: {
          lt: tenDaysAgo
        }
      }
    })
  } catch (error) {
    // Silenciosamente ignora erros de limpeza para não impactar o webhook
  }
}

// Webhook para receber mensagens (POST)
export async function POST(request: NextRequest) {
  try {
    // Executa limpeza de conversas antigas em background (não bloqueia o webhook)
    cleanupOldConversations().catch(() => {})

    const body = await request.json();

    // Verifica se é uma mensagem de texto
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) {
      return NextResponse.json({ status: "no_messages" });
    }

    const message = value.messages[0];
    const from = message.from; // Número do WhatsApp do cliente
    const messageId = message.id;
    const messageText = message.text?.body;

    if (!messageText) {
      return NextResponse.json({ status: "not_text_message" });
    }

    // Marca mensagem como lida
    await whatsappService.markAsRead(messageId);

    // Busca ou cria conversa
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber: from, status: "ACTIVE" },
      include: { messages: { orderBy: { timestamp: "asc" } } },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          phoneNumber: from,
          status: "ACTIVE",
          context: {},
        },
        include: { messages: true },
      });
    }

    // Salva mensagem do usuário
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: messageText,
      },
    });

    // Prepara histórico de mensagens para a IA
    const messageHistory = conversation.messages.map((msg) => ({
      role: msg.role.toLowerCase() as "user" | "assistant" | "system",
      content: msg.content,
    }));

    // Adiciona nova mensagem
    messageHistory.push({
      role: "user",
      content: messageText,
    });

    // Obtém contexto da conversa
    const context = (conversation.context as any) || {};

    // Chama IA para gerar resposta
    const aiResponse = await aiService.chat(messageHistory, context);

    // Salva resposta da IA
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: aiResponse,
      },
    });

    // Verifica se o agendamento foi completado
    const appointmentData = aiService.extractAppointmentData(aiResponse);

    if (appointmentData.isComplete && appointmentData.data) {
      // VALIDAÇÃO CRÍTICA: Verifica se o nome foi extraído corretamente
      if (!appointmentData.data.customerName || appointmentData.data.customerName.trim() === '') {
        const errorMessage =
          `⚠️ Desculpe, houve um problema ao processar seu nome. ` +
          `Por favor, me informe seu nome completo novamente para confirmarmos o agendamento.`;

        await whatsappService.sendMessage(from, errorMessage);
        return NextResponse.json({ status: "error_missing_name" });
      }

      const requestedDate = new Date(appointmentData.data.date);
      const requestedTime = appointmentData.data.time;

      // Salvar dados de debug no contexto
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          context: {
            ...context,
            customerName: appointmentData.data.customerName,
            lastExtractedData: {
              name: appointmentData.data.customerName,
              service: appointmentData.data.service,
              date: appointmentData.data.date,
              time: appointmentData.data.time,
              extractedAt: new Date().toISOString(),
              userMessageTimestamp: new Date().toISOString(),
            }
          }
        }
      });

      // 1. Verifica se o dia está completamente bloqueado
      const blockedDate = await prisma.blockedDate.findFirst({
        where: {
          date: requestedDate
        }
      });

      if (blockedDate) {
        const blockMessage =
          `Desculpe, mas o dia ${requestedDate.toLocaleDateString('pt-BR')} está indisponível` +
          (blockedDate.reason ? ` (${blockedDate.reason})` : '') +
          `. Por gentileza, escolha outra data para seu agendamento.`;

        await whatsappService.sendMessage(from, blockMessage);
        return NextResponse.json({ status: "date_blocked" });
      }

      // 2. Verifica se há bloqueio de horário específico
      const blockedTimeSlots = await prisma.blockedTimeSlot.findMany({
        where: {
          date: requestedDate
        }
      });

      // Função auxiliar para verificar se um horário está dentro de um intervalo bloqueado
      const isTimeBlocked = (time: string, slots: Array<{ startTime: string; endTime: string }>): boolean => {
        return slots.some((slot: { startTime: string; endTime: string }) => {
          // Converter horários para minutos para facilitar comparação
          const [reqHour, reqMin] = time.split(':').map(Number);
          const [startHour, startMin] = slot.startTime.split(':').map(Number);
          const [endHour, endMin] = slot.endTime.split(':').map(Number);

          const requestedMinutes = reqHour * 60 + reqMin;
          const startMinutes = startHour * 60 + startMin;
          const endMinutes = endHour * 60 + endMin;

          return requestedMinutes >= startMinutes && requestedMinutes < endMinutes;
        });
      };

      if (isTimeBlocked(requestedTime, blockedTimeSlots)) {
        const blockedSlot = blockedTimeSlots.find((slot: { startTime: string; endTime: string; reason?: string | null }) => {
          const [reqHour, reqMin] = requestedTime.split(':').map(Number);
          const [startHour, startMin] = slot.startTime.split(':').map(Number);
          const [endHour, endMin] = slot.endTime.split(':').map(Number);

          const requestedMinutes = reqHour * 60 + reqMin;
          const startMinutes = startHour * 60 + startMin;
          const endMinutes = endHour * 60 + endMin;

          return requestedMinutes >= startMinutes && requestedMinutes < endMinutes;
        });

        const blockMessage =
          `Desculpe, mas o horário ${requestedTime} do dia ${requestedDate.toLocaleDateString('pt-BR')} está indisponível` +
          (blockedSlot?.reason ? ` (${blockedSlot.reason})` : '') +
          `. Por gentileza, escolha outro horário para seu agendamento.\n\n` +
          `Horários disponíveis: 9h30, 10h00, 10h30, 11h00, 11h30, 13h00, 13h30, 14h00, 14h30, 15h00, 15h30, 16h00, 16h30`;

        await whatsappService.sendMessage(from, blockMessage);
        return NextResponse.json({ status: "time_blocked" });
      }

      // 3. Verifica se já existe um agendamento PENDING ou CONFIRMED para este cliente
      const existingAppointments = await prisma.appointment.findMany({
        where: {
          customerPhone: from,
          status: {
            in: ["PENDING", "CONFIRMED"]
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Se houver agendamentos existentes, cancela todos (é uma remarcação)
      if (existingAppointments.length > 0) {
        await prisma.appointment.updateMany({
          where: {
            customerPhone: from,
            status: {
              in: ["PENDING", "CONFIRMED"]
            }
          },
          data: {
            status: "CANCELLED"
          }
        });
      }

      // Cria novo agendamento
      const appointment = await prisma.appointment.create({
        data: {
          customerName: appointmentData.data.customerName,
          customerPhone: from,
          service: appointmentData.data.service,
          date: new Date(appointmentData.data.date),
          time: appointmentData.data.time,
          status: "CONFIRMED",
          conversationId: conversation.id,
        },
      });

      // Fecha conversa
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "CLOSED" },
      });

      // Envia mensagem de confirmação limpa
      const isRescheduling = existingAppointments.length > 0;
      const confirmationMessage =
        `✅ ${isRescheduling ? 'Agendamento remarcado' : 'Agendamento confirmado'}!\n\n` +
        `📋 Resumo:\n` +
        `Nome: ${appointmentData.data.customerName}\n` +
        `Serviço: ${appointmentData.data.service}\n` +
        `Data: ${new Date(appointmentData.data.date).toLocaleDateString(
          "pt-BR"
        )}\n` +
        `Horário: ${appointmentData.data.time}\n\n` +
        `Nos vemos em breve! 😊`;

      await whatsappService.sendMessage(from, confirmationMessage);
    } else {
      // Envia resposta da IA
      await whatsappService.sendMessage(from, aiResponse);
    }

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error("Erro no webhook:", error);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
