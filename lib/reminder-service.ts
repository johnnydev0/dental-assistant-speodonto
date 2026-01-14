import { prisma } from "./prisma";
import { whatsappService } from "./whatsapp-service";

export class ReminderService {
  /**
   * Busca agendamentos para o dia seguinte (amanhã)
   */
  async getAppointmentsForTomorrow(): Promise<any[]> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    const appointments = await prisma.appointment.findMany({
      where: {
        date: {
          gte: tomorrow,
          lt: dayAfterTomorrow,
        },
        status: {
          in: ["PENDING", "CONFIRMED"],
        },
      },
      include: {
        conversation: true,
      },
    });

    return appointments;
  }

  /**
   * Formata a data para o formato brasileiro (dia da semana, DD/MM/YYYY)
   */
  formatDate(date: Date): string {
    const daysOfWeek = [
      "Domingo",
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
    ];

    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    const dayOfWeek = daysOfWeek[date.getDay()];

    return `${dayOfWeek}, ${day}/${month}/${year}`;
  }

  /**
   * Cria a mensagem de lembrete
   */
  createReminderMessage(appointment: any): string {
    const formattedDate = this.formatDate(new Date(appointment.date));

    return `Olá, ${appointment.customerName}! 👋

Estamos passando para confirmar seu atendimento na clínica SpeOdonto.

📅 *Data:* ${formattedDate} às ${appointment.time}
👨‍⚕️ *Médico:* Dr. Espedito Fernandes
🦷 *Procedimento:* ${appointment.service}
📍 *Endereço:* Av. Delfino Cerqueira, 672 - Centro, Carapicuíba - SP, 06322-060

Caso precise *remarcar* ou *cancelar*, por favor nos avise o quanto antes.

Até breve! 😊`;
  }

  /**
   * Envia lembretes para todos os agendamentos de amanhã
   */
  async sendReminders(): Promise<{
    success: number;
    failed: number;
    total: number;
  }> {
    const appointments = await this.getAppointmentsForTomorrow();
    let success = 0;
    let failed = 0;

    console.log(`[Reminder Service] Encontrados ${appointments.length} agendamentos para amanhã`);

    for (const appointment of appointments) {
      try {
        const message = this.createReminderMessage(appointment);
        await whatsappService.sendMessage(appointment.customerPhone, message);
        success++;
        console.log(`[Reminder Service] Lembrete enviado para ${appointment.customerName} (${appointment.customerPhone})`);

        // Aguarda 2 segundos entre mensagens para não sobrecarregar a API
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        failed++;
        console.error(
          `[Reminder Service] Erro ao enviar lembrete para ${appointment.customerName}:`,
          error
        );
      }
    }

    console.log(`[Reminder Service] Concluído: ${success} enviados, ${failed} falharam`);

    return {
      success,
      failed,
      total: appointments.length,
    };
  }
}

export const reminderService = new ReminderService();
