import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const filter = searchParams.get('filter') // 'all', 'recent', 'with_appointment', 'problematic'
    const hours = searchParams.get('hours') // número de horas para filtro 'recent'

    // Filtro de data
    const whereClause: any = {}

    if (filter === 'recent') {
      const hoursAgo = parseInt(hours || '48')
      const cutoffDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
      whereClause.updatedAt = { gte: cutoffDate }
    }

    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      include: {
        messages: {
          orderBy: {
            timestamp: 'desc'
          },
          take: 1
        },
        appointments: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        },
        _count: {
          select: {
            messages: true,
            appointments: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    })

    const formattedConversations = conversations.map(conv => {
      const lastMessage = conv.messages[0]
      const context = conv.context as any
      const lastAppointment = conv.appointments[0]
      const extractedData = context?.lastExtractedData

      // Detectar problemas
      const hasProblems = {
        missingName: !!(lastAppointment && (!lastAppointment.customerName || lastAppointment.customerName.trim() === '')),
        noAppointment: conv.status === 'CLOSED' && conv._count.appointments === 0,
        extractionFailed: !!(context?.lastExtractedData && !lastAppointment),
      }

      return {
        id: conv.id,
        phoneNumber: conv.phoneNumber,
        customerName: context?.customerName || null,
        lastMessage: lastMessage?.content || 'Sem mensagens',
        lastMessageAt: lastMessage?.timestamp || conv.createdAt,
        messageCount: conv._count.messages,
        appointmentCount: conv._count.appointments,
        status: conv.status,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,

        // Dados de debug
        lastAppointment: lastAppointment ? {
          id: lastAppointment.id,
          customerName: lastAppointment.customerName,
          service: lastAppointment.service,
          date: lastAppointment.date,
          time: lastAppointment.time,
          status: lastAppointment.status,
          createdAt: lastAppointment.createdAt,
        } : null,

        extractedData: extractedData || null,

        hasProblems: hasProblems,
        problemFlags: Object.entries(hasProblems)
          .filter(([_, value]) => value)
          .map(([key, _]) => key),
      }
    })

    // Filtrar conversas problemáticas se solicitado
    let filteredConversations = formattedConversations
    if (filter === 'problematic') {
      filteredConversations = formattedConversations.filter(conv =>
        conv.problemFlags.length > 0
      )
    } else if (filter === 'with_appointment') {
      filteredConversations = formattedConversations.filter(conv =>
        conv.appointmentCount > 0
      )
    }

    return NextResponse.json({
      success: true,
      conversations: filteredConversations
    })
  } catch (error) {
    console.error('Erro ao buscar conversas:', error)
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar conversas' },
      { status: 500 }
    )
  }
}
