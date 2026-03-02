import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { zapiService } from "@/lib/zapi-service";
import { openAIService } from "@/lib/ai-service-openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Horários fixos disponíveis
const VALID_TIMES = ["09:30", "10:30", "11:30", "13:00", "14:00", "15:00", "16:00"];

// Telefone do atendente humano (pode ser movido para .env como ATTENDANT_PHONE)
const ATTENDANT_PHONE = "5511998720327";

// Função para buscar horários disponíveis nos próximos dias
async function getAvailableSlots(): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysToShow = 14; // Mostrar próximos 14 dias

  const endDate = new Date(today);
  endDate.setDate(today.getDate() + daysToShow);

  // Buscar dias bloqueados
  const blockedDates = await prisma.blockedDate.findMany({
    where: {
      date: {
        gte: today,
        lte: endDate,
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

  // Buscar slots de horário bloqueados (ex: manhã toda bloqueada, reunião, etc)
  const blockedTimeSlots = await prisma.blockedTimeSlot.findMany({
    where: {
      date: {
        gte: today,
        lte: endDate,
      },
    },
    select: {
      date: true,
      startTime: true,
      endTime: true,
    },
  });

  // Agrupar slots bloqueados por data
  const blockedSlotsByDate = blockedTimeSlots.reduce((acc, slot) => {
    const dateStr = slot.date.toISOString().split("T")[0];
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push({ startTime: slot.startTime, endTime: slot.endTime });
    return acc;
  }, {} as Record<string, { startTime: string; endTime: string }[]>);

  // Buscar agendamentos
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
    const blockedSlots = blockedSlotsByDate[dateStr] || [];

    const availableTimes = VALID_TIMES.filter(time => {
      if (occupiedTimes.includes(time)) return false;
      // Verificar se o horário cai dentro de algum slot bloqueado
      for (const slot of blockedSlots) {
        if (time >= slot.startTime && time < slot.endTime) return false;
      }
      return true;
    });

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

      result += `📅 ${dayName}, ${formattedDate}: ${availableTimes.join(", ")}\n`;
    }
  }

  if (!hasAvailableSlots) {
    result += "Nenhum horario disponivel nos proximos 14 dias.\n";
  }

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

      // Avisar o paciente
      await zapiService.sendText({
        phone: phoneNumber,
        message: humanAgentMessage,
      });

      // Notificar atendente humano
      const attendantPhone = ATTENDANT_PHONE;
      const attendantNotification =
        `🔔 *Solicitação de atendimento humano*\n\n` +
        `👤 Nome: ${senderName}\n` +
        `📱 Telefone: ${phoneNumber}\n` +
        `💬 Última mensagem: "${messageText}"`;

      try {
        await zapiService.sendText({
          phone: attendantPhone,
          message: attendantNotification,
        });
        console.log("📲 Atendente notificado:", attendantPhone);
      } catch (err) {
        console.error("⚠️ Falha ao notificar atendente:", err);
      }

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

    // Se a IA enviou AGENDAMENTO_COMPLETO mas extração falhou (nome placeholder, etc), pede o nome
    if (!appointmentData.isComplete && aiResponse.includes("AGENDAMENTO_COMPLETO")) {
      console.error("⚠️ ALERTA: Resposta contém AGENDAMENTO_COMPLETO mas extração falhou!");
      console.error("📝 Resposta da IA:", aiResponse);

      const askNameMessage =
        "Por gentileza, poderia me informar seu nome completo para que eu possa confirmar o agendamento?";

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: askNameMessage,
        },
      });

      await zapiService.sendText({
        phone: phoneNumber,
        message: askNameMessage,
      });

      return NextResponse.json({
        status: "missing_name",
        message: "Nome não coletado, pedindo novamente",
      });
    }

    if (appointmentData.isComplete && appointmentData.data) {
      try {
        const appointmentDate = new Date(appointmentData.data.date + 'T12:00:00Z');
        const appointmentTime = appointmentData.data.time;

        // Verificar se o dia está bloqueado (comparação por string de data para evitar problemas de timezone)
        const dayStart = new Date(appointmentData.data.date + 'T00:00:00.000Z');
        const dayEnd = new Date(appointmentData.data.date + 'T23:59:59.999Z');
        const isBlocked = await prisma.blockedDate.findFirst({
          where: { date: { gte: dayStart, lte: dayEnd } },
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

          return NextResponse.json({ status: "blocked_date", message: "Dia bloqueado" });
        }

        // Validar se o horário é um dos horários permitidos
        if (!VALID_TIMES.includes(appointmentTime)) {
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

          return NextResponse.json({ status: "invalid_time", message: "Horário não disponível" });
        }

        // Buscar agendamento ativo do próprio cliente (para remarcação)
        const ownAppointment = await prisma.appointment.findFirst({
          where: {
            customerPhone: phoneNumber,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
          orderBy: { date: "asc" },
        });

        // Verificar conflito com OUTROS pacientes (excluindo o próprio agendamento do cliente)
        const conflictingAppointment = await prisma.appointment.findFirst({
          where: {
            date: appointmentDate,
            time: appointmentTime,
            status: { not: "CANCELLED" },
            ...(ownAppointment ? { id: { not: ownAppointment.id } } : {}),
          },
        });

        if (conflictingAppointment) {
          console.log("⚠️ Conflito de horário com outro paciente!");
          const conflictMessage =
            `Desculpe, mas já existe um agendamento para ${appointmentDate.toLocaleDateString("pt-BR")} às ${appointmentTime}.\n\n` +
            `Por gentileza, escolha outro horário disponível.`;

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

          return NextResponse.json({ status: "conflict", message: "Horário já ocupado" });
        }

        let appointment;
        let isRescheduling = false;

        if (ownAppointment) {
          // Remarcação: atualiza o agendamento existente (sem criar um novo)
          isRescheduling = true;
          console.log(`📅 Remarcação: atualizando agendamento ${ownAppointment.id}`);
          appointment = await prisma.appointment.update({
            where: { id: ownAppointment.id },
            data: {
              customerName: appointmentData.data.customerName,
              service: appointmentData.data.service,
              date: appointmentDate,
              time: appointmentTime,
              status: "CONFIRMED",
              conversationId: conversation.id,
            },
          });
        } else {
          // Novo agendamento
          console.log("📅 Novo agendamento sendo criado...");
          appointment = await prisma.appointment.create({
            data: {
              customerName: appointmentData.data.customerName,
              customerPhone: phoneNumber,
              service: appointmentData.data.service,
              date: appointmentDate,
              time: appointmentTime,
              duration: 60,
              status: "CONFIRMED",
              conversationId: conversation.id,
            },
          });
        }

        console.log(`✅ Agendamento ${isRescheduling ? 'atualizado' : 'criado'}:`, appointment.id);

        // Fecha conversa
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: "CLOSED" },
        });

        const confirmationMessage =
          `✅ ${isRescheduling ? 'Consulta remarcada' : 'Consulta confirmada'}!\n\n` +
          `📋 Resumo:\n` +
          `Nome: ${appointmentData.data.customerName}\n` +
          `Serviço: ${appointmentData.data.service}\n` +
          `Data: ${new Date(appointmentData.data.date).toLocaleDateString("pt-BR")}\n` +
          `Horário: ${appointmentData.data.time}\n\n` +
          `Nos vemos em breve! 😊`;

        const zapiConfirmation = await zapiService.sendText({
          phone: phoneNumber,
          message: confirmationMessage,
        });
        console.log("📨 Resposta confirmação Z-API:", JSON.stringify(zapiConfirmation, null, 2));
      } catch (error) {
        console.error("❌ Erro ao processar agendamento:", error);
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
