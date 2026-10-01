import { publicEnv } from "@/lib/env";

/** Network + contract configuration shared by browser and server code. */
export const stellarConfig = {
  network: publicEnv.NEXT_PUBLIC_STELLAR_NETWORK,
  isTestnet: publicEnv.NEXT_PUBLIC_STELLAR_NETWORK === "testnet",
  rpcUrl: publicEnv.NEXT_PUBLIC_STELLAR_RPC_URL,
  horizonUrl: publicEnv.NEXT_PUBLIC_STELLAR_HORIZON_URL,
  networkPassphrase: publicEnv.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  contracts: {
    eventTicket: publicEnv.NEXT_PUBLIC_EVENT_TICKET_CONTRACT_ID,
    rewards: publicEnv.NEXT_PUBLIC_REWARDS_CONTRACT_ID,
    badge: publicEnv.NEXT_PUBLIC_BADGE_CONTRACT_ID,
  },
  usdc: {
    code: publicEnv.NEXT_PUBLIC_USDC_ASSET_CODE,
    issuer: publicEnv.NEXT_PUBLIC_USDC_ISSUER,
    contractId: publicEnv.NEXT_PUBLIC_USDC_CONTRACT_ID,
  },
} as const;

export const contractsConfigured = Boolean(
  stellarConfig.contracts.eventTicket && stellarConfig.contracts.rewards && stellarConfig.contracts.badge,
);

/** Block-explorer link for a transaction, account or contract. */
export function explorerUrl(kind: "tx" | "account" | "contract", id: string): string {
  const net = stellarConfig.isTestnet ? "testnet" : "public";
  return `https://stellar.expert/explorer/${net}/${kind}/${id}`;
}
