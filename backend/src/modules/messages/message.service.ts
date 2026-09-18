import { prisma } from "../../db.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";

export const conversationSelect = {
  id: true,
  subject: true,
  status: true,
  unreadForAdmin: true,
  unreadForClient: true,
  lastMessageAt: true,
  createdAt: true,
  orderId: true,
} as const;

export async function listMyConversations(userId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { lastMessageAt: "desc" },
    select: {
      ...conversationSelect,
      order: { select: { number: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, senderRole: true, createdAt: true },
      },
    },
  });

  return conversations.map((c) => ({
    ...c,
    lastMessage: c.messages[0] ?? null,
    messages: undefined,
  }));
}

export async function createConversation(
  userId: string,
  input: { subject?: string; orderId?: string; message: string },
) {
  if (input.orderId) {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, userId },
      select: { id: true },
    });
    if (!order) throw notFound("Pedido nao encontrado na sua conta.");
  }

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        userId,
        orderId: input.orderId ?? null,
        subject: input.subject?.slice(0, 160) ?? "Atendimento",
        unreadForAdmin: 1,
        unreadForClient: 0,
        lastMessageAt: new Date(),
      },
      select: { id: true },
    });

    const author = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });

    await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderRole: "CLIENT",
        senderUserId: userId,
        authorName: author.name,
        body: input.message.slice(0, 4000),
      },
    });

    const admins = await tx.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    if (admins.length > 0) {
      await tx.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          type: "NEW_MESSAGE" as const,
          title: "Nova mensagem de cliente",
          body: `${author.name}: ${input.message.slice(0, 80)}`,
          link: `/admin/mensagens/${conversation.id}`,
        })),
      });
    }

    return { id: conversation.id };
  });
}

/** Conversa do cliente (com marcação de leitura automatica). */
export async function getConversationForUser(userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      ...conversationSelect,
      order: { select: { id: true, number: true, status: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, senderRole: true, authorName: true, createdAt: true, readAt: true },
      },
    },
  });

  if (!conversation) throw notFound("Conversa nao encontrada.");

  if (conversation.unreadForClient > 0) {
    await prisma.message.updateMany({
      where: { conversationId, senderRole: "ADMIN", readAt: null },
      data: { readAt: new Date() },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { unreadForClient: 0 } });
  }

  return conversation;
}

export async function sendClientMessage(userId: string, conversationId: string, body: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, status: true },
  });
  if (!conversation) throw notFound("Conversa nao encontrada.");
  if (conversation.status === "ARCHIVED") {
    throw badRequest("Esta conversa foi arquivada. Abra uma nova conversa para continuar.");
  }

  const author = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        senderRole: "CLIENT",
        senderUserId: userId,
        authorName: author.name,
        body: body.slice(0, 4000),
      },
      select: { id: true, body: true, createdAt: true, senderRole: true },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), unreadForAdmin: { increment: 1 }, status: "OPEN" },
    });

    return message;
  });
}

// -----------------------------------------------------------------------------
// Lado administrativo
// -----------------------------------------------------------------------------

export async function listConversationsForAdmin(filters: {
  status?: "OPEN" | "ARCHIVED" | "RESOLVED";
  search?: string;
  skip: number;
  take: number;
}) {
  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search
      ? {
          OR: [
            { subject: { contains: filters.search, mode: "insensitive" as const } },
            { user: { name: { contains: filters.search, mode: "insensitive" as const } } },
            { user: { email: { contains: filters.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [items, total, unread] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip: filters.skip,
      take: filters.take,
      select: {
        ...conversationSelect,
        user: { select: { id: true, name: true, email: true } },
        order: { select: { number: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, senderRole: true, createdAt: true } },
      },
    }),
    prisma.conversation.count({ where }),
    prisma.conversation.aggregate({ where: { unreadForAdmin: { gt: 0 } }, _count: { _all: true } }),
  ]);

  return {
    items: items.map((c) => ({ ...c, lastMessage: c.messages[0] ?? null, messages: undefined })),
    total,
    unreadConversations: unread._count._all,
  };
}

export async function getConversationForAdmin(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      ...conversationSelect,
      user: { select: { id: true, name: true, email: true, phone: true } },
      order: { select: { id: true, number: true, status: true, total: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, senderRole: true, authorName: true, createdAt: true, readAt: true },
      },
    },
  });

  if (!conversation) throw notFound("Conversa nao encontrada.");

  if (conversation.unreadForAdmin > 0) {
    await prisma.message.updateMany({
      where: { conversationId, senderRole: "CLIENT", readAt: null },
      data: { readAt: new Date() },
    });
    await prisma.conversation.update({ where: { id: conversationId }, data: { unreadForAdmin: 0 } });
  }

  return conversation;
}

export async function sendAdminMessage(adminId: string, conversationId: string, body: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true },
  });
  if (!conversation) throw notFound("Conversa nao encontrada.");

  const author = await prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { name: true } });

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        senderRole: "ADMIN",
        senderUserId: adminId,
        authorName: author.name,
        body: body.slice(0, 4000),
      },
      select: { id: true, body: true, createdAt: true, senderRole: true },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), unreadForClient: { increment: 1 }, status: "OPEN" },
    });

    await tx.notification.create({
      data: {
        userId: conversation.userId,
        type: "NEW_MESSAGE",
        title: "Nova mensagem do atendimento",
        body: body.slice(0, 100),
        link: `/mensagens/${conversationId}`,
      },
    });

    return message;
  });
}

export async function setConversationStatus(
  conversationId: string,
  status: "OPEN" | "ARCHIVED" | "RESOLVED",
) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw notFound("Conversa nao encontrada.");

  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status },
    select: conversationSelect,
  });
}

export async function countUnreadForUser(userId: string) {
  const [client, admin] = await Promise.all([
    prisma.conversation.aggregate({ where: { userId, unreadForClient: { gt: 0 } }, _sum: { unreadForClient: true } }),
    prisma.conversation.aggregate({ where: { unreadForAdmin: { gt: 0 } }, _sum: { unreadForAdmin: true } }),
  ]);
  return { forClient: client._sum.unreadForClient ?? 0, forAdmin: admin._sum.unreadForAdmin ?? 0 };
}

export { forbidden };
