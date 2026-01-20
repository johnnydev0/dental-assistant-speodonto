import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { zapiService } from "@/lib/zapi-service";
import { openAIService } from "@/lib/ai-service-openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Horários fixos disponíveis
const VALID_TIMES = ["09:30", "10:30", "11:30", "13:00", "14:00", "15:00", "16:00"];

// Função para buscar horários disponíveis nos próximos dias
async function getAvailableSlots(): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysToShow = 14; // Mostrar próximos 14 dias

  // Buscar dias bloqueados
  const blockedDates = await prisma.blockedDate.findMany({
    where: {
      date: {
        gte: today,
      },
    },
    select: {
      date: true,
      reason: true,
    },
  });

  const blockedDateStrings = new Set(
    blockedDates.map(bd => bd.date.toISOString().split("T")[0])
  );

  // Buscar agendamentos
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + daysToShow);

  const appointments = await prisma.appointment.findMany({
    where: {
      date: {
        gte: today,
        lte: endDate,
      },
      status: {
        not: "CANCELLED",
      },
    },
    select: {
      date: true,
      time: true,
    },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  // Agrupar agendamentos por data
  const appointmentsByDate = appointments.reduce((acc, apt) => {
    const dateStr = apt.date.toISOString().split("T")[0];
    if (!acc[dateStr]) {
      acc[dateStr] = [];
    }
    acc[dateStr].push(apt.time);
    return acc;
  }, {} as Record<string, string[]>);

  // Calcular disponibilidade para cada dia
  let result = "=== HORÁRIOS DISPONÍVEIS ===\n\n";
  let hasAvailableSlots = false;

  for (let i = 0; i < daysToShow; i++) {
    const currentDate = new Date(today);
    currentDate.setDate(today.getDate() + i);
    const dateStr = currentDate.toISOString().split("T")[0];

    // Pular finais de semana (0 = domingo, 6 = sábado)
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    // Verificar se dia está bloqueado
    if (blockedDateStrings.has(dateStr)) {
      continue;
    }

    const occupiedTimes = appointmentsByDate[dateStr] || [];
    const availableTimes = VALID_TIMES.filter(time => !occupiedTimes.includes(time));

    // Só mostrar dias que têm pelo menos um horário disponível
    if (availableTimes.length > 0) {
      hasAvailableSlots = true;
      const dayName = [
        "Domingo",
        "Segunda-feira",
        "Terça-feira",
        "Quarta-feira",
        "Quinta-feira",
        "Sexta-feira",
        "Sábado",
      ][dayOfWeek];
      const formattedDate = currentDate.toLocaleDateString("pt-BR");

      result += `📅 ${dayName}, ${formattedDate}:\n`;
      result += `   ✅ Disponíveis: ${availableTimes.join(", ")}\n`;
      if (occupiedTimes.length > 0) {
        result += `   ❌ Ocupados: ${occupiedTimes.join(", ")}\n`;
      }
      result += `\n`;
    }
  }

  if (!hasAvailableSlots) {
    result += "⚠️ Não há horários disponíveis nos próximos dias.\n";
    result += "Por favor, entre em contato para verificar disponibilidade.\n";
  }

  result += "\n💡 IMPORTANTE:\n";
  result += "- Horários disponíveis: Manhã (09:30, 10:30, 11:30) e Tarde (13:00, 14:00, 15:00, 16:00)\n";
  result += "- Quando o paciente perguntar horários disponíveis, mostre APENAS os horários marcados como ✅ Disponíveis\n";
  result += "- NUNCA sugira horários marcados como ❌ Ocupados\n";

  return result;
}

// Função para buscar dias bloqueados (feriados, folgas, etc)
async function getBlockedDates(): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  const blockedDates = await prisma.blockedDate.findMany({
    where: {
      date: {
        gte: today,
        lte: thirtyDaysFromNow,
      },
    },
    orderBy: {
      date: "asc",
    },
  });

  if (blockedDates.length === 0) {
    return "";
  }

  let result = "\n\n=== DIAS BLOQUEADOS (SEM ATENDIMENTO) ===\n";
  result += "ATENÇÃO: Estes dias estão COMPLETAMENTE bloqueados. NAO agende nada nestes dias!\n\n";

  for (const blocked of blockedDates) {
    const dateObj = blocked.date;
    const dayOfWeek = [
      "Domingo",
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
    ][dateObj.getUTCDay()];
    const formattedDate = dateObj.toLocaleDateString("pt-BR", {
      timeZone: "UTC",
    });

    result += `🚫 ${dayOfWeek}, ${formattedDate}`;
    if (blocked.reason) {
      result += ` - ${blocked.reason}`;
    }
    result += "\n";
  }

  result += "\nSe o paciente pedir um dia bloqueado, informe que não há atendimento e sugira outro dia.";

  return result;
}

// Tipos Z-API (estrutura real da Z-API)
interface ZApiWebhook {
  instanceId: string;
  phone: string;
  fromMe: boolean;
  momment: number;
  status: string;
  chatName: string;
  senderPhoto: string | null;
  senderName: string;
  participantPhone?: string;
  photo: string;
  broadcast: boolean;
  type: string;
  text?: {
    message: string;
  };
  image?: {
    caption?: string;
    imageUrl: string;
  };
  messageId: string;
  connectedPhone: string;
  waitingMessage: boolean;
  isStatusReply?: boolean;
  chatLid?: string;
  isEdit?: boolean;
  isGroup?: boolean;
  isNewsletter?: boolean;
  participantLid?: string | null;
  forwarded?: boolean;
  fromApi?: boolean;
}

/**
 * POST - Recebe mensagens do Z-API
 */
export async function POST(request: NextRequest) {
  try {
    const body: ZApiWebhook = await request.json();

    console.log("📱 Webhook Z-API recebido:", JSON.stringify(body, null, 2));

    // Validar client token (segurança)
    const clientToken = request.headers.get("client-token");
    if (clientToken && !zapiService.validateWebhook(clientToken)) {
      console.error("❌ Client token inválido");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ignorar mensagens enviadas por nós
    if (body.fromMe) {
      console.log("⏭️ Mensagem enviada por nós, ignorando");
      return NextResponse.json({ status: "ignored", reason: "fromMe" });
    }

    // Ignorar se não for mensagem recebida (type: ReceivedCallback)
    if (body.type !== "ReceivedCallback") {
      console.log("⏭️ Tipo ignorado:", body.type);
      return NextResponse.json({
        status: "ignored",
        reason: "not_received_callback",
      });
    }

    // Ignorar mensagens que ainda estão sendo carregadas (waitingMessage)
    if (body.waitingMessage) {
      console.log(
        "⏭️ Mensagem ainda carregando (waitingMessage: true), aguardando..."
      );
      return NextResponse.json({
        status: "ignored",
        reason: "waiting_message",
      });
    }

    const messageData = body;

    // Log completo para debug
    console.log("🔍 Tipos de conteúdo disponíveis:", {
      hasText: !!messageData.text,
      hasImage: !!messageData.image,
      hasAudio: !!(messageData as any).audio,
      hasVideo: !!(messageData as any).video,
      hasDocument: !!(messageData as any).document,
      allKeys: Object.keys(messageData),
    });

    // Extrair texto da mensagem
    let messageText = "";
    if (messageData.text?.message) {
      messageText = messageData.text.message;
    } else if (messageData.image?.caption) {
      messageText = messageData.image.caption;
    } else {
      console.log(
        "⏭️ Mensagem sem texto, ignorando. Body completo:",
        JSON.stringify(body, null, 2)
      );
      return NextResponse.json({ status: "ignored", reason: "no_text" });
    }

    const phoneNumber = messageData.phone;
    const senderName =
      messageData.senderName || messageData.chatName || "Cliente";

    // Filtrar mensagens de grupos (números com "-" ou "@g.us")
    if (phoneNumber.includes("-") || phoneNumber.includes("@g.us")) {
      console.log(
        `⏭️ Mensagem de grupo ignorada: ${phoneNumber}`
      );
      return NextResponse.json({ status: "ignored", reason: "group_message" });
    }

    console.log(
      `💬 Mensagem de ${senderName} (${phoneNumber}): ${messageText}`
    );

    // Buscar ou criar conversa
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber },
      include: { messages: true },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          phoneNumber,
          context: { name: senderName },
          status: "ACTIVE",
        },
        include: { messages: true },
      });
      console.log("✅ Nova conversa criada:", conversation.id);
    }

    // Salvar mensagem do usuário
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: messageText,
      },
    });

    // Preparar histórico de mensagens para a IA
    const messageHistory = conversation.messages.map((m) => ({
      role: m.role.toLowerCase() as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Adicionar nova mensagem do usuário
    messageHistory.push({
      role: "user",
      content: messageText,
    });

    // Obter contexto da conversa
    const context = (conversation.context as any) || {};

    // Detectar se o usuário quer falar com um atendente
    const wantsHumanAgent = /\b(atendente|humano|pessoa|algu[ée]m|transfer|falar com|preciso falar)\b/i.test(messageText);

    if (wantsHumanAgent) {
      const humanAgentMessage =
        "Entendi! Vou encaminhar sua solicitação para um de nossos atendentes. " +
        "Eles entrarão em contato com você em breve. Agradecemos a compreensão! 😊";

      // Salvar resposta no banco
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: humanAgentMessage,
        },
      });

      // Enviar mensagem
      await zapiService.sendText({
        phone: phoneNumber,
        message: humanAgentMessage,
      });

      // Atualizar status da conversa para WAITING_AGENT
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "WAITING_AGENT" },
      });

      console.log("👤 Usuário solicitou atendente humano");
      return NextResponse.json({
        status: "human_agent_requested",
        message: "Encaminhado para atendente",
      });
    }

    // Buscar agendamentos existentes deste cliente
    const customerAppointments = await prisma.appointment.findMany({
      where: {
        customerPhone: phoneNumber,
        status: {
          not: "CANCELLED",
        },
      },
      orderBy: {
        date: "asc",
      },
    });

    // Preparar informações dos agendamentos do cliente
    let customerAppointmentsInfo = "";
    if (customerAppointments.length > 0) {
      customerAppointmentsInfo = "\n\n=== AGENDAMENTOS DESTE CLIENTE ===\n";
      customerAppointments.forEach((apt) => {
        const dateStr = apt.date.toLocaleDateString("pt-BR");
        customerAppointmentsInfo += `- ${apt.customerName} | ${apt.service} | ${dateStr} às ${apt.time} | Status: ${apt.status}\n`;
      });
      customerAppointmentsInfo +=
        "\nSe o cliente pedir para alterar/cancelar, use essas informacoes.\n";
    }

    // Buscar horários disponíveis e dias bloqueados
    const availableSlots = await getAvailableSlots();
    const blockedDates = await getBlockedDates();
    console.log("📅 Horários disponíveis e dias bloqueados carregados");

    // Processar com IA OpenAI
    console.log("🤖 Processando com OpenAI...");
    const aiResponse = await openAIService.chat(
      messageHistory,
      context,
      availableSlots + "\n\n" + blockedDates + customerAppointmentsInfo
    );

    console.log("🤖 Resposta OpenAI:", aiResponse);

    // Salvar resposta da IA
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: aiResponse,
      },
    });

    // Verificar se é uma alteração de agendamento
    const rescheduleData = openAIService.extractRescheduleData(aiResponse);

    if (rescheduleData.isReschedule && rescheduleData.data) {
      try {
        // Buscar agendamento existente do cliente
        const existingAppointment = await prisma.appointment.findFirst({
          where: {
            customerPhone: phoneNumber,
            status: {
              not: "CANCELLED",
            },
          },
          orderBy: {
            date: "asc",
          },
        });

        if (!existingAppointment) {
          console.log("⚠️ Nenhum agendamento encontrado para alterar");
          return NextResponse.json({
            status: "no_appointment",
            message: "Nenhum agendamento encontrado",
          });
        }

        const newDate = new Date(rescheduleData.data.newDate);
        const newTime = rescheduleData.data.newTime;

        // Validar se o horário é um dos horários permitidos
        const validTimes = ["09:30", "10:30", "11:30", "13:00", "14:00", "15:00", "16:00"];
        if (!validTimes.includes(newTime)) {
          console.log("⚠️ Horário inválido para alteração:", newTime);
          const invalidTimeMessage =
            `Desculpe, mas o horário ${newTime} não está disponível.\n\n` +
            `Os horários disponíveis são:\n` +
            `Manhã: 09:30, 10:30, 11:30\n` +
            `Tarde: 13:00, 14:00, 15:00, 16:00\n\n` +
            `Por favor, escolha um destes horários.`;

          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: invalidTimeMessage,
            },
          });

          await zapiService.sendText({
            phone: phoneNumber,
            message: invalidTimeMessage,
          });

          return NextResponse.json({
            status: "invalid_time",
            message: "Horário não disponível",
          });
        }

        // Verificar se novo horário está disponível
        const conflictingAppointment = await prisma.appointment.findFirst({
          where: {
            date: newDate,
            time: newTime,
            status: {
              not: "CANCELLED",
            },
            id: {
              not: existingAppointment.id, // Excluir o próprio agendamento
            },
          },
        });

        if (conflictingAppointment) {
          const conflictMessage =
            `Desculpe, mas o horario ${newDate.toLocaleDateString(
              "pt-BR"
            )} as ${newTime} ja esta ocupado.\n\n` +
            `Por favor, escolha outro horario disponivel.`;

          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: conflictMessage,
            },
          });

          await zapiService.sendText({
            phone: phoneNumber,
            message: conflictMessage,
          });

          return NextResponse.json({
            status: "conflict",
            message: "Horario ja ocupado",
          });
        }

        // Atualizar o agendamento
        await prisma.appointment.update({
          where: { id: existingAppointment.id },
          data: {
            date: newDate,
            time: newTime,
          },
        });

        console.log("✅ Agendamento alterado com sucesso!");

        const confirmationMessage =
          `✅ Alteracao confirmada!\n\n` +
          `📋 Novo horario:\n` +
          `Nome: ${existingAppointment.customerName}\n` +
          `Servico: ${existingAppointment.service}\n` +
          `Data: ${newDate.toLocaleDateString("pt-BR")}\n` +
          `Horario: ${newTime}\n\n` +
          `Ate breve!`;

        await zapiService.sendText({
          phone: phoneNumber,
          message: confirmationMessage,
        });

        return NextResponse.json({
          status: "rescheduled",
          message: "Agendamento alterado com sucesso",
        });
      } catch (error) {
        console.error("Erro ao alterar agendamento:", error);
      }
    }

    // Verificar se o agendamento foi completado
    const appointmentData = openAIService.extractAppointmentData(aiResponse);

    if (appointmentData.isComplete && appointmentData.data) {
      try {
        // Verificar se esta conversa já criou um agendamento
        const existingAppointment = await prisma.appointment.findFirst({
          where: {
            conversationId: conversation.id,
            status: {
              not: "CANCELLED",
            },
          },
        });

        if (existingAppointment) {
          console.log("⚠️ Esta conversa já tem um agendamento criado!");
          return NextResponse.json({
            status: "already_scheduled",
            message: "Agendamento já criado para esta conversa",
          });
        }

        const appointmentDate = new Date(appointmentData.data.date + 'T12:00:00');
        const appointmentTime = appointmentData.data.time;

        // Verificar se o dia está bloqueado
        const isBlocked = await prisma.blockedDate.findUnique({
          where: { date: appointmentDate }
        });

        if (isBlocked) {
          console.log("⚠️ Dia bloqueado:", appointmentData.data.date);
          const blockedMessage =
            `Desculpe, mas o dia ${appointmentDate.toLocaleDateString("pt-BR", { timeZone: "UTC" })} está bloqueado` +
            (isBlocked.reason ? ` (${isBlocked.reason})` : '') +
            `.\n\nPor favor, escolha outra data.`;

          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: blockedMessage,
            },
          });

          await zapiService.sendText({
            phone: phoneNumber,
            message: blockedMessage,
          });

          return NextResponse.json({
            status: "blocked_date",
            message: "Dia bloqueado",
          });
        }

        // Validar se o horário é um dos horários permitidos
        const validTimes = ["09:30", "10:30", "11:30", "13:00", "14:00", "15:00", "16:00"];
        if (!validTimes.includes(appointmentTime)) {
          console.log("⚠️ Horário inválido:", appointmentTime);
          const invalidTimeMessage =
            `Desculpe, mas o horário ${appointmentTime} não está disponível.\n\n` +
            `Os horários disponíveis são:\n` +
            `Manhã: 09:30, 10:30, 11:30\n` +
            `Tarde: 13:00, 14:00, 15:00, 16:00\n\n` +
            `Por favor, escolha um destes horários.`;

          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: invalidTimeMessage,
            },
          });

          await zapiService.sendText({
            phone: phoneNumber,
            message: invalidTimeMessage,
          });

          return NextResponse.json({
            status: "invalid_time",
            message: "Horário não disponível",
          });
        }

        // Verificar se já existe agendamento para este horário (outro paciente)
        const conflictingAppointment = await prisma.appointment.findFirst({
          where: {
            date: appointmentDate,
            time: appointmentTime,
            status: {
              not: "CANCELLED",
            },
          },
        });

        if (conflictingAppointment) {
          console.log("⚠️ Conflito de horário detectado!");
          const conflictMessage =
            `Desculpe, mas já existe um agendamento para ${appointmentDate.toLocaleDateString(
              "pt-BR"
            )} às ${appointmentTime}.\n\n` +
            `Por gentileza, escolha outro horário disponível.`;

          // Salvar mensagem de conflito no histórico
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: "ASSISTANT",
              content: conflictMessage,
            },
          });

          await zapiService.sendText({
            phone: phoneNumber,
            message: conflictMessage,
          });

          return NextResponse.json({
            status: "conflict",
            message: "Horário já ocupado",
          });
        }

        // Verificar se o cliente já tem agendamentos existentes (remarcação)
        const existingClientAppointments = await prisma.appointment.findMany({
          where: {
            customerPhone: phoneNumber,
            status: {
              in: ["PENDING", "CONFIRMED"],
            },
          },
        });

        // Se houver agendamentos existentes, cancela todos (é uma remarcação)
        const isRescheduling = existingClientAppointments.length > 0;
        if (isRescheduling) {
          console.log(`📅 Remarcação detectada! Cancelando ${existingClientAppointments.length} agendamento(s) anterior(es)`);
          await prisma.appointment.updateMany({
            where: {
              customerPhone: phoneNumber,
              status: {
                in: ["PENDING", "CONFIRMED"],
              },
            },
            data: {
              status: "CANCELLED",
            },
          });
        }

        // Criar agendamento
        const appointment = await prisma.appointment.create({
          data: {
            customerName: appointmentData.data.customerName,
            customerPhone: phoneNumber,
            service: appointmentData.data.service,
            date: appointmentDate,
            time: appointmentTime,
            duration: 60, // Duração padrão: 1 hora
            status: "CONFIRMED",
            conversationId: conversation.id,
          },
        });

        console.log("📅 Agendamento criado:", appointment.id);

        // Fecha conversa
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: "CLOSED" },
        });

        // Envia mensagem de confirmação limpa
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

        const zapiConfirmation = await zapiService.sendText({
          phone: phoneNumber,
          message: confirmationMessage,
        });
        console.log(
          "📨 Resposta confirmação Z-API:",
          JSON.stringify(zapiConfirmation, null, 2)
        );
      } catch (error) {
        console.error("❌ Erro ao criar agendamento:", error);
        // Se erro, envia resposta normal da IA
        await zapiService.sendText({
          phone: phoneNumber,
          message: aiResponse,
        });
      }
    } else {
      // Enviar resposta da IA via Z-API
      console.log("📤 Enviando resposta via Z-API...");
      const zapiResponse = await zapiService.sendText({
        phone: phoneNumber,
        message: aiResponse,
      });
      console.log(
        "📨 Resposta do Z-API:",
        JSON.stringify(zapiResponse, null, 2)
      );
    }

    console.log("✅ Resposta enviada com sucesso!");

    return NextResponse.json({
      status: "success",
      message: "Mensagem processada",
      conversationId: conversation.id,
    });
  } catch (error) {
    console.error("❌ Erro ao processar webhook Z-API:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Verificação de status (útil para testes)
 */
export async function GET() {
  try {
    const status = await zapiService.getStatus();
    return NextResponse.json({
      status: "webhook_active",
      zapiStatus: status,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Z-API service unavailable" },
      { status: 503 }
    );
  }
}
