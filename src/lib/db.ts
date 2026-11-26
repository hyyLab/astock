import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  lbClientRef: { current: PrismaClient } | undefined
}

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  })
}

const ref = globalForPrisma.lbClientRef ?? { current: globalForPrisma.prisma ?? createClient() }
globalForPrisma.lbClientRef = ref

// 通过代理暴露 db：重建 client 时只替换 ref.current，导入方无需换引用。
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = ref.current
    const value = Reflect.get(client, prop, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = ref.current

let pragmaReady: Promise<void> | null = null

export function ensureSqlitePragmas(): Promise<void> {
  pragmaReady ??= (async () => {
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL')
    await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL')
    await db.$queryRawUnsafe('PRAGMA busy_timeout=20000')
    await db.$queryRawUnsafe('PRAGMA wal_autocheckpoint=1000')
  })()
  return pragmaReady
}

export async function recreatePrismaClient(): Promise<void> {
  const old = ref.current
  pragmaReady = null
  ref.current = createClient()
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = ref.current
  try {
    await old.$disconnect()
  } catch {
    // P1008 后旧连接可能已失效，忽略
  }
  await ensureSqlitePragmas()
}
