import 'dotenv/config';
const chainId = Number(process.env.CHAIN_ID || 137);
if (chainId !== 137) throw new Error('GHM21 only supports Polygon Mainnet (CHAIN_ID=137).');

export const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || '',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET || '',
  siweDomain: process.env.SIWE_DOMAIN || new URL(process.env.CLIENT_ORIGIN || 'http://localhost:5173').host,
  chainId,
  telegramTaskChannel: process.env.TELEGRAM_TASK_CHANNEL || '@GHM21_tasks',
  auditorWallet: (process.env.AUDITOR_WALLET || '0x985cC42B9790CF0AE053e1Be7DA281505219Cc4F').toLowerCase(),
  polygonRpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
  polygonTraceRpcUrl: process.env.POLYGON_TRACE_RPC_URL || 'https://polygon.drpc.org',
  polygonProtocolAddress: (process.env.POLYGON_PROTOCOL_ADDRESS || '').toLowerCase(),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || ''
};
